import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import './setup';
import { storage } from '../src/lib/storage';
import { signValue } from '../src/lib/auth';
import { config } from '../src/config/index';
import { logger } from '../src/lib/logger';
import type { User } from '../src/types/index';
import {
  AdapterError,
  MastodonClient,
  resetMockBlueskyState,
  resetMockMastodonState,
  resetOAuthClientsForTests,
  setOAuthClientForTests,
  type BlueskyClientLike,
  type FetchLike,
  type LookupFn,
  type MastodonClientLike,
} from '../src/posting/adapters/index';
import {
  beginMastodonAuthorization,
  cancelMastodonAuthorization,
  completeMastodonAuthorization,
  connectBlueskyAccount,
  ConnectionError,
  decryptConnectionTokens,
  disconnectConnection,
  listConnections,
  persistConnectionTokens,
  saveConnection,
  verifyConnection,
} from '../src/posting/connections';
import { PublishError, publishDraft } from '../src/posting/publish';
import {
  GET as listConnectionsRoute,
  POST as connectConnectionRoute,
} from '../src/app/api/platforms/connections/route';
import { DELETE as disconnectConnectionRoute } from '../src/app/api/platforms/connections/[id]/route';
import { POST as verifyConnectionRoute } from '../src/app/api/platforms/connections/[id]/verify/route';
import { GET as mastodonCallbackRoute } from '../src/app/api/platforms/mastodon/callback/route';
import { POST as publishRoute } from '../src/app/api/drafts/[id]/publish/route';

const connectionCode = (err: unknown) =>
  err instanceof ConnectionError ? err.code : 'unexpected';
const publishCode = (err: unknown) => (err instanceof PublishError ? err.code : 'unexpected');
const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

interface Seed {
  owner: User;
  other: User;
  projectId: string;
  otherProjectId: string;
  ownerCookie: string;
  otherCookie: string;
  ownerSessionId: string;
  otherSessionId: string;
}

async function seed(idBase: number, slug: string): Promise<Seed> {
  const owner = await storage.saveUser({ id: idBase, login: `${slug}-owner` });
  const other = await storage.saveUser({ id: idBase + 1, login: `${slug}-other` });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: `${slug}-owner/rocket`,
    repoName: 'rocket',
    repoOwner: `${slug}-owner`,
    title: 'Rocket',
  });
  const otherProject = await storage.createProject({
    ownerLogin: other.login,
    ownerId: other.id,
    repoFullName: `${slug}-other/boat`,
    repoName: 'boat',
    repoOwner: `${slug}-other`,
    title: 'Boat',
  });
  const ownerSession = await storage.createSession(owner.id);
  const otherSession = await storage.createSession(other.id);
  return {
    owner,
    other,
    projectId: project.id,
    otherProjectId: otherProject.id,
    ownerCookie: `crewlink_session=${encodeURIComponent(signValue(ownerSession))}`,
    otherCookie: `crewlink_session=${encodeURIComponent(signValue(otherSession))}`,
    ownerSessionId: ownerSession,
    otherSessionId: otherSession,
  };
}

async function approvedDraft(projectId: string, platformId: string, text: string) {
  const draft = await storage.createDraft({ projectId, platformId, text });
  await storage.approveDraft(draft.id, 'owner');
  return draft;
}

function authorizationState(url: string): string {
  return new URL(url).searchParams.get('state') || '';
}

interface StubMastodonOptions {
  instanceUrl: string;
  accountId: string;
  accountName?: string;
  limit?: number;
}

// The real adapter screens every outbound call through DNS; tests pin a public
// address so no lookup touches the network.
const publicLookup: LookupFn = async () => [{ address: '93.184.216.34', family: 4 }];

// In-memory OAuth client bound to one instance and account. It never performs
// network calls; the same instance/account values are what destination-change
// detection compares.
function mastodonStub(options: StubMastodonOptions): MastodonClientLike {
  const host = new URL(options.instanceUrl).hostname;
  return {
    platform: 'mastodon',
    async registerApp(instanceUrl) {
      return {
        clientId: `client-${host}`,
        clientSecret: `secret-${host}`,
        redirectUri: `${instanceUrl}/callback`,
      };
    },
    authorizationUrl(input) {
      const url = new URL('/oauth/authorize', input.instanceUrl);
      url.searchParams.set('client_id', input.clientId);
      url.searchParams.set('state', input.state);
      return url.toString();
    },
    async exchangeCode() {
      return { accessToken: `token-${host}`, scopes: ['read:accounts', 'write:statuses'] };
    },
    async verifyAccount(instanceUrl) {
      return {
        externalAccountId: options.accountId,
        externalAccountName: options.accountName || `user-${options.accountId}`,
        instanceUrl,
        instanceName: new URL(instanceUrl).hostname,
      };
    },
    async getStatusCharacterLimit() {
      return options.limit ?? 500;
    },
    async sendStatus() {
      throw new AdapterError('Not used in this test', 'instance_error');
    },
  };
}

function blueskyWith(overrides: Partial<BlueskyClientLike>): BlueskyClientLike {
  return {
    platform: 'bluesky',
    async createSession() {
      throw new AdapterError('Not used', 'auth_failed');
    },
    async getSession() {
      throw new AdapterError('Not used', 'revoked');
    },
    async refreshSession() {
      throw new AdapterError('Not used', 'revoked');
    },
    async sendPost() {
      throw new AdapterError('Not used', 'instance_error');
    },
    ...overrides,
  };
}

