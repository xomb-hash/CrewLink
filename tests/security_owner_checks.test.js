import test from 'node:test';
import assert from 'node:assert/strict';
import { storage } from '../src/lib/storage.js';
import { handleApprove, handleReject } from '../src/applicants/index.js';
import { handleGetProjectById } from '../src/projects/index.js';
import { signValue } from '../src/lib/request.js';

test('Server-side security and owner-only authorization enforcement', async (t) => {
  storage.reset();

  const realOwner = storage.saveUser({
    id: 101,
    login: 'alice-owner',
    accessToken: 'fake-token-alice'
  });

  const impostor = storage.saveUser({
    id: 999,
    login: 'mallory-impostor',
    accessToken: 'fake-token-mallory'
  });

  const project = storage.createProject({
    ownerLogin: realOwner.login,
    ownerId: realOwner.id,
    repoFullName: 'alice-owner/rocket-ship',
    repoName: 'rocket-ship',
    repoOwner: 'alice-owner',
    title: 'Rocket Ship'
  });

  const applicant = storage.createApplicant({
    projectId: project.id,
    userId: '202',
    userLogin: 'bob-builder',
    accountAge: '2 years',
    publicRepoCount: 10
  });

  const impostorSession = storage.createSession(impostor.id);
  const impostorCookie = `crewlink_session=${encodeURIComponent(signValue(impostorSession))}`;

  function createMockReqRes(cookie) {
    const req = {
      headers: { cookie: cookie || '' }
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
    return { req, res, getResult: () => ({ statusCode, data: responseData }) };
  }

  await t.test('blocks non-owner from approving applicants with 403 Forbidden', async () => {
    const { req, res, getResult } = createMockReqRes(impostorCookie);

    await handleApprove(req, res, project.id, applicant.id);
    const { statusCode, data } = getResult();

    assert.equal(statusCode, 403);
    assert.ok(data.error.includes('Only the project owner'));
  });

  await t.test('blocks non-owner from rejecting applicants with 403 Forbidden', async () => {
    const { req, res, getResult } = createMockReqRes(impostorCookie);

    await handleReject(req, res, project.id, applicant.id);
    const { statusCode, data } = getResult();

    assert.equal(statusCode, 403);
    assert.ok(data.error.includes('Only the project owner'));
  });

  await t.test('blocks non-owner from viewing project applicant details with 403 Forbidden', () => {
    const { req, res, getResult } = createMockReqRes(impostorCookie);

    handleGetProjectById(req, res, project.id);
    const { statusCode, data } = getResult();

    assert.equal(statusCode, 403);
    assert.ok(data.error.includes('not the owner'));
  });

  await t.test('blocks unauthenticated requests with 401 Unauthorized', async () => {
    const { req, res, getResult } = createMockReqRes('');

    await handleApprove(req, res, project.id, applicant.id);
    const { statusCode } = getResult();

    assert.equal(statusCode, 401);
  });
});
