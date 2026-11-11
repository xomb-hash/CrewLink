import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import './setup';
import { storage } from '../src/lib/storage';
import { config } from '../src/config/index';
import { rateLimiter } from '../src/lib/rateLimit';
import { getCredentialVault } from '../src/posting/credentials';
import {
  resetAnalyticsClientsForTests,
  setAnalyticsClientForTests,
} from '../src/analytics/clients/index';
import { POST as schedulerRoute } from '../src/app/api/analytics/sync/scheduled/route';
import type { User } from '../src/types/index';

const TOKEN = 'scheduler-token-'.padEnd(40, 'x');

function request(body: unknown, token?: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/analytics/sync/scheduled', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-crewlink-scheduler-token': token } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function seed(idBase: number, label: string) {
  const owner = await storage.saveUser({ id: idBase, login: `${label}-owner` });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: `${label}-owner/rocket`,
    repoName: 'rocket',
    repoOwner: `${label}-owner`,
    title: 'Rocket',
  });
  const connectionId = `pcn_x_${Math.random().toString(36).slice(2, 10)}`;
  const vault = getCredentialVault();
  const encrypted = await vault.encrypt('scheduler-access-token', {
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
    externalAccountId: 'scheduler-account',
    externalAccountName: 'rocket',
    status: 'active',
    scopes: ['tweet.read'],
    accessTokenCiphertext: encrypted.ciphertext,
    credentialProvider: encrypted.provider,
    keyRef: encrypted.keyRef,
    createdAt: now,
    updatedAt: now,
  });
  return { owner: owner as User, project };
}

test('the scheduler endpoint requires a configured, valid service token', async (t) => {
  storage.reset();
  rateLimiter.reset();
  resetAnalyticsClientsForTests();
  const { owner, project } = await seed(11001, 'scheduler');
  const original = config.analyticsSchedulerToken;

  await t.test('disabled without a configured token', async () => {
    config.analyticsSchedulerToken = '';
    const response = await schedulerRoute(request({ projectIds: [project.id] }, TOKEN));
    assert.equal(response.status, 503);
  });

  await t.test('rejects a missing or wrong token', async () => {
    config.analyticsSchedulerToken = TOKEN;
    const missing = await schedulerRoute(request({ projectIds: [project.id] }));
    assert.equal(missing.status, 401);
    const wrong = await schedulerRoute(request({ projectIds: [project.id] }, 'x'.repeat(40)));
    assert.equal(wrong.status, 401);
  });

  await t.test('accepts a valid token and returns no credentials', async () => {
    config.analyticsSchedulerToken = TOKEN;
    setAnalyticsClientForTests('x', {
      platform: 'x',
      async fetchAccount() {
        return { metrics: { followers_count: 123, tweet_count: 12 } };
      },
      async fetchPost() {
        return { metrics: {} };
      },
    });
    const response = await schedulerRoute(request({ projectIds: [project.id] }, TOKEN));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.processed, 1);
    assert.equal(data.results[0].projectId, project.id);
    assert.equal(data.results[0].status, 'completed');
    const serialized = JSON.stringify(data);
    assert.equal(serialized.includes(TOKEN), false);
    assert.equal(serialized.includes('scheduler-access-token'), false);
    assert.equal(serialized.includes('ciphertext'), false);
    const accounts = await storage.listAnalyticsAccounts(project.id);
    assert.equal(accounts[0].metrics.followers, 123);
    assert.equal(accounts[0].userId, String(owner.id));
  });

  await t.test('a lease held by another worker is reported as a failure', async () => {
    await storage.acquireAnalyticsSyncLock({
      key: `analytics:${project.id}:x`,
      ownerToken: 'another-worker',
      projectId: project.id,
      platformId: 'x',
      now: new Date(),
      leaseMs: 60_000,
    });
    const response = await schedulerRoute(request({ projectIds: [project.id] }, TOKEN));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.results[0].status, 'failed');
    assert.equal(data.results[0].errorCode, 'sync_in_progress');
    await storage.releaseAnalyticsSyncLock(`analytics:${project.id}:x`, 'another-worker');
  });

  await t.test('the scheduler call is rate-limited', async () => {
    rateLimiter.reset();
    for (let index = 0; index < 6; index += 1) {
      const response = await schedulerRoute(request({ projectIds: [project.id] }, TOKEN));
      assert.equal(response.status, 200);
    }
    const limited = await schedulerRoute(request({ projectIds: [project.id] }, TOKEN));
    assert.equal(limited.status, 429);
  });

  config.analyticsSchedulerToken = original;
  resetAnalyticsClientsForTests();
});