test('Bluesky account connection lifecycle keeps tokens encrypted', async (t) => {
  storage.reset();
  resetOAuthClientsForTests();
  resetMockBlueskyState();
  const seedData = await seed(701, 'bsky-lifecycle');
  const userId = String(seedData.owner.id);

  await t.test('connects with an app password and stores only ciphertext', async () => {
    const connection = await connectBlueskyAccount({
      userId,
      projectId: seedData.projectId,
      identifier: '@creator.test',
      appPassword: 'app-password-value',
    });

    assert.equal(connection.status, 'active');
    assert.equal(connection.externalAccountId, 'did:plc:creatortest');
    assert.equal(connection.externalAccountName, 'creator.test');
    assert.ok(!('accessTokenCiphertext' in connection));
    assert.ok(!('refreshTokenCiphertext' in connection));

    const stored = await storage.getPlatformConnectionById(connection.id);
    assert.ok(stored);
    assert.equal(stored.credentialProvider, 'local');
    assert.ok(stored.accessTokenCiphertext.startsWith('crewlink:v1:local:v1:'));
    assert.ok(stored.refreshTokenCiphertext);
    assert.ok(!stored.accessTokenCiphertext.includes('mock-bsky-access'));
    assert.ok(!JSON.stringify(stored).includes('app-password-value'));

    const tokens = await decryptConnectionTokens(stored);
    assert.ok(tokens.accessToken.startsWith('mock-bsky-access.'));
    assert.ok(tokens.refreshToken?.startsWith('mock-bsky-refresh.'));
  });

  await t.test('rejects bad credentials and pasted tokens without replacing the connection', async () => {
    await assert.rejects(
      () =>
        connectBlueskyAccount({
          userId,
          projectId: seedData.projectId,
          identifier: 'creator.test',
          appPassword: 'wrong-password',
        }),
      (err) => connectionCode(err) === 'invalid_credentials'
    );
    await assert.rejects(
      () =>
        saveConnection({
          userId,
          projectId: seedData.projectId,
          platformId: 'bluesky',
          accessToken: 'pasted-access-token',
        }),
      (err) => connectionCode(err) === 'invalid_input'
    );

    const connections = await listConnections(userId);
    assert.equal(connections.length, 1);
    assert.equal(connections[0].status, 'active');
    assert.ok(!JSON.stringify(connections).includes('mock-bsky-access'));
  });

  await t.test('enforces project ownership and connection ownership', async () => {
    await assert.rejects(
      () =>
        connectBlueskyAccount({
          userId,
          projectId: seedData.otherProjectId,
          identifier: 'creator.test',
          appPassword: 'app-password-value',
        }),
      (err) => connectionCode(err) === 'forbidden'
    );
    await assert.rejects(
      () =>
        connectBlueskyAccount({
          userId,
          projectId: 'prj_missing',
          identifier: 'creator.test',
          appPassword: 'app-password-value',
        }),
      (err) => connectionCode(err) === 'project_not_found'
    );

    const connection = (await listConnections(userId))[0];
    await assert.rejects(
      () => verifyConnection(String(seedData.other.id), connection.id),
      (err) => connectionCode(err) === 'connection_not_found'
    );
    await assert.rejects(
      () => disconnectConnection(String(seedData.other.id), connection.id),
      (err) => connectionCode(err) === 'connection_not_found'
    );
  });

  await t.test('verifies, disconnects and reconnects the same record', async () => {
    const connection = (await listConnections(userId))[0];
    const verified = await verifyConnection(userId, connection.id);
    assert.equal(verified.status, 'active');
    assert.equal(verified.externalAccountName, 'creator.test');

    await disconnectConnection(userId, connection.id);
    const disconnected = await storage.getPlatformConnectionById(connection.id);
    assert.equal(disconnected?.status, 'disconnected');
    assert.equal(disconnected?.accessTokenCiphertext, '');
    assert.equal(disconnected?.refreshTokenCiphertext, undefined);
    await assert.rejects(
      () => verifyConnection(userId, connection.id),
      (err) => connectionCode(err) === 'connection_inactive'
    );

    const reconnected = await connectBlueskyAccount({
      userId,
      projectId: seedData.projectId,
      identifier: 'creator.test',
      appPassword: 'app-password-value',
    });
    assert.equal(reconnected.id, connection.id);
    assert.equal(reconnected.status, 'active');
  });

  await t.test('a revoked session disconnects the account on verify', async () => {
    const connection = (await listConnections(userId))[0];
    setOAuthClientForTests(
      'bluesky',
      blueskyWith({
        async getSession() {
          throw new AdapterError('The Bluesky session is no longer valid.', 'revoked');
        },
        async refreshSession() {
          throw new AdapterError('The Bluesky session was revoked.', 'revoked');
        },
      })
    );
    try {
      await assert.rejects(
        () => verifyConnection(userId, connection.id),
        (err) => connectionCode(err) === 'invalid_credentials'
      );
      assert.equal(
        (await storage.getPlatformConnectionById(connection.id))?.status,
        'disconnected'
      );
    } finally {
      resetOAuthClientsForTests();
    }
  });
});

test('Bluesky approval invalidation and publishing', async (t) => {
  storage.reset();
  resetOAuthClientsForTests();
  resetMockBlueskyState();
  const seedData = await seed(711, 'bsky-publish');
  const userId = String(seedData.owner.id);

  await connectBlueskyAccount({
    userId,
    projectId: seedData.projectId,
    identifier: 'creator.test',
    appPassword: 'app-password-value',
  });

  const text = 'Join the rocket crew';
  const draft = await approvedDraft(seedData.projectId, 'bluesky', text);

  await t.test('re-authorising the same account keeps the approval', async () => {
    await connectBlueskyAccount({
      userId,
      projectId: seedData.projectId,
      identifier: 'creator.test',
      appPassword: 'app-password-value',
    });
    const stored = await storage.getDraftById(draft.id);
    assert.equal(stored?.status, 'approved');
  });

  await t.test('switching accounts invalidates approvals', async () => {
    await connectBlueskyAccount({
      userId,
      projectId: seedData.projectId,
      identifier: 'second.test',
      appPassword: 'app-password-value',
    });
    const stored = await storage.getDraftById(draft.id);
    assert.equal(stored?.status, 'drafted');
    assert.equal(stored?.approvedText, undefined);

    await assert.rejects(
      () => publishDraft({ userId, draftId: draft.id }),
      (err) => publishCode(err) === 'draft_not_approved'
    );
    await storage.approveDraft(draft.id, seedData.owner.login);
  });

  await t.test('publishes once and records no text or tokens', async () => {
    const result = await publishDraft({ userId, draftId: draft.id });
    assert.equal(result.publication.status, 'published');
    assert.ok(result.publication.externalId?.startsWith('at://'));
    assert.equal(result.publication.contentHash, sha256(text));
    assert.equal(result.publication.platformId, 'bluesky');

    const serialized = JSON.stringify(result.publication);
    assert.ok(!serialized.includes(text));
    assert.ok(!serialized.includes('mock-bsky-access'));
    assert.ok(!serialized.includes('Ciphertext'));

    await assert.rejects(
      () => publishDraft({ userId, draftId: draft.id }),
      (err) => publishCode(err) === 'already_published'
    );
  });
});

