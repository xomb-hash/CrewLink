import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { storage } from '../src/lib/storage';
import { getCredentialVault } from '../src/posting/credentials';
import {
  AnalyticsError,
  resetAnalyticsSyncStateForTests,
  syncProjectAnalytics,
} from '../src/analytics/sync';
import {
  resetAnalyticsClientsForTests,
  setAnalyticsClientForTests,
  type AnalyticsClient,
} from '../src/analytics/clients/index';
import type { Project, User } from '../src/types/index';

const NOW = new Date('2026-11-10T12:00:00.000Z');

async function makeProject(idBase: number, label: string): Promise<{ owner: User; project: Project }> {
  const owner = await storage.saveUser({ id: idBase, login: `${label}-owner` });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: `${label}-owner/rocket`,
    repoName: 'rocket',
    repoOwner: `${label}-owner`,
    title: 'Rocket',
  });
  return { owner, project };
}

async function seedX(owner: User, project: Project): Promise<void> {
  const connectionId = `pcn_x_${Math.random().toString(36).slice(2, 10)}`;
  const vault = getCredentialVault();
  const encrypted = await vault.encrypt('access-token-test-value', {
    userId: String(owner.id),
    platformId: 'x',
    connectionId,
  });
  const now = new Date().toISOString();
  await storage.upsertPlatformConnection({
    id: connectionId,
    userId: String(owner.id),
    projectId: project.id,
    platformId: 'x',
    externalAccountId: 'x-account',
    externalAccountName: 'rocket',
    status: 'active',
    scopes: ['tweet.read'],
    accessTokenCiphertext: encrypted.ciphertext,
    credentialProvider: encrypted.provider,
    keyRef: encrypted.keyRef,
    createdAt: now,
    updatedAt: now,
  });
}

test('analytics sync leases are atomic, expiring and token-safe', async (t) => {
  storage.reset();
  const key = 'analytics:prj_one:x';
  const base = {
    key,
    projectId: 'prj_one',
    platformId: 'x',
    now: NOW,
    leaseMs: 60_000,
  };

  await t.test('one owner acquires, a second is blocked', async () => {
    const first = await storage.acquireAnalyticsSyncLock({ ...base, ownerToken: 'owner-a' });
    assert.equal(first.acquired, true);
    assert.equal(first.lock?.ownerToken, 'owner-a');
    const second = await storage.acquireAnalyticsSyncLock({ ...base, ownerToken: 'owner-b' });
    assert.equal(second.acquired, false);
    assert.equal(second.heldByToken, 'owner-a');
  });

  await t.test('only the owner token can release the lease', async () => {
    assert.equal(await storage.releaseAnalyticsSyncLock(key, 'owner-b'), false);
    assert.equal((await storage.getAnalyticsSyncLock(key))?.ownerToken, 'owner-a');
    assert.equal(await storage.releaseAnalyticsSyncLock(key, 'owner-a'), true);
    assert.equal(await storage.getAnalyticsSyncLock(key), null);
  });

  await t.test('an expired lease can be recovered by another worker', async () => {
    const first = await storage.acquireAnalyticsSyncLock({
      ...base,
      ownerToken: 'crashed-worker',
      leaseMs: 1_000,
    });
    assert.equal(first.acquired, true);
    const later = new Date(NOW.getTime() + 5_000);
    const recovered = await storage.acquireAnalyticsSyncLock({
      ...base,
      now: later,
      ownerToken: 'recovery-worker',
      leaseMs: 60_000,
    });
    assert.equal(recovered.acquired, true);
    assert.equal(recovered.lock?.ownerToken, 'recovery-worker');
    // The expired worker cannot release the new lease.
    assert.equal(await storage.releaseAnalyticsSyncLock(key, 'crashed-worker'), false);
    assert.equal((await storage.getAnalyticsSyncLock(key))?.ownerToken, 'recovery-worker');
    assert.equal(await storage.releaseAnalyticsSyncLock(key, 'recovery-worker'), true);
  });

  await t.test('project deletion removes a lock in the file store', async () => {
    const { project } = await makeProject(10001, 'lock-delete');
    await storage.acquireAnalyticsSyncLock({
      key: `analytics:${project.id}:x`,
      ownerToken: 'owner',
      projectId: project.id,
      platformId: 'x',
      now: NOW,
      leaseMs: 60_000,
    });
    assert.ok(await storage.getAnalyticsSyncLock(`analytics:${project.id}:x`));
    await storage.deleteProject(project.id);
    assert.equal(await storage.getAnalyticsSyncLock(`analytics:${project.id}:x`), null);
  });
});

test('concurrent syncs share the database lease and release it afterwards', async (t) => {
  storage.reset();
  resetAnalyticsClientsForTests();
  resetAnalyticsSyncStateForTests();
  const { owner, project } = await makeProject(10101, 'lock-sync');
  await seedX(owner, project);

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client: AnalyticsClient = {
    platform: 'x',
    async fetchAccount() {
      await gate;
      return { metrics: { followers_count: 100, tweet_count: 10 } };
    },
    async fetchPost() {
      return { metrics: {} };
    },
  };
  setAnalyticsClientForTests('x', client);

  const first = syncProjectAnalytics({ user: owner, project, platformIds: ['x'], now: NOW });
  await assert.rejects(
    () => syncProjectAnalytics({ user: owner, project, platformIds: ['x'], now: NOW }),
    (error) => error instanceof AnalyticsError && error.code === 'sync_in_progress'
  );
  const held = await storage.getAnalyticsSyncLock(`analytics:${project.id}:x`);
  assert.ok(held);
  release();
  const result = await first;
  assert.equal(result.results[0].status, 'completed');
  assert.equal(await storage.getAnalyticsSyncLock(`analytics:${project.id}:x`), null);

  await t.test('an expired crashed worker lease does not block recovery', async () => {
    const key = `analytics:${project.id}:x`;
    await storage.acquireAnalyticsSyncLock({
      key,
      ownerToken: 'crashed-worker',
      projectId: project.id,
      platformId: 'x',
      now: new Date(Date.now() - 60_000),
      leaseMs: 1_000,
    });
    setAnalyticsClientForTests('x', {
      platform: 'x',
      async fetchAccount() {
        return { metrics: { followers_count: 101, tweet_count: 10 } };
      },
      async fetchPost() {
        return { metrics: {} };
      },
    });
    const recovered = await syncProjectAnalytics({
      user: owner,
      project,
      platformIds: ['x'],
      now: NOW,
    });
    assert.equal(recovered.results[0].status, 'completed');
    assert.equal(await storage.getAnalyticsSyncLock(key), null);
  });

  resetAnalyticsClientsForTests();
});
