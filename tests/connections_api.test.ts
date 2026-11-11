import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import './setup';
import { storage } from '../src/lib/storage';
import { signValue } from '../src/lib/auth';
import { GET as listRoute, POST as saveRoute } from '../src/app/api/platforms/connections/route';
import { DELETE as disconnectRoute } from '../src/app/api/platforms/connections/[id]/route';
import {
  beginSlackAuthorization,
  completeSlackAuthorization,
} from '../src/posting/connections';
import {
  mockSlackClient,
  resetMockSlackState,
  setOAuthClientForTests,
} from '../src/posting/adapters';

test('Platform connection API', async (t) => {
  storage.reset();
  resetMockSlackState();
  setOAuthClientForTests('slack', mockSlackClient);

  const owner = await storage.saveUser({ id: 401, login: 'api-owner' });
  const other = await storage.saveUser({ id: 402, login: 'api-other' });
  const ownerSession = await storage.createSession(owner.id);
  const otherSession = await storage.createSession(other.id);
  const cookie = `crewlink_session=${encodeURIComponent(signValue(ownerSession))}`;
  const otherCookie = `crewlink_session=${encodeURIComponent(signValue(otherSession))}`;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'api-owner/rocket',
    repoName: 'rocket',
    repoOwner: 'api-owner',
    title: 'Rocket',
  });
  const otherProject = await storage.createProject({
    ownerLogin: other.login,
    ownerId: other.id,
    repoFullName: 'api-other/boat',
    repoName: 'boat',
    repoOwner: 'api-other',
    title: 'Boat',
  });

  let connectionId = '';

  const saveRequest = (body: unknown, headers: Record<string, string> = { cookie }) =>
    new NextRequest('http://localhost:3100/api/platforms/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  await t.test('requires a signed-in user', async () => {
    const list = await listRoute(
      new NextRequest('http://localhost:3100/api/platforms/connections')
    );
    assert.equal(list.status, 401);

    const save = await saveRoute(saveRequest({}, {}));
    assert.equal(save.status, 401);

    const disconnect = await disconnectRoute(
      new NextRequest('http://localhost:3100/api/platforms/connections/pcn_missing', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'pcn_missing' }) }
    );
    assert.equal(disconnect.status, 401);
  });

  await t.test('validates required fields and connectable platforms', async () => {
    const missing = await saveRoute(
      saveRequest({ projectId: project.id, platformId: 'slack' })
    );
    assert.equal(missing.status, 400);

    const manual = await saveRoute(
      saveRequest({
        projectId: project.id,
        platformId: 'whatsapp',
        accessToken: 'token',
      })
    );
    assert.equal(manual.status, 400);
  });

  await t.test('blocks connecting another owner project', async () => {
    const res = await saveRoute(
      saveRequest({
        projectId: otherProject.id,
        platformId: 'x',
        accessToken: 'token',
      })
    );
    assert.equal(res.status, 403);
  });

  await t.test('rejects a pasted Slack token and stores OAuth tokens encrypted', async () => {
    // Slack is OAuth-only since M7, so the generic token endpoint must refuse it.
    const pasted = await saveRoute(
      saveRequest({
        projectId: project.id,
        platformId: 'slack',
        accessToken: 'api-secret-access-token',
      })
    );
    assert.equal(pasted.status, 400);

    const { authorizationUrl } = await beginSlackAuthorization({
      userId: String(owner.id),
      projectId: project.id,
      sessionId: ownerSession,
    });
    const state = new URL(authorizationUrl).searchParams.get('state') || '';
    const connection = await completeSlackAuthorization({
      userId: String(owner.id),
      state,
      code: 'code',
      sessionId: ownerSession,
    });

    assert.ok(connection.id.startsWith('pcn_'));
    assert.equal(connection.platformId, 'slack');
    assert.equal(connection.status, 'active');
    assert.ok(!('accessTokenCiphertext' in connection));
    connectionId = connection.id;

    const stored = await storage.getPlatformConnectionById(connectionId);
    assert.ok(stored?.accessTokenCiphertext.startsWith('crewlink:v1:local:v1:'));
    assert.ok(!String(stored?.accessTokenCiphertext).includes('mock-slack-bot-token'));
  });

  await t.test('lists owner connections without tokens', async () => {
    const res = await listRoute(
      new NextRequest(
        `http://localhost:3100/api/platforms/connections?projectId=${project.id}`,
        { headers: { cookie } }
      )
    );
    assert.equal(res.status, 200);
    const raw = await res.text();
    assert.ok(!raw.includes('mock-slack-bot-token'));
    assert.ok(!raw.includes('Ciphertext'));
    const data = JSON.parse(raw);
    assert.equal(data.connections.length, 1);
    assert.equal(data.connections[0].id, connectionId);

    const forbidden = await listRoute(
      new NextRequest(
        `http://localhost:3100/api/platforms/connections?projectId=${otherProject.id}`,
        { headers: { cookie } }
      )
    );
    assert.equal(forbidden.status, 403);
  });

  await t.test('bot platforms connect a channel with no token and never echo one', async () => {
    const missingChannel = await saveRoute(
      saveRequest({ projectId: project.id, platformId: 'discord' })
    );
    assert.equal(missingChannel.status, 400);

    const res = await saveRoute(
      saveRequest({
        projectId: project.id,
        platformId: 'discord',
        channelId: '1234567890',
        accessToken: 'pasted-bot-token-must-be-ignored',
      })
    );
    assert.equal(res.status, 201);

    const raw = await res.text();
    assert.ok(!raw.includes('pasted-bot-token-must-be-ignored'));
    assert.ok(!raw.includes('Ciphertext'));
    assert.ok(!raw.includes('keyRef'));

    const data = JSON.parse(raw);
    assert.equal(data.connection.platformId, 'discord');
    assert.equal(data.connection.status, 'active');
    assert.equal(data.connection.channelId, '1234567890');

    const stored = await storage.getPlatformConnectionById(data.connection.id);
    assert.equal(stored?.credentialProvider, 'none');
    assert.equal(stored?.accessTokenCiphertext, '');
  });

  await t.test('another user cannot disconnect the connection', async () => {
    const res = await disconnectRoute(
      new NextRequest(`http://localhost:3100/api/platforms/connections/${connectionId}`, {
        method: 'DELETE',
        headers: { cookie: otherCookie },
      }),
      { params: Promise.resolve({ id: connectionId }) }
    );
    assert.equal(res.status, 404);
  });

  await t.test('the owner can disconnect and tokens are wiped', async () => {
    const res = await disconnectRoute(
      new NextRequest(`http://localhost:3100/api/platforms/connections/${connectionId}`, {
        method: 'DELETE',
        headers: { cookie },
      }),
      { params: Promise.resolve({ id: connectionId }) }
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    const stored = await storage.getPlatformConnectionById(connectionId);
    assert.equal(stored?.status, 'disconnected');
    assert.equal(stored?.accessTokenCiphertext, '');
  });

  setOAuthClientForTests('slack', null);
});