test('Bluesky publishing failure modes stay independent and fail safe', async (t) => {
  storage.reset();
  resetOAuthClientsForTests();
  resetMockBlueskyState();
  const seedData = await seed(721, 'bsky-failures');
  const userId = String(seedData.owner.id);

  const connection = await connectBlueskyAccount({
    userId,
    projectId: seedData.projectId,
    identifier: 'creator.test',
    appPassword: 'app-password-value',
  });

  await t.test('an ambiguous send stays sending and is never resent', async () => {
    const draft = await approvedDraft(seedData.projectId, 'bluesky', 'Join [mock-uncertain]');
    await assert.rejects(
      () => publishDraft({ userId, draftId: draft.id }),
      (err) => publishCode(err) === 'uncertain'
    );

    const row = await storage.getPublication(draft.id, 'bluesky');
    assert.equal(row?.status, 'sending');

    await assert.rejects(
      () => publishDraft({ userId, draftId: draft.id }),
      (err) => publishCode(err) === 'in_progress'
    );

    // A stale sending row surfaces as uncertain, not as a fresh send.
    row!.updatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await assert.rejects(
      () => publishDraft({ userId, draftId: draft.id }),
      (err) => publishCode(err) === 'uncertain'
    );
    assert.equal((await storage.getPublication(draft.id, 'bluesky'))?.status, 'sending');
  });

  await t.test('rate limits are definitive failures with a retry hint', async () => {
    const draft = await approvedDraft(seedData.projectId, 'bluesky', 'Join [mock-rate-limit]');
    await assert.rejects(
      () => publishDraft({ userId, draftId: draft.id }),
      (err) =>
        publishCode(err) === 'rate_limited' &&
        (err as PublishError).retryAfterSeconds === 5
    );
    const row = await storage.getPublication(draft.id, 'bluesky');
    assert.equal(row?.status, 'failed');
    assert.equal(row?.errorCode, 'rate_limited');
  });

  await t.test('oversized text is rejected before leaving Crewlink', async () => {
    const draft = await approvedDraft(seedData.projectId, 'bluesky', 'x'.repeat(301));
    await assert.rejects(
      () => publishDraft({ userId, draftId: draft.id }),
      (err) => publishCode(err) === 'invalid_post'
    );
    const row = await storage.getPublication(draft.id, 'bluesky');
    assert.equal(row?.status, 'failed');
    assert.equal(row?.errorCode, 'validation_error');
  });

  await t.test('a definitive platform error leaves the connection active', async () => {
    const draft = await approvedDraft(seedData.projectId, 'bluesky', 'Join [mock-fail]');
    await assert.rejects(
      () => publishDraft({ userId, draftId: draft.id }),
      (err) => publishCode(err) === 'platform_error'
    );
    const row = await storage.getPublication(draft.id, 'bluesky');
    assert.equal(row?.status, 'failed');
    assert.equal(row?.errorCode, 'instance_error');
    assert.equal(
      (await storage.getPlatformConnectionById(connection.id))?.status,
      'active'
    );
  });

  await t.test('a revoked session fails the publication and disconnects the account', async () => {
    setOAuthClientForTests(
      'bluesky',
      blueskyWith({
        async sendPost() {
          throw new AdapterError('The Bluesky session was revoked.', 'revoked');
        },
      })
    );
    try {
      const draft = await approvedDraft(seedData.projectId, 'bluesky', 'Join the crew');
      await assert.rejects(
        () => publishDraft({ userId, draftId: draft.id }),
        (err) => publishCode(err) === 'auth_revoked'
      );
      const row = await storage.getPublication(draft.id, 'bluesky');
      assert.equal(row?.status, 'failed');
      assert.equal(row?.errorCode, 'auth_revoked');
      assert.equal(
        (await storage.getPlatformConnectionById(connection.id))?.status,
        'disconnected'
      );
    } finally {
      resetOAuthClientsForTests();
    }
  });
});

