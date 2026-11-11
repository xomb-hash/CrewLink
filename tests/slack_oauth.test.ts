import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { config } from '../src/config/index';
import { storage } from '../src/lib/storage';
import {
  beginSlackAuthorization,
  cancelSlackAuthorization,
  completeSlackAuthorization,
  ConnectionError,
  disconnectConnection,
  getConnectionToken,
  listSlackChannels,
  selectSlackChannel,
  verifyConnection,
} from '../src/posting/connections';
import {
  MockSlackClient,
  mockSlackClient,
  resetMockSlackState,
  setOAuthClientForTests,
} from '../src/posting/adapters';
import { SlackError } from '../src/posting/adapters/slack';

const code = (err: unknown) => (err instanceof ConnectionError ? err.code : 'unexpected');

test('Slack OAuth keeps state and the bot token server-side', async (t) => {
  storage.reset();
  resetMockSlackState();
  setOAuthClientForTests('slack', mockSlackClient);

  const owner = await storage.saveUser({ id: 2101, login: 'slack-owner' });
  const other = await storage.saveUser({ id: 2102, login: 'slack-other' });
  const ownerId = owner.id as string;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'slack-owner/rocket',
    repoName: 'rocket',
    repoOwner: 'slack-owner',
    title: 'Rocket',
  });
  const otherProject = await storage.createProject({
    ownerLogin: other.login,
    ownerId: other.id,
    repoFullName: 'slack-other/boat',
    repoName: 'boat',
    repoOwner: 'slack-other',
    title: 'Boat',
  });

  const begin = (projectId: string, sessionId = 'session-owner', userId = ownerId) =>
    beginSlackAuthorization({ userId, projectId, sessionId });

  const stateOf = async (projectId: string, sessionId = 'session-owner') => {
    const { authorizationUrl } = await begin(projectId, sessionId);
    const state = new URL(authorizationUrl).searchParams.get('state') || '';
    assert.ok(state, 'the authorization URL must carry a state');
    return state;
  };

  const finish = (state: string, sessionId = 'session-owner', userId = ownerId) =>
    completeSlackAuthorization({ userId, state, code: 'code', sessionId });

  let connectionId = '';

  await t.test('begin requests the minimum bot scopes and stores only a state hash', async () => {
    const { authorizationUrl } = await begin(project.id);
    const url = new URL(authorizationUrl);
    const state = url.searchParams.get('state') || '';

    assert.equal(url.searchParams.get('client_id'), 'test-slack-client-id');
    assert.equal(url.searchParams.get('scope'), 'chat:write,channels:read,groups:read');
    assert.equal(url.searchParams.has('user_scope'), false);
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'http://localhost:3100/api/platforms/slack/callback'
    );

    const stored = await storage.findPlatformConnection(ownerId, project.id, 'slack');
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
    assert.equal(stored?.accessTokenCiphertext, '');
  });

  await t.test('a mismatched session or another user cannot complete it', async () => {
    const state = await stateOf(project.id);
    await assert.rejects(
      () => finish(state, 'a-different-session'),
      (err) => code(err) === 'oauth_state_invalid'
    );
    const stored = await storage.findPlatformConnection(ownerId, project.id, 'slack');
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.pendingOAuthCiphertext, undefined);

    const second = await stateOf(project.id);
    await assert.rejects(
      () => finish(second, 'session-owner', String(other.id)),
      (err) => code(err) === 'oauth_state_invalid'
    );
  });

  await t.test('an unknown or replayed state is rejected', async () => {
    await assert.rejects(
      () => finish('f'.repeat(64)),
      (err) => code(err) === 'oauth_state_invalid'
    );

    const state = await stateOf(project.id);
    const connection = await finish(state);
    connectionId = connection.id;

    await assert.rejects(
      () => finish(state),
      (err) => code(err) === 'oauth_state_invalid'
    );
  });

  await t.test('a successful callback stores encrypted tokens and a safe summary', async () => {
    assert.ok(connectionId.startsWith('pcn_'));
    const stored = await storage.getPlatformConnectionById(connectionId);
    assert.equal(stored?.status, 'active');
    assert.equal(stored?.serverId, 'T_MOCK');
    assert.equal(stored?.serverName, 'Mock Workspace');
    assert.equal(stored?.externalAccountId, 'U_CREWLINK');
    assert.equal(stored?.externalAccountName, 'Crewlink');
    assert.deepEqual(stored?.scopes, ['chat:write', 'channels:read', 'groups:read']);
    assert.equal(stored?.oauthStateHash, undefined);
    assert.equal(stored?.pendingOAuthCiphertext, undefined);
    assert.equal(stored?.credentialProvider, 'local');
    assert.ok(stored?.accessTokenCiphertext.startsWith('crewlink:v1:'));
    assert.ok(!String(stored?.accessTokenCiphertext).includes('mock-slack-bot-token'));
    assert.equal(stored?.refreshTokenCiphertext, undefined);

    const tokens = await getConnectionToken(ownerId, connectionId);
    assert.equal(tokens.accessToken, 'mock-slack-bot-token');
    assert.equal(tokens.refreshToken, undefined);
    assert.equal(tokens.platformId, 'slack');

    await assert.rejects(
      () => getConnectionToken(String(other.id), connectionId),
      (err) => code(err) === 'connection_not_found'
    );
  });

  await t.test('begin refuses a project the user does not own', async () => {
    await assert.rejects(
      () => begin(otherProject.id),
      (err) => code(err) === 'forbidden'
    );
  });

  await t.test('an expired handshake is consumed and disconnected', async () => {
    const expiredProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'slack-owner/expired',
      repoName: 'expired',
      repoOwner: 'slack-owner',
      title: 'Expired',
    });
    const state = await stateOf(expiredProject.id);
    const stored = await storage.findPlatformConnection(ownerId, expiredProject.id, 'slack');
    assert.ok(stored);
    await storage.upsertPlatformConnection({
      ...stored,
      oauthStateExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    await assert.rejects(
      () => finish(state),
      (err) => code(err) === 'oauth_state_invalid'
    );
    const after = await storage.getPlatformConnectionById(stored.id);
    assert.equal(after?.status, 'disconnected');
    assert.equal(after?.pendingOAuthCiphertext, undefined);
  });

  await t.test('a failed exchange clears the pending handshake', async () => {
    const failProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'slack-owner/fail',
      repoName: 'fail',
      repoOwner: 'slack-owner',
      title: 'Fail',
    });
    const state = await stateOf(failProject.id);
    mockSlackClient.failExchange = new SlackError(
      'Slack rejected the installation code.',
      'invalid_code',
      'auth_failed'
    );

    await assert.rejects(
      () => finish(state),
      (err) => code(err) === 'invalid_credentials'
    );

    const stored = await storage.findPlatformConnection(ownerId, failProject.id, 'slack');
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.oauthStateHash, undefined);
    assert.equal(stored?.pendingOAuthCiphertext, undefined);

    await assert.rejects(
      () => finish(state),
      (err) => code(err) === 'oauth_state_invalid'
    );
  });

  await t.test('a denial cancels only the owning user’s pending handshake', async () => {
    const cancelProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'slack-owner/cancel',
      repoName: 'cancel',
      repoOwner: 'slack-owner',
      title: 'Cancel',
    });
    const state = await stateOf(cancelProject.id);
    await cancelSlackAuthorization(state, { userId: ownerId });
    const stored = await storage.findPlatformConnection(ownerId, cancelProject.id, 'slack');
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.pendingOAuthCiphertext, undefined);

    const second = await stateOf(cancelProject.id);
    await cancelSlackAuthorization(second, { userId: String(other.id) });
    const pending = await storage.findPlatformConnection(ownerId, cancelProject.id, 'slack');
    assert.equal(pending?.status, 'pending');
  });

  await t.test('listChannels exposes only what the bot can see and never widens by user access', async () => {
    const channels = await listSlackChannels(ownerId, connectionId);
    assert.deepEqual(
      channels.map((channel) => channel.id),
      ['C0GENERAL', 'C0RANDOM', 'G0LEADS', 'C0ARCHIVED']
    );
    assert.equal(channels.find((channel) => channel.id === 'G0LEADS')?.isPrivate, true);
    assert.equal(channels.find((channel) => channel.id === 'G0LEADS')?.isMember, true);
    assert.equal(channels.find((channel) => channel.id === 'C0RANDOM')?.isMember, false);

    await assert.rejects(
      () => listSlackChannels(String(other.id), connectionId),
      (err) => code(err) === 'connection_not_found'
    );
  });

  await t.test('channel selection rejects archived, non-member and malformed channels', async () => {
    await assert.rejects(
      () => selectSlackChannel({ userId: ownerId, connectionId, channelId: 'not a channel!' }),
      (err) => code(err) === 'invalid_input'
    );
    await assert.rejects(
      () => selectSlackChannel({ userId: ownerId, connectionId, channelId: 'C0MISSING' }),
      (err) => code(err) === 'invalid_input'
    );
    await assert.rejects(
      () => selectSlackChannel({ userId: ownerId, connectionId, channelId: 'C0ARCHIVED' }),
      (err) =>
        code(err) === 'invalid_input' &&
        err instanceof Error &&
        err.message.includes('archived')
    );
    await assert.rejects(
      () => selectSlackChannel({ userId: ownerId, connectionId, channelId: 'C0RANDOM' }),
      (err) =>
        code(err) === 'invalid_input' &&
        err instanceof Error &&
        err.message.includes('Invite @Crewlink')
    );

    const selected = await selectSlackChannel({
      userId: ownerId,
      connectionId,
      channelId: 'G0LEADS',
    });
    assert.equal(selected.channelId, 'G0LEADS');
    assert.equal(selected.channelName, 'leads');

    await assert.rejects(
      () =>
        selectSlackChannel({
          userId: String(other.id),
          connectionId,
          channelId: 'C0GENERAL',
        }),
      (err) => code(err) === 'connection_not_found'
    );
  });

  await t.test('changing the channel invalidates Slack draft approvals', async () => {
    const text = 'Crewlink join https://crewlink.test/join/rocket';
    const draft = await storage.createDraft({
      projectId: project.id,
      platformId: 'slack',
      text,
    });
    await storage.approveDraft(draft.id, owner.login);

    await selectSlackChannel({ userId: ownerId, connectionId, channelId: 'C0GENERAL' });

    const after = await storage.getDraftById(draft.id);
    assert.notEqual(after?.status, 'approved');
    assert.equal(after?.approvedText, undefined);
    assert.equal(after?.approvedHash, undefined);
  });

  await t.test('switching the workspace drops the channel and existing approvals', async () => {
    const switchProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'slack-owner/switch',
      repoName: 'switch',
      repoOwner: 'slack-owner',
      title: 'Switch',
    });
    const firstState = await stateOf(switchProject.id);
    const connection = await finish(firstState);
    await selectSlackChannel({
      userId: ownerId,
      connectionId: connection.id,
      channelId: 'C0GENERAL',
    });

    const draft = await storage.createDraft({
      projectId: switchProject.id,
      platformId: 'slack',
      text: 'Approved text https://crewlink.test/join/switch',
    });
    await storage.approveDraft(draft.id, owner.login);

    mockSlackClient.workspaceId = 'T_OTHER';
    mockSlackClient.workspaceName = 'Other Workspace';
    const secondState = await stateOf(switchProject.id);
    await finish(secondState);

    const after = await storage.getDraftById(draft.id);
    assert.notEqual(after?.status, 'approved');

    const stored = await storage.getPlatformConnectionById(connection.id);
    assert.equal(stored?.serverId, 'T_OTHER');
    assert.equal(stored?.channelId, undefined);
    assert.equal(stored?.channelName, undefined);

    mockSlackClient.workspaceId = 'T_MOCK';
    mockSlackClient.workspaceName = 'Mock Workspace';
  });

  await t.test('reconnecting the same workspace updates one connection', async () => {
    const state = await stateOf(project.id);
    await finish(state);
    const connections = (await storage.listPlatformConnections(ownerId, project.id)).filter(
      (item) => item.platformId === 'slack'
    );
    assert.equal(connections.length, 1);
    assert.equal(connections[0].id, connectionId);
    assert.equal(connections[0].status, 'active');
  });

  await t.test('verify updates the workspace and disconnects a revoked app', async () => {
    const verified = await verifyConnection(ownerId, connectionId);
    assert.equal(verified.status, 'active');
    assert.equal(verified.serverName, 'Mock Workspace');
    assert.equal(verified.externalAccountName, 'Crewlink');

    const revoked = new RevokedSlackClient();
    setOAuthClientForTests('slack', revoked);
    const failure = await verifyConnection(ownerId, connectionId).then(
      () => null,
      (err: unknown) => err
    );
    setOAuthClientForTests('slack', mockSlackClient);
    assert.ok(failure instanceof ConnectionError);
    assert.equal(failure.code, 'invalid_credentials');

    const stored = await storage.getPlatformConnectionById(connectionId);
    assert.equal(stored?.status, 'disconnected');
  });

  await t.test('verify disconnects a token that belongs to another workspace', async () => {
    const state = await stateOf(project.id);
    const connection = await finish(state);
    connectionId = connection.id;

    mockSlackClient.workspaceId = 'T_DIFFERENT';
    mockSlackClient.workspaceName = 'Different Workspace';
    const failure = await verifyConnection(ownerId, connectionId).then(
      () => null,
      (err: unknown) => err
    );
    mockSlackClient.workspaceId = 'T_MOCK';
    mockSlackClient.workspaceName = 'Mock Workspace';

    assert.ok(failure instanceof ConnectionError);
    assert.equal(failure.code, 'invalid_credentials');
    const stored = await storage.getPlatformConnectionById(connectionId);
    assert.equal(stored?.status, 'disconnected');
  });

  await t.test('another signed-in user cannot complete the handshake', async () => {
    const state = await stateOf(project.id);
    await assert.rejects(
      () => finish(state, 'session-owner', String(other.id)),
      (err) => code(err) === 'oauth_state_invalid'
    );
  });

  await t.test('missing Slack configuration fails closed before any redirect', async () => {
    const savedId = config.slackClientId;
    const savedSecret = config.slackClientSecret;
    config.slackClientId = '';
    config.slackClientSecret = '';
    try {
      await assert.rejects(
        () => begin(project.id),
        (err) =>
          code(err) === 'invalid_input' &&
          err instanceof Error &&
          err.message.includes('SLACK_CLIENT_ID')
      );
    } finally {
      config.slackClientId = savedId;
      config.slackClientSecret = savedSecret;
    }
  });

  await t.test('disconnect revokes at Slack, then wipes local token material', async () => {
    const state = await stateOf(project.id);
    const connection = await finish(state);
    connectionId = connection.id;

    const before = mockSlackClient.revokeCalls;
    await disconnectConnection(ownerId, connectionId);
    assert.equal(mockSlackClient.revokeCalls, before + 1);

    const stored = await storage.getPlatformConnectionById(connectionId);
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.accessTokenCiphertext, '');
    assert.equal(stored?.refreshTokenCiphertext, undefined);
    assert.equal(stored?.keyRef, '');
    await assert.rejects(
      () => getConnectionToken(ownerId, connectionId),
      (err) => code(err) === 'connection_inactive'
    );

    await assert.rejects(
      () => disconnectConnection(String(other.id), connectionId),
      (err) => code(err) === 'connection_not_found'
    );
  });

  setOAuthClientForTests('slack', null);
});

class RevokedSlackClient extends MockSlackClient {
  override async verifyWorkspace(): Promise<never> {
    throw new SlackError(
      'The Slack app is no longer authorised.',
      'token_revoked',
      'revoked'
    );
  }
}
