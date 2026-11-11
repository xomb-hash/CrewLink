import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { storage } from '../src/lib/storage';
import { byId } from '../src/platforms/registry';
import {
  beginSlackAuthorization,
  completeSlackAuthorization,
  ConnectionError,
  saveConnection,
  connectBotChannel,
  listConnections,
  getConnectionToken,
  disconnectConnection,
} from '../src/posting/connections';
import { resetMockBotState } from '../src/posting/bots/mock';
import {
  mockSlackClient,
  resetMockSlackState,
  setOAuthClientForTests,
} from '../src/posting/adapters';

const code = (err: unknown) => (err instanceof ConnectionError ? err.code : 'unexpected');

test('Platform connections manager', async (t) => {
  storage.reset();
  resetMockSlackState();
  setOAuthClientForTests('slack', mockSlackClient);

  const owner = await storage.saveUser({ id: 301, login: 'connect-owner' });
  const other = await storage.saveUser({ id: 302, login: 'connect-other' });

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'connect-owner/rocket',
    repoName: 'rocket',
    repoOwner: 'connect-owner',
    title: 'Rocket',
  });
  const otherProject = await storage.createProject({
    ownerLogin: other.login,
    ownerId: other.id,
    repoFullName: 'connect-other/boat',
    repoName: 'boat',
    repoOwner: 'connect-other',
    title: 'Boat',
  });

  let tokenConnectionId = '';
  let discordConnectionId = '';

  // Slack is OAuth-only now, so the old pasted-token coverage runs through the
  // real installation flow instead of saveConnection.
  const startSlack = async (sessionId = 'session-owner'): Promise<string> => {
    const { authorizationUrl } = await beginSlackAuthorization({
      userId: owner.id as string,
      projectId: project.id,
      sessionId,
    });
    const state = new URL(authorizationUrl).searchParams.get('state') || '';
    assert.ok(state);
    return state;
  };
  const finishSlack = (state: string, sessionId = 'session-owner') =>
    completeSlackAuthorization({
      userId: owner.id as string,
      state,
      code: 'code',
      sessionId,
    });

  await t.test('rejects unknown and manual platforms', async () => {
    await assert.rejects(
      () =>
        saveConnection({
          userId: owner.id as string,
          projectId: project.id,
          platformId: 'myspace',
          accessToken: 'token',
        }),
      (err) => code(err) === 'unknown_platform'
    );

    await assert.rejects(
      () =>
        saveConnection({
          userId: owner.id as string,
          projectId: project.id,
          platformId: 'whatsapp',
          accessToken: 'token',
        }),
      (err) => code(err) === 'manual_platform'
    );
  });

  await t.test('rejects a project the user does not own', async () => {
    await assert.rejects(
      () =>
        saveConnection({
          userId: owner.id as string,
          projectId: otherProject.id,
          platformId: 'x',
          accessToken: 'token',
        }),
      (err) => code(err) === 'forbidden'
    );

    await assert.rejects(
      () =>
        saveConnection({
          userId: owner.id as string,
          projectId: 'prj_missing',
          platformId: 'x',
          accessToken: 'token',
        }),
      (err) => code(err) === 'project_not_found'
    );
  });

  await t.test('stores the Slack bot token encrypted and returns no token material', async () => {
    const state = await startSlack();
    const connection = await finishSlack(state);

    assert.ok(connection.id.startsWith('pcn_'));
    assert.equal(connection.status, 'active');
    assert.equal(connection.platformId, 'slack');
    assert.equal(connection.serverId, 'T_MOCK');
    assert.equal(connection.serverName, 'Mock Workspace');
    assert.deepEqual(connection.scopes, ['chat:write', 'channels:read', 'groups:read']);
    assert.ok(!('accessTokenCiphertext' in connection));
    assert.ok(!('accessToken' in connection));
    assert.ok(!JSON.stringify(connection).includes('mock-slack-bot-token'));
    tokenConnectionId = connection.id;

    const stored = await storage.findPlatformConnection(owner.id as string, project.id, 'slack');
    assert.ok(stored);
    assert.equal(stored.id, connection.id);
    assert.equal(stored.credentialProvider, 'local');
    assert.equal(stored.keyRef, 'local:v1');
    assert.ok(stored.accessTokenCiphertext.startsWith('crewlink:v1:local:v1:'));
    assert.ok(!stored.accessTokenCiphertext.includes('mock-slack-bot-token'));
    // The default mock install issues no refresh token, and none is invented.
    assert.equal(stored.refreshTokenCiphertext, undefined);
  });

  await t.test('decrypts the token only for an active owned connection', async () => {
    const tokens = await getConnectionToken(owner.id as string, tokenConnectionId);
    assert.equal(tokens.accessToken, 'mock-slack-bot-token');
    assert.equal(tokens.refreshToken, undefined);
    assert.equal(tokens.platformId, 'slack');

    await assert.rejects(
      () => getConnectionToken(other.id as string, tokenConnectionId),
      (err) => code(err) === 'connection_not_found'
    );
  });

  await t.test('reinstalling Slack reuses one connection and keeps it active', async () => {
    const state = await startSlack();
    const updated = await finishSlack(state);

    assert.equal(updated.id, tokenConnectionId);
    assert.equal(updated.status, 'active');
    const connections = await storage.listPlatformConnections(
      owner.id as string,
      project.id
    );
    assert.equal(connections.filter((item) => item.platformId === 'slack').length, 1);
  });

  await t.test('creator-owned OAuth platforms reject pasted tokens', async () => {
    for (const platformId of ['x', 'bluesky', 'mastodon', 'reddit', 'linkedin', 'slack']) {
      await assert.rejects(
        () =>
          saveConnection({
            userId: owner.id as string,
            projectId: project.id,
            platformId,
            accessToken: 'pasted-token',
          }),
        (err) => code(err) === 'invalid_input'
      );
    }
  });

  await t.test('bot platforms reject pasted tokens and connect a verified channel', async () => {
    resetMockBotState();

    await assert.rejects(
      () =>
        saveConnection({
          userId: owner.id as string,
          projectId: project.id,
          platformId: 'discord',
          accessToken: 'bot-token',
          channelId: '1234567890',
        }),
      (err) => code(err) === 'bot_requires_verification'
    );

    const connection = await connectBotChannel({
      userId: owner.id as string,
      projectId: project.id,
      platformId: 'discord',
      channelId: '1234567890',
    });

    assert.equal(connection.status, 'active');
    assert.equal(connection.channelId, '1234567890');
    assert.equal(connection.channelName, '#1234567890');
    assert.equal(connection.serverId, 'discord-mock-server');
    discordConnectionId = connection.id;

    const stored = await storage.getPlatformConnectionById(discordConnectionId);
    assert.equal(stored?.credentialProvider, 'none');
    assert.equal(stored?.accessTokenCiphertext, '');
    assert.equal(stored?.refreshTokenCiphertext, undefined);
    assert.equal(stored?.keyRef, '');

    await assert.rejects(
      () => getConnectionToken(owner.id as string, discordConnectionId),
      (err) => code(err) === 'connection_inactive'
    );

    await assert.rejects(
      () =>
        connectBotChannel({
          userId: owner.id as string,
          projectId: otherProject.id,
          platformId: 'discord',
          channelId: '1234567890',
        }),
      (err) => code(err) === 'forbidden'
    );

    await assert.rejects(
      () =>
        connectBotChannel({
          userId: owner.id as string,
          projectId: project.id,
          platformId: 'telegram',
          channelId: 'mock-not-member',
        }),
      (err) => code(err) === 'bot_verification_failed'
    );

    await assert.rejects(
      () =>
        connectBotChannel({
          userId: owner.id as string,
          projectId: project.id,
          platformId: 'x',
          channelId: '1234567890',
        }),
      (err) => code(err) === 'invalid_input'
    );

    await assert.rejects(
      () =>
        connectBotChannel({
          userId: owner.id as string,
          projectId: project.id,
          platformId: 'discord',
          channelId: 'not a channel!',
        }),
      (err) => code(err) === 'invalid_input'
    );
  });

  await t.test('lists only the owner connections and hides token fields', async () => {
    const mine = await listConnections(owner.id as string);
    assert.deepEqual(
      mine.map((connection) => connection.platformId).sort(),
      ['discord', 'slack']
    );
    for (const connection of mine) {
      assert.ok(!('accessTokenCiphertext' in connection));
      assert.ok(!('refreshTokenCiphertext' in connection));
      assert.ok(!('keyRef' in connection));
    }

    const theirs = await listConnections(other.id as string);
    assert.equal(theirs.length, 0);

    const projectScoped = await listConnections(owner.id as string, project.id);
    assert.equal(projectScoped.length, 2);

    await assert.rejects(
      () => listConnections(owner.id as string, otherProject.id),
      (err) => code(err) === 'forbidden'
    );
  });

  await t.test('disconnect wipes token material and blocks token reads', async () => {
    await disconnectConnection(owner.id as string, tokenConnectionId);

    const stored = await storage.getPlatformConnectionById(tokenConnectionId);
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.accessTokenCiphertext, '');
    assert.equal(stored?.refreshTokenCiphertext, undefined);
    assert.equal(stored?.keyRef, '');
    assert.equal(stored?.tokenExpiresAt, undefined);

    await assert.rejects(
      () => getConnectionToken(owner.id as string, tokenConnectionId),
      (err) => code(err) === 'connection_inactive'
    );

    await assert.rejects(
      () => disconnectConnection(other.id as string, tokenConnectionId),
      (err) => code(err) === 'connection_not_found'
    );
  });

  await t.test('reconnecting after a disconnect reuses the record', async () => {
    const state = await startSlack();
    const reconnected = await finishSlack(state);

    assert.equal(reconnected.id, tokenConnectionId);
    assert.equal(reconnected.status, 'active');
    const tokens = await getConnectionToken(owner.id as string, tokenConnectionId);
    assert.equal(tokens.accessToken, 'mock-slack-bot-token');
    assert.equal(tokens.refreshToken, undefined);
  });

  await t.test('deleting a project removes its connections', async () => {
    await storage.deleteProject(project.id);
    assert.equal(
      await storage.findPlatformConnection(owner.id as string, project.id, 'slack'),
      null
    );
    assert.equal(await storage.getPlatformConnectionById(discordConnectionId), null);
    assert.equal((await listConnections(owner.id as string)).length, 0);
  });

  await t.test('registry records the optional X platform and manual WhatsApp', () => {
    assert.equal(byId('x')?.defaultEnabled, false);
    assert.ok(byId('x')?.costNote);
    assert.equal(byId('whatsapp')?.auth, 'manual');
    assert.equal(byId('discord')?.auth, 'bot');
    assert.equal(byId('linkedin')?.auth, 'oauth');
  });
});