test('Mastodon OAuth connection lifecycle stores only encrypted handshake data', async (t) => {
  storage.reset();
  resetOAuthClientsForTests();
  resetMockMastodonState();
  const seedData = await seed(731, 'masto-oauth');
  const userId = String(seedData.owner.id);

  await t.test('rejects an unsafe instance URL', async () => {
    await assert.rejects(
      () =>
        beginMastodonAuthorization({
          userId,
          projectId: seedData.projectId,
          instanceUrl: 'http://localhost:3000',
          sessionId: seedData.ownerSessionId,
        }),
      (err) => connectionCode(err) === 'invalid_input'
    );
  });

  let state = '';
  let connectionId = '';

  await t.test('starts an OAuth handshake with a hashed state', async () => {
    const result = await beginMastodonAuthorization({
      userId,
      projectId: seedData.projectId,
      instanceUrl: 'mastodon.test',
      sessionId: seedData.ownerSessionId,
    });
    const url = new URL(result.authorizationUrl);
    assert.equal(url.origin, 'https://mastodon.test');
    assert.equal(url.searchParams.get('scope'), 'read:accounts write:statuses');
    state = authorizationState(result.authorizationUrl);
    assert.ok(state.length >= 32);

    const stored = await storage.findPlatformConnection(
      userId,
      seedData.projectId,
      'mastodon'
    );
    assert.ok(stored);
    connectionId = stored.id;
    assert.equal(stored.status, 'pending');
    assert.equal(stored.instanceUrl, 'https://mastodon.test');
    assert.equal(stored.oauthStateHash, sha256(state));
    assert.notEqual(stored.oauthStateHash, state);
    assert.ok(stored.oauthStateExpiresAt);
    const pendingEnvelope = JSON.parse(stored.pendingOAuthCiphertext || '{}');
    assert.ok(String(pendingEnvelope.ciphertext).startsWith('crewlink:'));
    assert.equal(pendingEnvelope.provider, 'local');
    const serialized = JSON.stringify(stored);
    assert.ok(!serialized.includes(state));
    assert.ok(!serialized.includes('mock-mastodon-secret'));
  });

  await t.test('a different user cannot complete the handshake', async () => {
    await assert.rejects(
      () =>
        completeMastodonAuthorization({
          userId: String(seedData.other.id),
          state,
          code: 'code-1',
          sessionId: seedData.otherSessionId,
        }),
      (err) => connectionCode(err) === 'oauth_state_invalid'
    );
  });

  await t.test('completes the handshake and clears the pending fields', async () => {
    const connection = await completeMastodonAuthorization({
      userId,
      state,
      code: 'code-1',
      sessionId: seedData.ownerSessionId,
    });
    assert.equal(connection.id, connectionId);
    assert.equal(connection.status, 'active');
    assert.equal(connection.instanceUrl, 'https://mastodon.test');
    assert.equal(connection.externalAccountName, 'mockuser');
    assert.deepEqual(connection.scopes, ['read:accounts', 'write:statuses']);
    assert.equal(connection.tokenExpiresAt, undefined);

    const stored = await storage.getPlatformConnectionById(connectionId);
    assert.ok(stored?.accessTokenCiphertext.startsWith('crewlink:v1:local:v1:'));
    assert.equal(stored?.oauthStateHash, undefined);
    assert.equal(stored?.oauthStateExpiresAt, undefined);
    assert.equal(stored?.pendingOAuthCiphertext, undefined);
    assert.ok(!JSON.stringify(stored).includes('mock-mastodon-access'));

    const tokens = await decryptConnectionTokens(stored!);
    assert.ok(tokens.accessToken.startsWith('mock-mastodon-access-'));
    assert.equal(tokens.refreshToken, undefined);
  });

  await t.test('the state is single use', async () => {
    await assert.rejects(
      () =>
        completeMastodonAuthorization({
          userId,
          state,
          code: 'code-1',
          sessionId: seedData.ownerSessionId,
        }),
      (err) => connectionCode(err) === 'oauth_state_invalid'
    );
  });

  await t.test('verifies and reconnects the same record', async () => {
    const verified = await verifyConnection(userId, connectionId);
    assert.equal(verified.status, 'active');

    await disconnectConnection(userId, connectionId);
    assert.equal(
      (await storage.getPlatformConnectionById(connectionId))?.status,
      'disconnected'
    );

    const began = await beginMastodonAuthorization({
      userId,
      projectId: seedData.projectId,
      instanceUrl: 'https://mastodon.test/',
      sessionId: seedData.ownerSessionId,
    });
    const reconnected = await completeMastodonAuthorization({
      userId,
      state: authorizationState(began.authorizationUrl),
      code: 'code-2',
      sessionId: seedData.ownerSessionId,
    });
    assert.equal(reconnected.id, connectionId);
    assert.equal(reconnected.status, 'active');
  });

  await t.test('a denied callback clears the pending handshake', async () => {
    const began = await beginMastodonAuthorization({
      userId,
      projectId: seedData.projectId,
      instanceUrl: 'https://mastodon.test',
      sessionId: seedData.ownerSessionId,
    });
    const deniedState = authorizationState(began.authorizationUrl);
    await cancelMastodonAuthorization(deniedState);

    const stored = await storage.getPlatformConnectionById(connectionId);
    assert.equal(stored?.oauthStateHash, undefined);
    assert.equal(stored?.pendingOAuthCiphertext, undefined);
    await assert.rejects(
      () =>
        completeMastodonAuthorization({
          userId,
          state: deniedState,
          code: 'code-3',
          sessionId: seedData.ownerSessionId,
        }),
      (err) => connectionCode(err) === 'oauth_state_invalid'
    );
  });

  await t.test('an expired state is rejected and cleared', async () => {
    const began = await beginMastodonAuthorization({
      userId,
      projectId: seedData.projectId,
      instanceUrl: 'https://mastodon.test',
      sessionId: seedData.ownerSessionId,
    });
    const expiredState = authorizationState(began.authorizationUrl);
    const stored = await storage.getPlatformConnectionById(connectionId);
    await storage.upsertPlatformConnection({
      ...stored!,
      oauthStateExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    await assert.rejects(
      () =>
        completeMastodonAuthorization({
          userId,
          state: expiredState,
          code: 'code-4',
          sessionId: seedData.ownerSessionId,
        }),
      (err) => connectionCode(err) === 'oauth_state_invalid'
    );
    const after = await storage.getPlatformConnectionById(connectionId);
    assert.equal(after?.oauthStateHash, undefined);
    assert.equal(after?.pendingOAuthCiphertext, undefined);
  });

  await t.test('a rejected authorization code clears the pending handshake', async () => {
    const stub = mastodonStub({
      instanceUrl: 'https://mastodon.test',
      accountId: 'mock-mastodon-account',
    });
    setOAuthClientForTests('mastodon', {
      ...stub,
      async exchangeCode() {
        throw new AdapterError('The instance rejected the authorization code.', 'auth_failed');
      },
    });
    try {
      const began = await beginMastodonAuthorization({
        userId,
        projectId: seedData.projectId,
        instanceUrl: 'https://mastodon.test',
        sessionId: seedData.ownerSessionId,
      });
      const codeState = authorizationState(began.authorizationUrl);
      await assert.rejects(
        () =>
          completeMastodonAuthorization({
            userId,
            state: codeState,
            code: 'rejected-code',
            sessionId: seedData.ownerSessionId,
          }),
        (err) => connectionCode(err) === 'invalid_credentials'
      );

      const stored = await storage.getPlatformConnectionById(connectionId);
      assert.equal(stored?.oauthStateHash, undefined);
      assert.equal(stored?.pendingOAuthCiphertext, undefined);
    } finally {
      resetOAuthClientsForTests();
    }
  });

  await t.test('a revoked token disconnects the account on verify', async () => {
    const stub = mastodonStub({
      instanceUrl: 'https://mastodon.test',
      accountId: 'mock-mastodon-account',
    });
    setOAuthClientForTests('mastodon', {
      ...stub,
      async verifyAccount() {
        throw new AdapterError('The Mastodon access token was revoked.', 'revoked');
      },
    });
    try {
      await assert.rejects(
        () => verifyConnection(userId, connectionId),
        (err) => connectionCode(err) === 'invalid_credentials'
      );
      assert.equal(
        (await storage.getPlatformConnectionById(connectionId))?.status,
        'disconnected'
      );
    } finally {
      resetOAuthClientsForTests();
    }
  });
});

test('Mastodon OAuth state is session-bound and single-use under concurrency', async (t) => {
  storage.reset();
  resetOAuthClientsForTests();
  const seedData = await seed(736, 'masto-state');
  const userId = String(seedData.owner.id);
  const instance = 'https://mastodon.test';

  await t.test('another session of the same user cannot redeem the state', async () => {
    let exchanges = 0;
    setOAuthClientForTests('mastodon', {
      ...mastodonStub({ instanceUrl: instance, accountId: '1' }),
      async exchangeCode() {
        exchanges += 1;
        return { accessToken: 'token', scopes: ['read:accounts', 'write:statuses'] };
      },
    });

    const began = await beginMastodonAuthorization({
      userId,
      projectId: seedData.projectId,
      instanceUrl: instance,
      sessionId: seedData.ownerSessionId,
    });
    const state = authorizationState(began.authorizationUrl);
    const secondSession = await storage.createSession(seedData.owner.id);

    await assert.rejects(
      () =>
        completeMastodonAuthorization({
          userId,
          state,
          code: 'code',
          sessionId: secondSession,
        }),
      (err) => connectionCode(err) === 'oauth_state_invalid'
    );
    assert.equal(exchanges, 0, 'the code must not be exchanged for another session');

    const stored = await storage.findPlatformConnection(userId, seedData.projectId, 'mastodon');
    assert.equal(stored?.oauthStateHash, undefined);
    assert.equal(stored?.pendingOAuthCiphertext, undefined);
  });

  await t.test('another user cannot cancel the pending handshake', async () => {
    setOAuthClientForTests('mastodon', mastodonStub({ instanceUrl: instance, accountId: '1' }));
    const began = await beginMastodonAuthorization({
      userId,
      projectId: seedData.projectId,
      instanceUrl: instance,
      sessionId: seedData.ownerSessionId,
    });
    const state = authorizationState(began.authorizationUrl);

    await cancelMastodonAuthorization(state, { userId: String(seedData.other.id) });
    const stored = await storage.findPlatformConnection(userId, seedData.projectId, 'mastodon');
    assert.equal(stored?.oauthStateHash, sha256(state));

    await cancelMastodonAuthorization(state);
  });

  await t.test('concurrent callbacks exchange the code exactly once', async () => {
    let exchanges = 0;
    setOAuthClientForTests('mastodon', {
      ...mastodonStub({ instanceUrl: instance, accountId: '1' }),
      async exchangeCode() {
        exchanges += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { accessToken: 'token-once', scopes: ['read:accounts', 'write:statuses'] };
      },
    });

    const began = await beginMastodonAuthorization({
      userId,
      projectId: seedData.projectId,
      instanceUrl: instance,
      sessionId: seedData.ownerSessionId,
    });
    const state = authorizationState(began.authorizationUrl);

    const outcomes = await Promise.allSettled([
      completeMastodonAuthorization({ userId, state, code: 'code', sessionId: seedData.ownerSessionId }),
      completeMastodonAuthorization({ userId, state, code: 'code', sessionId: seedData.ownerSessionId }),
    ]);
    assert.equal(exchanges, 1);

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
    );
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(connectionCode(rejected[0].reason), 'oauth_state_invalid');

    const stored = await storage.findPlatformConnection(userId, seedData.projectId, 'mastodon');
    assert.equal(stored?.status, 'active');
    assert.equal(stored?.oauthStateHash, undefined);
  });
});

test('Mastodon destination changes invalidate approvals', async (t) => {
  storage.reset();
  resetOAuthClientsForTests();
  const seedData = await seed(741, 'masto-destination');
  const userId = String(seedData.owner.id);
  const instanceA = 'https://alpha.example';
  const instanceB = 'https://beta.example';

  setOAuthClientForTests('mastodon', mastodonStub({ instanceUrl: instanceA, accountId: '1' }));
  try {
    const began = await beginMastodonAuthorization({
      userId,
      projectId: seedData.projectId,
      instanceUrl: instanceA,
      sessionId: seedData.ownerSessionId,
    });
    await completeMastodonAuthorization({
      userId,
      state: authorizationState(began.authorizationUrl),
      code: 'a-1',
      sessionId: seedData.ownerSessionId,
    });

    const draft = await approvedDraft(seedData.projectId, 'mastodon', 'Join the rocket crew');

    await t.test('reconnecting the same account and instance keeps approval', async () => {
      const again = await beginMastodonAuthorization({
        userId,
        projectId: seedData.projectId,
        instanceUrl: instanceA,
        sessionId: seedData.ownerSessionId,
      });
      await completeMastodonAuthorization({
        userId,
        state: authorizationState(again.authorizationUrl),
        code: 'a-2',
        sessionId: seedData.ownerSessionId,
      });
      assert.equal((await storage.getDraftById(draft.id))?.status, 'approved');
    });

    await t.test('a different account on another instance invalidates approval', async () => {
      setOAuthClientForTests('mastodon', mastodonStub({ instanceUrl: instanceB, accountId: '2' }));
      const other = await beginMastodonAuthorization({
        userId,
        projectId: seedData.projectId,
        instanceUrl: instanceB,
        sessionId: seedData.ownerSessionId,
      });
      const connection = await completeMastodonAuthorization({
        userId,
        state: authorizationState(other.authorizationUrl),
        code: 'b-1',
        sessionId: seedData.ownerSessionId,
      });

      assert.equal(connection.instanceUrl, instanceB);
      assert.equal(connection.externalAccountId, '2');
      const stored = await storage.getDraftById(draft.id);
      assert.equal(stored?.status, 'drafted');
      assert.equal(stored?.approvedText, undefined);

      await assert.rejects(
        () => publishDraft({ userId, draftId: draft.id }),
        (err) => publishCode(err) === 'draft_not_approved'
      );
    });
  } finally {
    resetOAuthClientsForTests();
  }
});

test('Mastodon publishing uses the instance limit and never leaks credentials', async (t) => {
  storage.reset();
  resetOAuthClientsForTests();
  const seedData = await seed(751, 'masto-publish');
  const userId = String(seedData.owner.id);
  const instance = 'https://mastodon.test';
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/v1/apps')) {
      return json({
        client_id: 'real-client-id',
        client_secret: 'real-client-secret',
        redirect_uri: 'https://crewlink.test/callback',
      });
    }
    if (url.endsWith('/oauth/token')) {
      return json({ access_token: 'real-access-token', scope: 'read:accounts write:statuses' });
    }
    if (url.endsWith('/api/v1/accounts/verify_credentials')) {
      return json({ id: '42', acct: 'alice' });
    }
    if (url.endsWith('/api/v2/instance')) {
      return json({ configuration: { statuses: { max_characters: 40 } } });
    }
    if (url.endsWith('/api/v1/statuses')) {
      const body = JSON.parse(String(init?.body || '{}')) as { status?: string };
      if (body.status === 'uncertain-status-text') throw new Error('network down');
      if (body.status === 'rate-limited-status') {
        return json({}, 429, { 'retry-after': '9' });
      }
      if (body.status === 'revoked-status-text') return json({}, 401);
      return json({ id: '900', url: 'https://mastodon.test/@alice/900' });
    }
    return json({}, 404);
  };

  setOAuthClientForTests(
    'mastodon',
    new MastodonClient({ fetchImpl, lookup: publicLookup })
  );
  try {
    const began = await beginMastodonAuthorization({
      userId,
      projectId: seedData.projectId,
      instanceUrl: instance,
      sessionId: seedData.ownerSessionId,
    });
    const connection = await completeMastodonAuthorization({
      userId,
      state: authorizationState(began.authorizationUrl),
      code: 'code',
      sessionId: seedData.ownerSessionId,
    });
    assert.equal(connection.status, 'active');

    await t.test('rejects text over the connected instance limit', async () => {
      const draft = await approvedDraft(seedData.projectId, 'mastodon', 'x'.repeat(41));
      await assert.rejects(
        () => publishDraft({ userId, draftId: draft.id }),
        (err) => publishCode(err) === 'invalid_post'
      );
      assert.equal(
        (await storage.getPublication(draft.id, 'mastodon'))?.errorCode,
        'validation_error'
      );
      assert.equal(calls.filter((call) => call.url.endsWith('/api/v1/statuses')).length, 0);
    });

    await t.test('publishes with an idempotency key and no leakage', async () => {
      const text = 'Join the rocket crew';
      const draft = await approvedDraft(seedData.projectId, 'mastodon', text);
      const result = await publishDraft({ userId, draftId: draft.id });

      assert.equal(result.publication.status, 'published');
      assert.equal(result.publication.externalId, '900');
      assert.equal(result.publication.contentHash, sha256(text));
      const serialized = JSON.stringify(result.publication);
      assert.ok(!serialized.includes(text));
      assert.ok(!serialized.includes('real-access-token'));
      assert.ok(!serialized.includes('real-client-secret'));

      const statusCall = calls.find((call) => call.url.endsWith('/api/v1/statuses'));
      const headers = statusCall?.init?.headers as Record<string, string>;
      assert.equal(headers.authorization, 'Bearer real-access-token');
      assert.equal(headers['idempotency-key'], result.publication.id);

      await assert.rejects(
        () => publishDraft({ userId, draftId: draft.id }),
        (err) => publishCode(err) === 'already_published'
      );
    });

    await t.test('maps rate limits and ambiguous sends', async () => {
      const limited = await approvedDraft(seedData.projectId, 'mastodon', 'rate-limited-status');
      await assert.rejects(
        () => publishDraft({ userId, draftId: limited.id }),
        (err) =>
          publishCode(err) === 'rate_limited' &&
          (err as PublishError).retryAfterSeconds === 9
      );
      assert.equal(
        (await storage.getPublication(limited.id, 'mastodon'))?.status,
        'failed'
      );

      const uncertain = await approvedDraft(
        seedData.projectId,
        'mastodon',
        'uncertain-status-text'
      );
      await assert.rejects(
        () => publishDraft({ userId, draftId: uncertain.id }),
        (err) => publishCode(err) === 'uncertain'
      );
      assert.equal(
        (await storage.getPublication(uncertain.id, 'mastodon'))?.status,
        'sending'
      );
    });

    await t.test('a revoked token disconnects the account', async () => {
      const draft = await approvedDraft(seedData.projectId, 'mastodon', 'revoked-status-text');
      await assert.rejects(
        () => publishDraft({ userId, draftId: draft.id }),
        (err) => publishCode(err) === 'auth_revoked'
      );
      assert.equal(
        (await storage.getPublication(draft.id, 'mastodon'))?.errorCode,
        'auth_revoked'
      );
      assert.equal(
        (await storage.getPlatformConnectionById(connection.id))?.status,
        'disconnected'
      );
    });
  } finally {
    resetOAuthClientsForTests();
  }
});

