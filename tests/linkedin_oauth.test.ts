import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { config } from '../src/config/index';
import { storage } from '../src/lib/storage';
import {
  beginLinkedInAuthorization,
  cancelLinkedInAuthorization,
  completeLinkedInAuthorization,
  ConnectionError,
  disconnectConnection,
  getConnectionToken,
  verifyConnection,
} from '../src/posting/connections';
import {
  AdapterError,
  MockLinkedInClient,
  mockLinkedInClient,
  resetMockLinkedInState,
  setOAuthClientForTests,
} from '../src/posting/adapters';

const code = (err: unknown) => (err instanceof ConnectionError ? err.code : 'unexpected');

async function begin(
  userId: string,
  projectId: string,
  sessionId = 'session-owner'
): Promise<string> {
  const { authorizationUrl } = await beginLinkedInAuthorization({ userId, projectId, sessionId });
  const state = new URL(authorizationUrl).searchParams.get('state') || '';
  assert.ok(state, 'the authorization URL must carry a state');
  return state;
}

test('LinkedIn OAuth keeps state and tokens server-side', async (t) => {
  storage.reset();
  resetMockLinkedInState();
  setOAuthClientForTests('linkedin', mockLinkedInClient);

  const owner = await storage.saveUser({ id: 1301, login: 'linkedin-oauth-owner' });
  const other = await storage.saveUser({ id: 1302, login: 'linkedin-oauth-other' });
  const ownerId = owner.id as string;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'linkedin-oauth-owner/crew',
    repoName: 'crew',
    repoOwner: 'linkedin-oauth-owner',
    title: 'Crew',
  });

  let connectionId = '';

  await t.test('begin requests the minimum scopes and stores only a state hash', async () => {
    const { authorizationUrl } = await beginLinkedInAuthorization({
      userId: ownerId,
      projectId: project.id,
      sessionId: 'session-owner',
    });
    const url = new URL(authorizationUrl);
    const state = url.searchParams.get('state') || '';

    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), 'test-linkedin-client-id');
    assert.equal(url.searchParams.get('scope'), 'openid profile w_member_social');
    assert.equal(url.searchParams.has('code_challenge'), false);
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'http://localhost:3100/api/platforms/linkedin/callback'
    );

    const stored = await storage.findPlatformConnection(ownerId, project.id, 'linkedin');
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
        completeLinkedInAuthorization({
          userId: ownerId,
          state,
          code: 'code',
          sessionId: 'a-different-session',
        }),
      (err) => code(err) === 'oauth_state_invalid'
    );
    const stored = await storage.findPlatformConnection(ownerId, project.id, 'linkedin');
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.pendingOAuthCiphertext, undefined);
  });

  await t.test('an unknown or replayed state is rejected', async () => {
    await assert.rejects(
      () =>
        completeLinkedInAuthorization({
          userId: ownerId,
          state: 'f'.repeat(64),
          code: 'code',
          sessionId: 'session-owner',
        }),
      (err) => code(err) === 'oauth_state_invalid'
    );

    const state = await begin(ownerId, project.id);
    const connection = await completeLinkedInAuthorization({
      userId: ownerId,
      state,
      code: 'code',
      sessionId: 'session-owner',
    });
    connectionId = connection.id;

    await assert.rejects(
      () =>
        completeLinkedInAuthorization({
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
    assert.equal(stored?.externalAccountId, 'mock-member-id');
    assert.equal(stored?.externalAccountName, 'Mock LinkedIn Member');
    assert.deepEqual(stored?.scopes, ['openid', 'profile', 'w_member_social']);
    assert.equal(stored?.oauthStateHash, undefined);
    assert.equal(stored?.pendingOAuthCiphertext, undefined);
    assert.equal(stored?.credentialProvider, 'local');
    assert.ok(stored?.accessTokenCiphertext.startsWith('crewlink:v1:'));
    assert.ok(!String(stored?.accessTokenCiphertext).includes('mock-linkedin-access'));
    // The default mock issues no refresh token, and none is invented.
    assert.equal(stored?.refreshTokenCiphertext, undefined);

    const tokens = await getConnectionToken(ownerId, connectionId);
    assert.equal(tokens.accessToken, 'mock-linkedin-access');
    assert.equal(tokens.refreshToken, undefined);
    assert.equal(tokens.platformId, 'linkedin');
  });

  await t.test('an expired handshake is consumed and disconnected', async () => {
    const expiredProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'linkedin-oauth-owner/expired',
      repoName: 'expired',
      repoOwner: 'linkedin-oauth-owner',
      title: 'Expired',
    });
    const state = await begin(ownerId, expiredProject.id);
    const stored = await storage.findPlatformConnection(ownerId, expiredProject.id, 'linkedin');
    assert.ok(stored);
    await storage.upsertPlatformConnection({
      ...stored,
      oauthStateExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    await assert.rejects(
      () =>
        completeLinkedInAuthorization({
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
      repoFullName: 'linkedin-oauth-owner/fail',
      repoName: 'fail',
      repoOwner: 'linkedin-oauth-owner',
      title: 'Fail',
    });
    const state = await begin(ownerId, failProject.id);

    class FailingExchangeClient extends MockLinkedInClient {
      override async exchangeCode(): Promise<never> {
        throw new AdapterError('LinkedIn rejected the authorization code.', 'validation_error');
      }
    }
    setOAuthClientForTests('linkedin', new FailingExchangeClient());

    await assert.rejects(
      () =>
        completeLinkedInAuthorization({
          userId: ownerId,
          state,
          code: 'bad-code',
          sessionId: 'session-owner',
        }),
      (err) => code(err) === 'invalid_input'
    );
    setOAuthClientForTests('linkedin', mockLinkedInClient);

    const stored = await storage.findPlatformConnection(ownerId, failProject.id, 'linkedin');
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.oauthStateHash, undefined);
    assert.equal(stored?.pendingOAuthCiphertext, undefined);

    await assert.rejects(
      () =>
        completeLinkedInAuthorization({
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
      repoFullName: 'linkedin-oauth-owner/cancel',
      repoName: 'cancel',
      repoOwner: 'linkedin-oauth-owner',
      title: 'Cancel',
    });
    const state = await begin(ownerId, cancelProject.id);
    await cancelLinkedInAuthorization(state, { userId: ownerId });
    const stored = await storage.findPlatformConnection(ownerId, cancelProject.id, 'linkedin');
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.pendingOAuthCiphertext, undefined);

    const second = await begin(ownerId, cancelProject.id);
    await cancelLinkedInAuthorization(second, { userId: String(other.id) });
    const pending = await storage.findPlatformConnection(ownerId, cancelProject.id, 'linkedin');
    assert.equal(pending?.status, 'pending');
  });

  await t.test('switching the LinkedIn account invalidates existing approvals', async () => {
    const switchProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'linkedin-oauth-owner/switch',
      repoName: 'switch',
      repoOwner: 'linkedin-oauth-owner',
      title: 'Switch',
    });
    const firstState = await begin(ownerId, switchProject.id);
    const connection = await completeLinkedInAuthorization({
      userId: ownerId,
      state: firstState,
      code: 'code',
      sessionId: 'session-owner',
    });

    const draft = await storage.createDraft({
      projectId: switchProject.id,
      platformId: 'linkedin',
      text: 'Approved text',
    });
    const approved = await storage.approveDraft(draft.id, owner.login);
    assert.equal(approved?.status, 'approved');

    class SwitchedAccountClient extends MockLinkedInClient {
      override async verifyAccount() {
        this.verifyCalls += 1;
        return { externalAccountId: 'mock-member-id-2', externalAccountName: 'Other Member' };
      }
    }
    setOAuthClientForTests('linkedin', new SwitchedAccountClient());

    const secondState = await begin(ownerId, switchProject.id);
    await completeLinkedInAuthorization({
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
    assert.equal(stored?.externalAccountId, 'mock-member-id-2');
    setOAuthClientForTests('linkedin', mockLinkedInClient);
  });

  await t.test('reconnecting the same account updates one connection', async () => {
    const state = await begin(ownerId, project.id);
    await completeLinkedInAuthorization({
      userId: ownerId,
      state,
      code: 'code',
      sessionId: 'session-owner',
    });
    const connections = await storage.listPlatformConnections(ownerId, project.id);
    const linkedInConnections = connections.filter((item) => item.platformId === 'linkedin');
    assert.equal(linkedInConnections.length, 1);
    assert.equal(linkedInConnections[0].id, connectionId);
    assert.equal(linkedInConnections[0].status, 'active');
  });

  await t.test('verify refreshes once when LinkedIn issued a refresh token', async () => {
    mockLinkedInClient.issueRefreshToken = true;
    const state = await begin(ownerId, project.id);
    const connection = await completeLinkedInAuthorization({
      userId: ownerId,
      state,
      code: 'code',
      sessionId: 'session-owner',
    });
    connectionId = connection.id;
    mockLinkedInClient.issueRefreshToken = false;

    class ExpiredTokenClient extends MockLinkedInClient {
      private calls = 0;
      override async verifyAccount() {
        this.calls += 1;
        if (this.calls === 1) throw new AdapterError('expired', 'token_expired');
        return { externalAccountId: 'mock-member-id', externalAccountName: 'Mock LinkedIn Member' };
      }
    }
    const client = new ExpiredTokenClient();
    setOAuthClientForTests('linkedin', client);
    const verified = await verifyConnection(ownerId, connectionId);
    assert.equal(verified.status, 'active');
    assert.equal(client.refreshCalls, 1);
    const tokens = await getConnectionToken(ownerId, connectionId);
    assert.equal(tokens.accessToken, 'mock-linkedin-access-1');
    assert.equal(tokens.refreshToken, 'mock-linkedin-refresh-1');
    setOAuthClientForTests('linkedin', mockLinkedInClient);
  });

  await t.test('verify disconnects a revoked account that cannot refresh', async () => {
    class RevokedClient extends MockLinkedInClient {
      override async verifyAccount(): Promise<never> {
        throw new AdapterError('revoked', 'revoked');
      }
      override async refreshSession(): Promise<never> {
        throw new AdapterError('revoked', 'revoked');
      }
    }
    setOAuthClientForTests('linkedin', new RevokedClient());
    const failure = await verifyConnection(ownerId, connectionId).then(
      () => null,
      (err: unknown) => err
    );
    setOAuthClientForTests('linkedin', mockLinkedInClient);
    assert.ok(failure instanceof ConnectionError);
    assert.equal(failure.code, 'invalid_credentials');
    const stored = await storage.getPlatformConnectionById(connectionId);
    assert.equal(stored?.status, 'disconnected');
  });

  await t.test('another signed-in user cannot complete the handshake', async () => {
    const state = await begin(ownerId, project.id);
    await assert.rejects(
      () =>
        completeLinkedInAuthorization({
          userId: String(other.id),
          state,
          code: 'code',
          sessionId: 'session-owner',
        }),
      (err) => code(err) === 'oauth_state_invalid'
    );
  });

  await t.test('disconnect wipes local token material (no revocation endpoint)', async () => {
    // Reconnect first because the revoked-verify test above disconnected it.
    const state = await begin(ownerId, project.id);
    const connection = await completeLinkedInAuthorization({
      userId: ownerId,
      state,
      code: 'code',
      sessionId: 'session-owner',
    });
    connectionId = connection.id;

    await disconnectConnection(ownerId, connectionId);

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

  await t.test('missing LinkedIn configuration fails closed before any redirect', async () => {
    const savedId = config.linkedinClientId;
    const savedSecret = config.linkedinClientSecret;
    config.linkedinClientId = '';
    config.linkedinClientSecret = '';
    try {
      await assert.rejects(
        () => beginLinkedInAuthorization({ userId: ownerId, projectId: project.id, sessionId: 'session-owner' }),
        (err) =>
          code(err) === 'invalid_input' &&
          err instanceof Error &&
          err.message.includes('LINKEDIN_CLIENT_ID')
      );
    } finally {
      config.linkedinClientId = savedId;
      config.linkedinClientSecret = savedSecret;
    }
  });

  setOAuthClientForTests('linkedin', null);
});
