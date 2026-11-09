import test from 'node:test';
import assert from 'node:assert/strict';
import { storage } from '../src/lib/storage.js';
import { handleApply, handleGetJoinData } from '../src/applicants/index.js';
import { signValue } from '../src/lib/request.js';
import { EventEmitter } from 'node:events';

test('Applicant join request flow', async (t) => {
  storage.reset();

  // Create owner
  const owner = storage.saveUser({
    id: 101,
    login: 'alice-owner',
    name: 'Alice',
    createdAt: '2021-01-01T00:00:00Z',
    publicRepos: 10
  });

  // Create applicant
  const applicantUser = storage.saveUser({
    id: 202,
    login: 'bob-builder',
    name: 'Bob',
    createdAt: '2023-01-01T00:00:00Z',
    publicRepos: 8
  });

  // Create project
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

  const applicantSession = storage.createSession(applicantUser.id);
  const applicantCookie = `crewlink_session=${encodeURIComponent(signValue(applicantSession))}`;

  const ownerSession = storage.createSession(owner.id);
  const ownerCookie = `crewlink_session=${encodeURIComponent(signValue(ownerSession))}`;

  function createMockReqRes(body, cookie) {
    const req = new EventEmitter();
    req.method = 'POST';
    req.url = `/api/join/${project.slug}/apply`;
    req.headers = {
      'content-type': 'application/json',
      cookie: cookie || ''
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

    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(body || {})));
      req.emit('end');
    });

    return { req, res, getResult: () => ({ statusCode, data: responseData }) };
  }

  await t.test('retrieves public join page data', () => {
    let result = null;
    const res = {
      writeHead() {},
      setHeader() {},
      end(data) { result = JSON.parse(data); }
    };
    const req = { headers: {} };

    handleGetJoinData(req, res, project.slug);
    assert.ok(result);
    assert.equal(result.project.title, 'Rocket Ship');
    assert.equal(result.project.repoFullName, 'alice-owner/rocket-ship');
    assert.equal(result.project.githubUrl, 'https://github.com/alice-owner/rocket-ship');
  });

  await t.test('applicant submits join request', async () => {
    const { req, res, getResult } = createMockReqRes(
      { message: 'I have experience in propulsion systems.' },
      applicantCookie
    );

    await handleApply(req, res, project.slug);
    const { statusCode, data } = getResult();

    assert.equal(statusCode, 201);
    assert.ok(data.applicant);
    assert.equal(data.applicant.status, 'pending');

    // Verify stored applicant data has account age and public repo count
    const stored = storage.getApplicantById(data.applicant.id);
    assert.ok(stored.accountAge);
    assert.equal(stored.publicRepoCount, 8);
    assert.equal(stored.userLogin, 'bob-builder');
  });

  await t.test('prevents duplicate applications', async () => {
    const { req, res, getResult } = createMockReqRes(
      { message: 'Applying a second time' },
      applicantCookie
    );

    await handleApply(req, res, project.slug);
    const { statusCode, data } = getResult();

    assert.equal(statusCode, 400);
    assert.ok(data.error.includes('already applied'));
  });

  await t.test('prevents owner from applying to their own project', async () => {
    const { req, res, getResult } = createMockReqRes(
      { message: 'Applying to my own project' },
      ownerCookie
    );

    await handleApply(req, res, project.slug);
    const { statusCode, data } = getResult();

    assert.equal(statusCode, 400);
    assert.ok(data.error.includes('owner of this project'));
  });
});
