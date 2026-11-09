import test from 'node:test';
import assert from 'node:assert/strict';
import { storage } from '../src/lib/storage.js';
import { setGitHubClient } from '../src/github/index.js';
import { FakeGitHubApi } from '../src/github/fake.js';
import { handleCreateProject } from '../src/projects/index.js';
import { signValue } from '../src/lib/request.js';
import { EventEmitter } from 'node:events';

test('Project creation flow', async (t) => {
  const fakeGitHub = new FakeGitHubApi();
  setGitHubClient(fakeGitHub);
  storage.reset();

  // Create an owner user in storage
  const owner = storage.saveUser({
    id: 101,
    login: 'alice-owner',
    name: 'Alice Owner',
    avatarUrl: 'https://example.com/alice.png',
    createdAt: '2022-01-01T00:00:00Z',
    publicRepos: 14,
    accessToken: 'fake-token-alice'
  });

  const sessionId = storage.createSession(owner.id);
  const sessionCookie = `crewlink_session=${encodeURIComponent(signValue(sessionId))}`;

  function createMockReqRes(body, cookie = sessionCookie) {
    const req = new EventEmitter();
    req.method = 'POST';
    req.url = '/api/projects';
    req.headers = {
      'content-type': 'application/json',
      cookie
    };

    let responseData = null;
    let statusCode = 200;
    const res = {
      writeHead(status) { statusCode = status; },
      setHeader() {},
      end(data) {
        if (data) responseData = JSON.parse(data);
      }
    };

    // Push body chunks
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body)));
      req.emit('end');
    });

    return { req, res, getResult: () => ({ statusCode, data: responseData }) };
  }

  await t.test('creates project when user is admin of repo', async () => {
    const { req, res, getResult } = createMockReqRes({
      repoFullName: 'alice-owner/rocket-ship',
      joinMode: 'referral',
      title: 'Mission to Orbit',
      description: 'Building an orbital rocket engine.'
    });

    await handleCreateProject(req, res);
    const { statusCode, data } = getResult();

    assert.equal(statusCode, 201);
    assert.ok(data.project);
    assert.equal(data.project.title, 'Mission to Orbit');
    assert.equal(data.project.repoFullName, 'alice-owner/rocket-ship');
    assert.equal(data.project.ownerLogin, 'alice-owner');
    assert.ok(data.project.slug);
    assert.ok(data.project.shareLinks.joinUrl);
  });

  await t.test('rejects project creation if user is not repo admin', async () => {
    const { req, res, getResult } = createMockReqRes({
      repoFullName: 'someone-else/private-repo',
      joinMode: 'referral',
      title: 'Unauthorized Project'
    });

    await handleCreateProject(req, res);
    const { statusCode, data } = getResult();

    assert.equal(statusCode, 403);
    assert.ok(data.error.includes('administrative access'));
  });

  await t.test('rejects project creation if unauthenticated', async () => {
    const { req, res, getResult } = createMockReqRes(
      { repoFullName: 'alice-owner/rocket-ship' },
      '' // No cookie
    );

    await handleCreateProject(req, res);
    const { statusCode } = getResult();
    assert.equal(statusCode, 401);
  });
});
