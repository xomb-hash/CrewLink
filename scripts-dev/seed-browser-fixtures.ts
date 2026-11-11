/**
 * One-off dev helper: rebuild the browser-verification fixtures in the
 * file-backed store (user, project with 8 published X posts, an active X
 * connection, and a second project with no posts for empty states).
 * File store only; never use against a real database.
 */
import crypto from 'node:crypto';
import { storage } from '../src/lib/storage';
import { getCredentialVault } from '../src/posting/credentials';

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

async function main(): Promise<void> {
  storage.reset();
  const owner = await storage.saveUser({
    id: 1001,
    login: 'x-publish-owner',
    name: 'Dev Owner',
    publicRepos: 14,
    createdAt: '2022-01-15T00:00:00.000Z',
  });
  const userId = String(owner.id);

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'x-publish-owner/rocket',
    repoName: 'rocket',
    repoOwner: 'x-publish-owner',
    title: 'Rocket',
    isPrivate: false,
  });

  const emptyProject = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'x-publish-owner/manual',
    repoName: 'manual',
    repoOwner: 'x-publish-owner',
    title: 'Manual two',
  });

  const connectionId = id('pcn');
  const vault = getCredentialVault();
  const encrypted = await vault.encrypt('mock-access-token-dev', {
    userId,
    platformId: 'x',
    connectionId,
  });
  const now = new Date().toISOString();
  await storage.upsertPlatformConnection({
    id: connectionId,
    userId,
    projectId: project.id,
    platformId: 'x',
    externalAccountId: 'mock-x-acct-1',
    externalAccountName: 'mock-x-owner',
    status: 'active',
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'],
    accessTokenCiphertext: encrypted.ciphertext,
    credentialProvider: encrypted.provider,
    keyRef: encrypted.keyRef,
    createdAt: now,
    updatedAt: now,
  });

  // Spread 8 published posts across the last 10 days so timing/comparison
  // queries have enough measured posts (>= 8 posts across 3+ days).
  for (let i = 0; i < 8; i += 1) {
    const draft = await storage.createDraft({
      projectId: project.id,
      platformId: 'x',
      text: `Dev fixture post ${i + 1}: shipping analytics that measure instead of guess.`,
    });
    const publishedAt = new Date(Date.now() - (i + 1) * 30 * 60 * 60 * 1000); // ~30h apart
    await storage.createPublicationIfAbsent({
      id: id('pub'),
      userId,
      projectId: project.id,
      draftId: draft.id,
      connectionId,
      platformId: 'x',
      status: 'published',
      mode: 'api',
      contentHash: crypto.createHash('sha256').update(draft.text).digest('hex'),
      externalId: `mock-x-post-${i + 1}`,
      externalIds: [`mock-x-post-${i + 1}`],
      confirmedAt: publishedAt.toISOString(),
      createdAt: publishedAt.toISOString(),
      updatedAt: publishedAt.toISOString(),
    });
  }

  console.log('seeded:', JSON.stringify({
    projectId: project.id,
    emptyProjectId: emptyProject.id,
    connectionId,
  }));
  process.exit(0);
}

void main();
