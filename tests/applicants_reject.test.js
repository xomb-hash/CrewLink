import test from 'node:test';
import assert from 'node:assert/strict';
import { storage } from '../src/lib/storage.js';
import { handleReject } from '../src/applicants/index.js';
import { signValue } from '../src/lib/request.js';

test('Applicant rejection flow', async (t) => {
  storage.reset();

  const owner = storage.saveUser({
    id: 101,
    login: 'alice-owner',
    name: 'Alice',
    createdAt: '2021-01-01T00:00:00Z',
    publicRepos: 10
  });

  const project = storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'alice-owner/rocket-ship',
    repoName: 'rocket-ship',
    repoOwner: 'alice-owner',
    isPrivate: false,
    joinMode: 'referral',
    title: 'Rocket Ship'
  });

  const applicant = storage.createApplicant({
    projectId: project.id,
    userId: '202',
    userLogin: 'bob-builder',
    accountAge: '1 year',
    publicRepoCount: 5
  });

  const ownerSession = storage.createSession(owner.id);
  const ownerCookie = `crewlink_session=${encodeURIComponent(signValue(ownerSession))}`;

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

  await t.test('owner rejects applicant successfully', async () => {
    const { req, res, getResult } = createMockReqRes(ownerCookie);

    await handleReject(req, res, project.id, applicant.id);
    const { statusCode, data } = getResult();

    assert.equal(statusCode, 200);
    assert.equal(data.success, true);
    assert.equal(data.applicant.status, 'rejected');

    const updated = storage.getApplicantById(applicant.id);
    assert.equal(updated.status, 'rejected');
  });
});