test('A failing account platform never blocks the other platform', async () => {
  storage.reset();
  resetOAuthClientsForTests();
  resetMockBlueskyState();
  resetMockMastodonState();
  const seedData = await seed(761, 'independent');
  const userId = String(seedData.owner.id);

  await connectBlueskyAccount({
    userId,
    projectId: seedData.projectId,
    identifier: 'creator.test',
    appPassword: 'app-password-value',
  });
  const began = await beginMastodonAuthorization({
    userId,
    projectId: seedData.projectId,
    instanceUrl: 'https://mastodon.test',
    sessionId: seedData.ownerSessionId,
  });
  await completeMastodonAuthorization({
    userId,
    state: authorizationState(began.authorizationUrl),
    code: 'code',
    sessionId: seedData.ownerSessionId,
  });

  const blueskyDraft = await approvedDraft(
    seedData.projectId,
    'bluesky',
    'Join [mock-fail]'
  );
  const mastodonDraft = await approvedDraft(
    seedData.projectId,
    'mastodon',
    'Join the rocket crew'
  );

  await assert.rejects(
    () => publishDraft({ userId, draftId: blueskyDraft.id }),
    (err) => publishCode(err) === 'platform_error'
  );

  const mastodon = await publishDraft({ userId, draftId: mastodonDraft.id });
  assert.equal(mastodon.publication.status, 'published');
  assert.equal(mastodon.publication.platformId, 'mastodon');
  assert.equal((await storage.getPublication(blueskyDraft.id, 'bluesky'))?.status, 'failed');
});

