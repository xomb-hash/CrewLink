import test from 'node:test';
import assert from 'node:assert/strict';
import { storage } from '../src/lib/storage.js';
import { setGitHubClient } from '../src/github/index.js';
import { FakeGitHubApi } from '../src/github/fake.js';
import { handleApprove } from '../src/applicants/index.js';
import { signValue } from '../src/lib/request.js';

test('Applicant approval and GitHub collaborator invite', async (t) => {
  const fakeGitHub = new FakeGitHubApi();
  setGitHubClient(fakeGitHub);
  storage.reset();

  const owner = storage.saveUser({
    id: 101,
    login: 'alice-owner',
    name: 'Alice',
    createdAt: '2021-01-01T00:00:00Z',
    publicRepos: 10,
    accessToken: 'fake-token-alice'
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
    publicRepoCount: 5,
    message: 'Excited to contribute!'
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

  await t.test('owner approves applicant, sending GitHub collaborator invitation', async () => {
    const { req, res, getResult } = createMockReqRes(ownerCookie);

    await handleApprove(req, res, project.id, applicant.id);
    const { statusCode, data } = getResult();

    assert.equal(statusCode, 200);
    assert.equal(data.success, true);
    assert.equal(data.applicant.status, 'approved');
    assert.equal(data.applicant.invitationSent, true);

    // Verify invitation recorded in fake GitHub
    assert.equal(fakeGitHub.invitations.length, 1);
    assert.equal(fakeGitHub.invitations[0].username, 'bob-builder');
    assert.equal(fakeGitHub.invitations[0].repo, 'rocket-ship');
  });
});
