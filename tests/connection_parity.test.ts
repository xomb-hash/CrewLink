import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { storage } from '../src/lib/storage';
import { decryptConnectionTokens } from '../src/posting/connections';
import { CredentialDecryptionError } from '../src/posting/credentials';
import type { StoredPlatformConnection } from '../src/types/index';

// Prisma keeps exactly one platform_connection row per (userId, platformId,
// projectId). The file-backed store must behave the same way for reads and
// upserts, and an undecryptable local credential must surface as
// invalid_credentials (auth_revoked), not a generic platform error.

async function makeOwnerProject(label: string): Promise<{ userId: string; projectId: string }> {
  const owner = await storage.saveUser({ id: Math.floor(Math.random() * 100000) + 50000, login: `${label}-owner` });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: `${label}-owner/rocket`,
    repoName: 'rocket',
    repoOwner: `${label}-owner`,
    title: 'Rocket',
  });
  return { userId: String(owner.id), projectId: project.id };
}

function connection(input: {
  id: string;
  userId: string;
  projectId: string;
  status?: StoredPlatformConnection['status'];
  ciphertext?: string;
}): StoredPlatformConnection {
  const now = new Date().toISOString();
  return {
    id: input.id,
    userId: input.userId,
    projectId: input.projectId,
    platformId: 'x',
    status: input.status || 'active',
    scopes: [],
    accessTokenCiphertext: input.ciphertext ?? 'garbage:ciphertext',
    credentialProvider: 'local',
    keyRef: 'local:v1',
    createdAt: now,
    updatedAt: now,
  };
}

test('connection storage parity with the Prisma unique constraint', async (t) => {
  await t.test('a reconnect with a new id reuses the existing row for the tuple', async () => {
    storage.reset();
    const { userId, projectId } = await makeOwnerProject('conn-parity-a');
    await storage.upsertPlatformConnection(
      connection({ id: 'pcn_first', userId, projectId, ciphertext: 'old-ciphertext' })
    );
    const saved = await storage.upsertPlatformConnection(
      connection({ id: 'pcn_second', userId, projectId, ciphertext: 'new-ciphertext' })
    );
    assert.equal(saved.id, 'pcn_first');
    const list = await storage.listPlatformConnections(userId, projectId);
    assert.equal(list.length, 1);
    const found = await storage.findPlatformConnection(userId, projectId, 'x');
    assert.equal(found?.id, 'pcn_first');
    assert.equal(found?.accessTokenCiphertext, 'new-ciphertext');
  });

  await t.test('different projects keep separate connection rows', async () => {
    storage.reset();
    const first = await makeOwnerProject('conn-parity-b1');
    const second = await makeOwnerProject('conn-parity-b2');
    await storage.upsertPlatformConnection(
      connection({ id: 'pcn_b1', userId: first.userId, projectId: first.projectId })
    );
    await storage.upsertPlatformConnection(
      connection({ id: 'pcn_b2', userId: second.userId, projectId: second.projectId })
    );
    assert.equal((await storage.listPlatformConnections(first.userId)).length, 1);
    assert.equal((await storage.listPlatformConnections(second.userId)).length, 1);
  });

  await t.test('reads prefer an active row when legacy data contains duplicates', async () => {
    storage.reset();
    const { userId, projectId } = await makeOwnerProject('conn-parity-c');
    await storage.upsertPlatformConnection(
      connection({ id: 'pcn_stale', userId, projectId, status: 'disconnected', ciphertext: '' })
    );
    // Simulate legacy duplicate rows that the upsert dedupe now prevents.
    const internal = storage as unknown as {
      data: { platformConnections: StoredPlatformConnection[] };
    };
    internal.data.platformConnections.push(
      connection({ id: 'pcn_legacy_active', userId, projectId, ciphertext: 'legacy-live' })
    );
    const found = await storage.findPlatformConnection(userId, projectId, 'x');
    assert.equal(found?.id, 'pcn_legacy_active');
    assert.equal(found?.status, 'active');
  });
});

test('undecryptable local credentials fail as invalid credentials, not platform errors', async () => {
  storage.reset();
  const { userId, projectId } = await makeOwnerProject('conn-decrypt');
  await storage.upsertPlatformConnection(
    connection({ id: 'pcn_corrupt', userId, projectId, ciphertext: 'definitely:not:a:payload' })
  );
  const found = await storage.findPlatformConnection(userId, projectId, 'x');
  assert.ok(found);
  await assert.rejects(
    () => decryptConnectionTokens(found!),
    (err: unknown) =>
      err instanceof Error &&
      err.name === 'ConnectionError' &&
      (err as { code?: string }).code === 'invalid_credentials'
  );
});

test('a provider mismatch is never rewritten into invalid credentials', async () => {
  storage.reset();
  const { userId, projectId } = await makeOwnerProject('conn-mismatch');
  await storage.upsertPlatformConnection({
    ...connection({ id: 'pcn_gcp', userId, projectId }),
    credentialProvider: 'gcp',
  });
  const found = await storage.findPlatformConnection(userId, projectId, 'x');
  assert.ok(found);
  await assert.rejects(
    () => decryptConnectionTokens(found!),
    (err: unknown) => err instanceof CredentialDecryptionError
  );
  const invalid = (await decryptConnectionTokens(found!).catch((e) => e)) as { code?: string };
  assert.notEqual(invalid?.code, 'invalid_credentials');
});