test('Account connection APIs never return or log credential material', async (t) => {
  storage.reset();
  resetOAuthClientsForTests();
  resetMockBlueskyState();
  resetMockMastodonState();
  const seedData = await seed(771, 'account-api');
  const ownerId = String(seedData.owner.id);

  const post = (body: unknown, cookie = seedData.ownerCookie) =>
    new NextRequest('http://localhost:3000/api/platforms/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
  const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) });

  await t.test('requires a session and valid input', async () => {
    const anonymous = await connectConnectionRoute(
      post(
        { projectId: seedData.projectId, platformId: 'bluesky', identifier: 'a', appPassword: 'b' },
        ''
      )
    );
    assert.equal(anonymous.status, 401);

    const missing = await connectConnectionRoute(
      post({ projectId: seedData.projectId, platformId: 'bluesky', identifier: 'creator.test' })
    );
    assert.equal(missing.status, 400);

    const otherProject = await connectConnectionRoute(
      post({
        projectId: seedData.otherProjectId,
        platformId: 'bluesky',
        identifier: 'creator.test',
        appPassword: 'app-password-value',
      })
    );
    assert.equal(otherProject.status, 403);

    const otherMastodon = await connectConnectionRoute(
      post({
        projectId: seedData.otherProjectId,
        platformId: 'mastodon',
        instanceUrl: 'https://mastodon.test',
      })
    );
    assert.equal(otherMastodon.status, 403);
  });

  let connectionId = '';

  await t.test('connects Bluesky without echoing the app password', async () => {
    const res = await connectConnectionRoute(
      post({
        projectId: seedData.projectId,
        platformId: 'bluesky',
        identifier: 'creator.test',
        appPassword: 'app-password-value',
      })
    );
    assert.equal(res.status, 201);
    const raw = await res.text();
    assert.ok(!raw.includes('app-password-value'));
    assert.ok(!raw.includes('mock-bsky-access'));
    assert.ok(!raw.includes('Ciphertext'));
    assert.ok(!raw.includes('keyRef'));

    const data = JSON.parse(raw);
    connectionId = data.connection.id;
    assert.equal(data.connection.status, 'active');
    assert.equal(data.connection.externalAccountName, 'creator.test');
  });

  await t.test('maps invalid Bluesky credentials to 400 without echoing them', async () => {
    const res = await connectConnectionRoute(
      post({
        projectId: seedData.projectId,
        platformId: 'bluesky',
        identifier: 'creator.test',
        appPassword: 'wrong-password',
      })
    );
    assert.equal(res.status, 400);
    const raw = await res.text();
    assert.ok(!raw.includes('wrong-password'));
    assert.equal(JSON.parse(raw).code, 'invalid_credentials');
  });

  await t.test('the verify route enforces ownership', async () => {
    const theirs = await verifyConnectionRoute(
      new NextRequest(
        `http://localhost:3000/api/platforms/connections/${connectionId}/verify`,
        { method: 'POST', headers: { cookie: seedData.otherCookie } }
      ),
      paramsFor(connectionId)
    );
    assert.equal(theirs.status, 404);

    const mine = await verifyConnectionRoute(
      new NextRequest(
        `http://localhost:3000/api/platforms/connections/${connectionId}/verify`,
        { method: 'POST', headers: { cookie: seedData.ownerCookie } }
      ),
      paramsFor(connectionId)
    );
    assert.equal(mine.status, 200);
    assert.ok(!(await mine.text()).includes('mock-bsky-access'));
  });

  await t.test('lists connections without token fields', async () => {
    const res = await listConnectionsRoute(
      new NextRequest(
        `http://localhost:3000/api/platforms/connections?projectId=${seedData.projectId}`,
        { headers: { cookie: seedData.ownerCookie } }
      )
    );
    assert.equal(res.status, 200);
    const raw = await res.text();
    assert.ok(!raw.includes('Ciphertext'));
    assert.ok(!raw.includes('keyRef'));
    assert.equal(JSON.parse(raw).connections.length, 1);
  });

  let mastodonState = '';

  await t.test('starts Mastodon OAuth without returning a client secret', async () => {
    const res = await connectConnectionRoute(
      post({
        projectId: seedData.projectId,
        platformId: 'mastodon',
        instanceUrl: 'https://mastodon.test',
      })
    );
    assert.equal(res.status, 200);
    const raw = await res.text();
    assert.ok(!raw.includes('mock-mastodon-secret'));
    const data = JSON.parse(raw);
    const url = new URL(data.authorizationUrl);
    assert.equal(url.origin, 'https://mastodon.test');
    mastodonState = authorizationState(data.authorizationUrl);
    assert.ok(mastodonState);
  });

  const callbackRequest = (query: string, cookie = seedData.ownerCookie) =>
    new NextRequest(`http://localhost:3000/api/platforms/mastodon/callback?${query}`, {
      headers: cookie ? { cookie } : {},
    });

  await t.test('the callback completes the connection and redirects', async () => {
    const res = await mastodonCallbackRoute(
      callbackRequest(`state=${encodeURIComponent(mastodonState)}&code=code-1`)
    );
    assert.equal(res.status, 307);
    const location = new URL(res.headers.get('location') || '');
    assert.equal(location.pathname, '/publishing');
    assert.equal(location.searchParams.get('mastodon'), 'connected');
    assert.equal(location.searchParams.get('account'), 'mockuser');

    await assert.rejects(
      () =>
        completeMastodonAuthorization({
          userId: ownerId,
          state: mastodonState,
          code: 'again',
          sessionId: seedData.ownerSessionId,
        }),
      (err) => connectionCode(err) === 'oauth_state_invalid'
    );
  });

  await t.test('the callback redirect ignores attacker-controlled host headers', async () => {
    const started = await connectConnectionRoute(
      post({
        projectId: seedData.projectId,
        platformId: 'mastodon',
        instanceUrl: 'https://mastodon.test',
      })
    );
    assert.equal(started.status, 200);
    const state = authorizationState((await started.json()).authorizationUrl);

    const res = await mastodonCallbackRoute(
      new NextRequest(
        `https://evil.example/api/platforms/mastodon/callback?state=${encodeURIComponent(state)}&code=code-2`,
        {
          headers: {
            cookie: seedData.ownerCookie,
            host: 'evil.example',
            'x-forwarded-host': 'evil.example',
          },
        }
      )
    );
    assert.equal(res.status, 307);
    const location = new URL(res.headers.get('location') || '');
    assert.equal(location.origin, new URL(config.appUrl).origin);
    assert.equal(location.pathname, '/publishing');
    assert.equal(location.searchParams.get('mastodon'), 'connected');
  });

  await t.test('a denied callback redirects and clears the pending state', async () => {
    const started = await connectConnectionRoute(
      post({
        projectId: seedData.projectId,
        platformId: 'mastodon',
        instanceUrl: 'https://mastodon.test',
      })
    );
    const state = authorizationState((await started.json()).authorizationUrl);

    const res = await mastodonCallbackRoute(
      callbackRequest(`state=${encodeURIComponent(state)}&error=access_denied`)
    );
    const location = new URL(res.headers.get('location') || '');
    assert.equal(location.searchParams.get('mastodon'), 'denied');

    const stored = await storage.findPlatformConnection(
      ownerId,
      seedData.projectId,
      'mastodon'
    );
    assert.equal(stored?.oauthStateHash, undefined);
  });

  await t.test('a callback without a session clears the pending state', async () => {
    const started = await connectConnectionRoute(
      post({
        projectId: seedData.projectId,
        platformId: 'mastodon',
        instanceUrl: 'https://mastodon.test',
      })
    );
    const state = authorizationState((await started.json()).authorizationUrl);

    const res = await mastodonCallbackRoute(
      callbackRequest(`state=${encodeURIComponent(state)}&code=code-2`, '')
    );
    const location = new URL(res.headers.get('location') || '');
    assert.equal(location.searchParams.get('mastodon'), 'error');
    assert.equal(location.searchParams.get('reason'), 'session');

    const stored = await storage.findPlatformConnection(
      ownerId,
      seedData.projectId,
      'mastodon'
    );
    assert.equal(stored?.oauthStateHash, undefined);
  });

  await t.test('publishes through the API without echoing text or credentials', async () => {
    // The denied callback above left the earlier connection active; approve afresh.
    const draft = await approvedDraft(
      seedData.projectId,
      'mastodon',
      'Join the rocket crew'
    );
    const res = await publishRoute(
      new NextRequest(`http://localhost:3000/api/drafts/${draft.id}/publish`, {
        method: 'POST',
        headers: { cookie: seedData.ownerCookie },
      }),
      paramsFor(draft.id)
    );
    assert.equal(res.status, 200);
    const raw = await res.text();
    assert.ok(!raw.includes('Join the rocket crew'));
    assert.ok(!raw.includes('mock-mastodon-access'));
    assert.ok(!raw.includes('Ciphertext'));
    assert.equal(JSON.parse(raw).publication.status, 'published');
  });

  await t.test('the owner can disconnect after publishing', async () => {
    const mastodon = await storage.findPlatformConnection(
      ownerId,
      seedData.projectId,
      'mastodon'
    );
    const res = await disconnectConnectionRoute(
      new NextRequest(
        `http://localhost:3000/api/platforms/connections/${mastodon!.id}`,
        { method: 'DELETE', headers: { cookie: seedData.ownerCookie } }
      ),
      paramsFor(mastodon!.id)
    );
    assert.equal(res.status, 200);
    assert.equal(
      (await storage.getPlatformConnectionById(mastodon!.id))?.accessTokenCiphertext,
      ''
    );
  });
});

