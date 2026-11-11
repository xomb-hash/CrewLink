import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { storage } from '../src/lib/storage';
import {
  beginRedditAuthorization,
  cancelRedditAuthorization,
  completeRedditAuthorization,
  ConnectionError,
  disconnectConnection,
  getConnectionToken,
  verifyConnection,
} from '../src/posting/connections';
import {
  AdapterError,
  MockRedditClient,
  mockRedditClient,
  resetMockRedditState,
  setOAuthClientForTests,
} from '../src/posting/adapters';

const code = (err: unknown) => (err instanceof ConnectionError ? err.code : 'unexpected');

async function begin(
  userId: string,
  projectId: string,
  sessionId = 'session-owner'
): Promise<string> {
  const { authorizationUrl } = await beginRedditAuthorization({ userId, projectId, sessionId });
  const state = new URL(authorizationUrl).searchParams.get('state') || '';
  assert.ok(state, 'the authorization URL must carry a state');
  return state;
}

test('Reddit OAuth keeps state and tokens server-side', async (t) => {
  storage.reset();
  resetMockRedditState();
  setOAuthClientForTests('reddit', mockRedditClient);

  const owner = await storage.saveUser({ id: 1101, login: 'reddit-oauth-owner' });
  const other = await storage.saveUser({ id: 1102, login: 'reddit-oauth-other' });
  const ownerId = owner.id as string;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'reddit-oauth-owner/rocket',
    repoName: 'rocket',
    repoOwner: 'reddit-oauth-owner',
    title: 'Rocket',
  });

  let connectionId = '';

  await t.test('begin requests the minimum scopes and stores only a state hash', async () => {
    const { authorizationUrl } = await beginRedditAuthorization({
      userId: ownerId,
      projectId: project.id,
      sessionId: 'session-owner',
    });
    const url = new URL(authorizationUrl);
    const state = url.searchParams.get('state') || '';

    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), 'test-reddit-client-id');
    assert.equal(url.searchParams.get('duration'), 'permanent');
    assert.equal(url.searchParams.get('scope'), 'identity read submit');
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'http://localhost:3100/api/platforms/reddit/callback'
    );

    const stored = await storage.findPlatformConnection(ownerId, project.id, 'reddit');
    assert.equal(stored?.status, 'pending');
    assert.equal(stored?.oauthStateHash?.length, 64);
    assert.notEqual(stored?.oauthStateHash, state);
    assert.ok(!String(stored?.oauthStateHash).includes(state));
    const envelope = JSON.parse(String(stored?.pendingOAuthCiphertext)) as {
      ciphertext: string;
      provider: string;
    };
    assert.equal(envelope.provider, 'local');
    assert.ok(envelope.ciphertext.startsWith('crewlink:v1:'));
    assert.ok(!JSON.stringify(stored).includes(state));
  });

  await t.test('a mismatched session cannot complete the authorization', async () => {
    const state = await begin(ownerId, project.id);
    await assert.rejects(
      () =>
        completeRedditAuthorization({
          userId: ownerId,
          state,
          code: 'code',
          sessionId: 'a-different-session',
        }),
      (err) => code(err) === 'oauth_state_invalid'
    );
    const stored = await storage.findPlatformConnection(ownerId, project.id, 'reddit');
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.pendingOAuthCiphertext, undefined);
  });

  await t.test('an unknown or replayed state is rejected', async () => {
    await assert.rejects(
      () =>
        completeRedditAuthorization({
          userId: ownerId,
          state: 'f'.repeat(64),
          code: 'code',
          sessionId: 'session-owner',
        }),
      (err) => code(err) === 'oauth_state_invalid'
    );

    const state = await begin(ownerId, project.id);
    const connection = await completeRedditAuthorization({
      userId: ownerId,
      state,
      code: 'code',
      sessionId: 'session-owner',
    });
    connectionId = connection.id;

    await assert.rejects(
      () =>
        completeRedditAuthorization({
          userId: ownerId,
          state,
          code: 'code',
          sessionId: 'session-owner',
        }),
      (err) => code(err) === 'oauth_state_invalid'
    );
  });

  await t.test('a successful callback stores encrypted tokens and a safe summary', async () => {
    assert.ok(connectionId.startsWith('pcn_'));
    const stored = await storage.getPlatformConnectionById(connectionId);
    assert.equal(stored?.status, 'active');
    assert.equal(stored?.externalAccountId, 'mock-reddit-user');
    assert.equal(stored?.externalAccountName, 'mock_reddit_user');
    assert.deepEqual(stored?.scopes, ['identity', 'read', 'submit']);
    assert.equal(stored?.oauthStateHash, undefined);
    assert.equal(stored?.pendingOAuthCiphertext, undefined);
    assert.equal(stored?.credentialProvider, 'local');
    assert.ok(stored?.accessTokenCiphertext.startsWith('crewlink:v1:'));
    assert.ok(!String(stored?.accessTokenCiphertext).includes('mock-reddit-access'));
    assert.ok(!String(stored?.refreshTokenCiphertext).includes('mock-reddit-refresh-0'));

    const tokens = await getConnectionToken(ownerId, connectionId);
    assert.equal(tokens.accessToken, 'mock-reddit-access');
    assert.equal(tokens.refreshToken, 'mock-reddit-refresh-0');
    assert.equal(tokens.platformId, 'reddit');
  });

  await t.test('an expired handshake is consumed and disconnected', async () => {
    const expiredProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'reddit-oauth-owner/expired',
      repoName: 'expired',
      repoOwner: 'reddit-oauth-owner',
      title: 'Expired',
    });
    const state = await begin(ownerId, expiredProject.id);
    const stored = await storage.findPlatformConnection(ownerId, expiredProject.id, 'reddit');
    assert.ok(stored);
    await storage.upsertPlatformConnection({
      ...stored,
      oauthStateExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    await assert.rejects(
      () =>
        completeRedditAuthorization({
          userId: ownerId,
          state,
          code: 'code',
          sessionId: 'session-owner',
        }),
      (err) => code(err) === 'oauth_state_invalid'
    );
    const after = await storage.getPlatformConnectionById(stored.id);
    assert.equal(after?.status, 'disconnected');
    assert.equal(after?.pendingOAuthCiphertext, undefined);
  });

  await t.test('a failed code exchange clears the pending handshake', async () => {
    const failProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'reddit-oauth-owner/fail',
      repoName: 'fail',
      repoOwner: 'reddit-oauth-owner',
      title: 'Fail',
    });
    const state = await begin(ownerId, failProject.id);

    class FailingExchangeClient extends MockRedditClient {
      override async exchangeCode(): Promise<never> {
        throw new AdapterError('Reddit rejected the authorization code.', 'validation_error');
      }
    }
    setOAuthClientForTests('reddit', new FailingExchangeClient());

    await assert.rejects(
      () =>
        completeRedditAuthorization({
          userId: ownerId,
          state,
          code: 'bad-code',
          sessionId: 'session-owner',
        }),
      (err) => code(err) === 'invalid_input'
    );
    setOAuthClientForTests('reddit', mockRedditClient);

    const stored = await storage.findPlatformConnection(ownerId, failProject.id, 'reddit');
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.oauthStateHash, undefined);
    assert.equal(stored?.pendingOAuthCiphertext, undefined);

    await assert.rejects(
      () =>
        completeRedditAuthorization({
          userId: ownerId,
          state,
          code: 'bad-code',
          sessionId: 'session-owner',
        }),
      (err) => code(err) === 'oauth_state_invalid'
    );
  });

  await t.test('a denial cancels only the owning user’s pending handshake', async () => {
    const cancelProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'reddit-oauth-owner/cancel',
      repoName: 'cancel',
      repoOwner: 'reddit-oauth-owner',
      title: 'Cancel',
    });
    const state = await begin(ownerId, cancelProject.id);
    await cancelRedditAuthorization(state, { userId: ownerId });
    const stored = await storage.findPlatformConnection(ownerId, cancelProject.id, 'reddit');
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.pendingOAuthCiphertext, undefined);

    const second = await begin(ownerId, cancelProject.id);
    await cancelRedditAuthorization(second, { userId: String(other.id) });
    const pending = await storage.findPlatformConnection(ownerId, cancelProject.id, 'reddit');
    assert.equal(pending?.status, 'pending');
  });

  await t.test('switching the Reddit account invalidates existing approvals', async () => {
    const switchProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'reddit-oauth-owner/switch',
      repoName: 'switch',
      repoOwner: 'reddit-oauth-owner',
      title: 'Switch',
    });
    const firstState = await begin(ownerId, switchProject.id);
    const connection = await completeRedditAuthorization({
      userId: ownerId,
      state: firstState,
      code: 'code',
      sessionId: 'session-owner',
    });

    const draft = await storage.createDraft({
      projectId: switchProject.id,
      platformId: 'reddit',
      title: 'A title',
      subreddit: 'programming',
      submissionType: 'self',
      text: 'Approved text',
    });
    const approved = await storage.approveDraft(draft.id, owner.login);
    assert.equal(approved?.status, 'approved');

    class SwitchedAccountClient extends MockRedditClient {
      override async verifyAccount() {
        this.verifyCalls += 1;
        return { externalAccountId: 'mock-reddit-user-2', externalAccountName: 'other_reddit_user' };
      }
    }
    setOAuthClientForTests('reddit', new SwitchedAccountClient());

    const secondState = await begin(ownerId, switchProject.id);
    await completeRedditAuthorization({
      userId: ownerId,
      state: secondState,
      code: 'code',
      sessionId: 'session-owner',
    });

    const after = await storage.getDraftById(draft.id);
    assert.notEqual(after?.status, 'approved');
    assert.equal(after?.approvedText, undefined);
    assert.equal(after?.approvedHash, undefined);

    const stored = await storage.getPlatformConnectionById(connection.id);
    assert.equal(stored?.externalAccountId, 'mock-reddit-user-2');
    setOAuthClientForTests('reddit', mockRedditClient);
  });

  await t.test('reconnecting the same account updates one connection', async () => {
    const state = await begin(ownerId, project.id);
    await completeRedditAuthorization({
      userId: ownerId,
      state,
      code: 'code',
      sessionId: 'session-owner',
    });
    const connections = await storage.listPlatformConnections(ownerId, project.id);
    const redditConnections = connections.filter((item) => item.platformId === 'reddit');
    assert.equal(redditConnections.length, 1);
    assert.equal(redditConnections[0].id, connectionId);
    assert.equal(redditConnections[0].status, 'active');
  });

  await t.test('verifyConnection refreshes an expired access token once', async () => {
    class ExpiredTokenClient extends MockRedditClient {
      private calls = 0;
      override async verifyAccount() {
        this.calls += 1;
        if (this.calls === 1) throw new AdapterError('expired', 'token_expired');
        return { externalAccountId: 'mock-reddit-user', externalAccountName: 'mock_reddit_user' };
      }
    }
    const client = new ExpiredTokenClient();
    setOAuthClientForTests('reddit', client);
    const verified = await verifyConnection(ownerId, connectionId);
    assert.equal(verified.status, 'active');
    assert.equal(client.refreshCalls, 1);
    const tokens = await getConnectionToken(ownerId, connectionId);
    assert.equal(tokens.accessToken, 'mock-reddit-access-1');
    assert.equal(tokens.refreshToken, 'mock-reddit-refresh-1');
    setOAuthClientForTests('reddit', mockRedditClient);
  });

  await t.test('verifyConnection disconnects when the account is revoked', async () => {
    class RevokedClient extends MockRedditClient {
      override async verifyAccount(): Promise<never> {
        throw new AdapterError('revoked', 'revoked');
      }
      override async refreshSession(): Promise<never> {
        throw new AdapterError('revoked', 'revoked');
      }
    }
    setOAuthClientForTests('reddit', new RevokedClient());
    const failure = await verifyConnection(ownerId, connectionId).then(
      () => null,
      (err: unknown) => err
    );
    setOAuthClientForTests('reddit', mockRedditClient);
    // The refresh attempt also fails, so the connection is dropped rather
    // than kept in a state the owner cannot use.
    assert.ok(failure instanceof ConnectionError);
    assert.equal(failure.code, 'invalid_credentials');
    const stored = await storage.getPlatformConnectionById(connectionId);
    assert.equal(stored?.status, 'disconnected');
  });

  await t.test('another signed-in user cannot complete the handshake', async () => {
    const state = await begin(ownerId, project.id);
    await assert.rejects(
      () =>
        completeRedditAuthorization({
          userId: String(other.id),
          state,
          code: 'code',
          sessionId: 'session-owner',
        }),
      (err) => code(err) === 'oauth_state_invalid'
    );
  });

  await t.test('disconnect revokes at Reddit, then wipes local token material', async () => {
    // Reconnect first because the revoked-verify test above disconnected it.
    const state = await begin(ownerId, project.id);
    const connection = await completeRedditAuthorization({
      userId: ownerId,
      state,
      code: 'code',
      sessionId: 'session-owner',
    });
    connectionId = connection.id;

    const before = mockRedditClient.revokeCalls;
    await disconnectConnection(ownerId, connectionId);
    assert.equal(mockRedditClient.revokeCalls, before + 1);

    const stored = await storage.getPlatformConnectionById(connectionId);
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.accessTokenCiphertext, '');
    assert.equal(stored?.refreshTokenCiphertext, undefined);
    assert.equal(stored?.keyRef, '');
    await assert.rejects(
      () => getConnectionToken(ownerId, connectionId),
      (err) => code(err) === 'connection_inactive'
    );
  });

  setOAuthClientForTests('reddit', null);
});
