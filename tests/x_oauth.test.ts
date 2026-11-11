import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { storage } from '../src/lib/storage';
import {
  beginXAuthorization,
  cancelXAuthorization,
  completeXAuthorization,
  ConnectionError,
  disconnectConnection,
  getConnectionToken,
} from '../src/posting/connections';
import {
  AdapterError,
  MockXClient,
  mockXClient,
  resetMockXState,
  setOAuthClientForTests,
} from '../src/posting/adapters';

const code = (err: unknown) => (err instanceof ConnectionError ? err.code : 'unexpected');

interface BeginResult {
  authorizationUrl: string;
  state: string;
}

async function begin(
  userId: string,
  projectId: string,
  sessionId = 'session-owner'
): Promise<BeginResult> {
  const { authorizationUrl } = await beginXAuthorization({ userId, projectId, sessionId });
  const url = new URL(authorizationUrl);
  const state = url.searchParams.get('state') || '';
  assert.ok(state, 'the authorization URL must carry a state');
  return { authorizationUrl, state };
}

test('X OAuth 2.0 + PKCE keeps verifiers and tokens server-side', async (t) => {
  storage.reset();
  resetMockXState();
  setOAuthClientForTests('x', mockXClient);

  const owner = await storage.saveUser({ id: 901, login: 'x-oauth-owner' });
  const other = await storage.saveUser({ id: 902, login: 'x-oauth-other' });
  const ownerId = owner.id as string;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'x-oauth-owner/rocket',
    repoName: 'rocket',
    repoOwner: 'x-oauth-owner',
    title: 'Rocket',
  });

  let connectionId = '';

  await t.test('begin returns an S256 challenge and stores only a state hash', async () => {
    const { authorizationUrl, state } = await begin(ownerId, project.id);
    const url = new URL(authorizationUrl);

    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), 'test-x-client-id');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('code_challenge'));
    assert.equal(
      url.searchParams.get('scope'),
      'tweet.read tweet.write users.read offline.access'
    );
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'http://localhost:3100/api/platforms/x/callback'
    );

    const stored = await storage.findPlatformConnection(ownerId, project.id, 'x');
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
    // The PKCE verifier exists only inside the encrypted envelope.
    assert.ok(!JSON.stringify(stored).includes('codeVerifier'));
  });

  await t.test('a mismatched session cannot complete the authorization', async () => {
    const { state } = await begin(ownerId, project.id);
    await assert.rejects(
      () =>
        completeXAuthorization({
          userId: ownerId,
          state,
          code: 'code',
          sessionId: 'a-different-session',
        }),
      (err) => code(err) === 'oauth_state_invalid'
    );
    const stored = await storage.findPlatformConnection(ownerId, project.id, 'x');
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.pendingOAuthCiphertext, undefined);
  });

  await t.test('an unknown or replayed state is rejected', async () => {
    await assert.rejects(
      () =>
        completeXAuthorization({
          userId: ownerId,
          state: 'f'.repeat(64),
          code: 'code',
          sessionId: 'session-owner',
        }),
      (err) => code(err) === 'oauth_state_invalid'
    );

    const { state } = await begin(ownerId, project.id);
    const connection = await completeXAuthorization({
      userId: ownerId,
      state,
      code: 'code',
      sessionId: 'session-owner',
    });
    connectionId = connection.id;

    await assert.rejects(
      () =>
        completeXAuthorization({
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
    assert.equal(stored?.externalAccountId, 'mock-x-user');
    assert.equal(stored?.externalAccountName, 'mock_x_user');
    assert.deepEqual(stored?.scopes, [
      'tweet.read',
      'tweet.write',
      'users.read',
      'offline.access',
    ]);
    assert.equal(stored?.oauthStateHash, undefined);
    assert.equal(stored?.pendingOAuthCiphertext, undefined);
    assert.equal(stored?.credentialProvider, 'local');
    assert.ok(stored?.accessTokenCiphertext.startsWith('crewlink:v1:'));
    assert.ok(!stored?.accessTokenCiphertext.includes('mock-x-access'));
    assert.ok(!String(stored?.refreshTokenCiphertext).includes('mock-x-refresh-0'));

    const tokens = await getConnectionToken(ownerId, connectionId);
    assert.equal(tokens.accessToken, 'mock-x-access');
    assert.equal(tokens.refreshToken, 'mock-x-refresh-0');
    assert.equal(tokens.platformId, 'x');
  });

  await t.test('an expired handshake is consumed and disconnected', async () => {
    const expiredProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'x-oauth-owner/expired',
      repoName: 'expired',
      repoOwner: 'x-oauth-owner',
      title: 'Expired',
    });
    const { state } = await begin(ownerId, expiredProject.id);
    const stored = await storage.findPlatformConnection(ownerId, expiredProject.id, 'x');
    assert.ok(stored);
    await storage.upsertPlatformConnection({
      ...stored,
      oauthStateExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    await assert.rejects(
      () =>
        completeXAuthorization({
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
      repoFullName: 'x-oauth-owner/fail',
      repoName: 'fail',
      repoOwner: 'x-oauth-owner',
      title: 'Fail',
    });
    const { state } = await begin(ownerId, failProject.id);

    class FailingExchangeClient extends MockXClient {
      override async exchangeCode(): Promise<never> {
        throw new AdapterError('X rejected the authorization code.', 'validation_error');
      }
    }
    setOAuthClientForTests('x', new FailingExchangeClient());

    await assert.rejects(
      () =>
        completeXAuthorization({
          userId: ownerId,
          state,
          code: 'bad-code',
          sessionId: 'session-owner',
        }),
      (err) => code(err) === 'invalid_input'
    );
    setOAuthClientForTests('x', mockXClient);

    const stored = await storage.findPlatformConnection(ownerId, failProject.id, 'x');
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.oauthStateHash, undefined);
    assert.equal(stored?.pendingOAuthCiphertext, undefined);

    // The consumed state cannot be retried with a working client.
    await assert.rejects(
      () =>
        completeXAuthorization({
          userId: ownerId,
          state,
          code: 'bad-code',
          sessionId: 'session-owner',
        }),
      (err) => code(err) === 'oauth_state_invalid'
    );
  });

  await t.test('a denial cancels the pending handshake', async () => {
    const cancelProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'x-oauth-owner/cancel',
      repoName: 'cancel',
      repoOwner: 'x-oauth-owner',
      title: 'Cancel',
    });
    const { state } = await begin(ownerId, cancelProject.id);
    await cancelXAuthorization(state, { userId: ownerId });
    const stored = await storage.findPlatformConnection(ownerId, cancelProject.id, 'x');
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.pendingOAuthCiphertext, undefined);

    // A cancellation without the owning user cannot consume it.
    const second = await begin(ownerId, cancelProject.id);
    await cancelXAuthorization(second.state, { userId: String(other.id) });
    const pending = await storage.findPlatformConnection(ownerId, cancelProject.id, 'x');
    assert.equal(pending?.status, 'pending');
  });

  await t.test('switching the X account invalidates existing approvals', async () => {
    const switchProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'x-oauth-owner/switch',
      repoName: 'switch',
      repoOwner: 'x-oauth-owner',
      title: 'Switch',
    });
    const first = await begin(ownerId, switchProject.id);
    const connection = await completeXAuthorization({
      userId: ownerId,
      state: first.state,
      code: 'code',
      sessionId: 'session-owner',
    });

    const draft = await storage.createDraft({
      projectId: switchProject.id,
      platformId: 'x',
      text: 'Approved text',
    });
    const approved = await storage.approveDraft(draft.id, owner.login);
    assert.equal(approved?.status, 'approved');

    class SwitchedAccountClient extends MockXClient {
      override async verifyAccount() {
        this.verifyCalls += 1;
        return { externalAccountId: 'mock-x-user-2', externalAccountName: 'other_x_user' };
      }
    }
    setOAuthClientForTests('x', new SwitchedAccountClient());

    const second = await begin(ownerId, switchProject.id);
    await completeXAuthorization({
      userId: ownerId,
      state: second.state,
      code: 'code',
      sessionId: 'session-owner',
    });

    const after = await storage.getDraftById(draft.id);
    assert.notEqual(after?.status, 'approved');
    assert.equal(after?.approvedText, undefined);
    assert.equal(after?.approvedHash, undefined);

    const stored = await storage.getPlatformConnectionById(connection.id);
    assert.equal(stored?.externalAccountId, 'mock-x-user-2');
    setOAuthClientForTests('x', mockXClient);
  });

  await t.test('another signed-in user cannot complete the handshake', async () => {
    const { state } = await begin(ownerId, project.id);
    await assert.rejects(
      () =>
        completeXAuthorization({
          userId: String(other.id),
          state,
          code: 'code',
          sessionId: 'session-owner',
        }),
      (err) => code(err) === 'oauth_state_invalid'
    );
  });

  await t.test('disconnect revokes at X, then wipes local token material', async () => {
    const before = mockXClient.revokeCalls;
    await disconnectConnection(ownerId, connectionId);
    assert.equal(mockXClient.revokeCalls, before + 1);

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

  setOAuthClientForTests('x', null);
});