test('Bluesky account switching invalidates approvals after a disconnect', async () => {
  storage.reset();
  resetOAuthClientsForTests();
  resetMockBlueskyState();
  const seedData = await seed(781, 'bsky-switch');
  const userId = String(seedData.owner.id);

  const connection = await connectBlueskyAccount({
    userId,
    projectId: seedData.projectId,
    identifier: 'creator.test',
    appPassword: 'app-password-value',
  });
  const draft = await approvedDraft(seedData.projectId, 'bluesky', 'Join the rocket crew');

  await disconnectConnection(userId, connection.id);
  await connectBlueskyAccount({
    userId,
    projectId: seedData.projectId,
    identifier: 'second.test',
    appPassword: 'app-password-value',
  });

  const stored = await storage.getDraftById(draft.id);
  assert.equal(stored?.status, 'drafted');
  assert.equal(stored?.approvedText, undefined);
});

test('Refreshed tokens never overwrite newer tokens or a disconnected account', async () => {
  storage.reset();
  resetOAuthClientsForTests();
  resetMockBlueskyState();
  const seedData = await seed(786, 'bsky-cas');
  const userId = String(seedData.owner.id);

  const connection = await connectBlueskyAccount({
    userId,
    projectId: seedData.projectId,
    identifier: 'creator.test',
    appPassword: 'app-password-value',
  });
  const first = (await storage.getPlatformConnectionById(connection.id))!;
  const stale = (await storage.getPlatformConnectionById(connection.id))!;

  await persistConnectionTokens(first, {
    accessToken: 'newer-access-token',
    refreshToken: 'newer-refresh-token',
  });
  // The second caller started from the older session and must lose the race.
  const result = await persistConnectionTokens(stale, {
    accessToken: 'older-access-token',
    refreshToken: 'older-refresh-token',
  });
  const latest = (await storage.getPlatformConnectionById(connection.id))!;
  const tokens = await decryptConnectionTokens(latest);
  assert.equal(tokens.accessToken, 'newer-access-token');
  assert.equal(tokens.refreshToken, 'newer-refresh-token');
  assert.equal(result.accessTokenCiphertext, latest.accessTokenCiphertext);

  // Tokens are never restored onto a disconnected connection.
  await disconnectConnection(userId, connection.id);
  await persistConnectionTokens(stale, {
    accessToken: 'revived-access-token',
    refreshToken: 'revived-refresh-token',
  });
  const after = (await storage.getPlatformConnectionById(connection.id))!;
  assert.equal(after.status, 'disconnected');
  assert.equal(after.accessTokenCiphertext, '');
  assert.equal(after.refreshTokenCiphertext, undefined);
});

test('A failed publication after a token refresh keeps the rotated tokens', async () => {
  storage.reset();
  resetOAuthClientsForTests();
  resetMockBlueskyState();
  const seedData = await seed(791, 'bsky-refresh-fail');
  const userId = String(seedData.owner.id);

  const connection = await connectBlueskyAccount({
    userId,
    projectId: seedData.projectId,
    identifier: 'creator.test',
    appPassword: 'app-password-value',
  });

  setOAuthClientForTests(
    'bluesky',
    blueskyWith({
      async sendPost() {
        // The adapter refreshed before the platform rejected the post.
        throw new AdapterError('Bluesky returned an unexpected error.', 'instance_error', undefined, {
          accessToken: 'rotated-access-token',
          refreshToken: 'rotated-refresh-token',
        });
      },
    })
  );
  try {
    const draft = await approvedDraft(seedData.projectId, 'bluesky', 'Join the rocket crew');
    await assert.rejects(
      () => publishDraft({ userId, draftId: draft.id }),
      (err) => publishCode(err) === 'platform_error'
    );

    assert.equal((await storage.getPublication(draft.id, 'bluesky'))?.status, 'failed');
    assert.equal(
      (await storage.getPlatformConnectionById(connection.id))?.status,
      'active'
    );
    const tokens = await decryptConnectionTokens(
      (await storage.getPlatformConnectionById(connection.id))!
    );
    assert.equal(tokens.accessToken, 'rotated-access-token');
    assert.equal(tokens.refreshToken, 'rotated-refresh-token');
  } finally {
    resetOAuthClientsForTests();
  }
});

test('The logger redacts credential fields', () => {
  const originalEnv = process.env.NODE_ENV;
  const captured: string[] = [];
  const original = {
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const capture = (value: unknown) => {
    captured.push(String(value));
  };

  console.info = capture;
  console.warn = capture;
  console.error = capture;
  console.debug = capture;
  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';

  try {
    logger.info('Bluesky connect', {
      userId: 'user-1',
      appPassword: 'app-password-value',
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value',
      clientSecret: 'client-secret-value',
      pendingOAuthCiphertext: 'ciphertext-value',
    });
    logger.warn('Publication failed', {
      publicationId: 'pub_1',
      authorization: 'Bearer access-token-value',
    });
  } finally {
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
    console.debug = original.debug;
    (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
  }

  const output = captured.join('\n');
  assert.ok(output.includes('user-1'));
  assert.ok(output.includes('pub_1'));
  for (const secret of [
    'app-password-value',
    'access-token-value',
    'refresh-token-value',
    'client-secret-value',
    'ciphertext-value',
  ]) {
    assert.ok(!output.includes(secret), `${secret} leaked into logs`);
  }
  assert.ok(output.includes('[REDACTED]'));
});
