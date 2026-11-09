import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { storage } from '../src/lib/storage';
import { setGitHubClient } from '../src/github/index';
import { FakeGitHubApi } from '../src/github/fake';
import { GET as getJoinData } from '../src/app/api/join/[slug]/route';
import { POST as applyToProject } from '../src/app/api/join/[slug]/apply/route';
import { POST as approveApplicant } from '../src/app/api/projects/[id]/applicants/[applicantId]/approve/route';
import { signValue } from '../src/lib/auth';

test('Applicants API route handlers (TypeScript)', async (t) => {
  const fakeGitHub = new FakeGitHubApi();
  setGitHubClient(fakeGitHub);
  storage.reset();

  const owner = await storage.saveUser({
    id: 101,
    login: 'alice-owner',
    name: 'Alice',
    createdAt: '2021-01-01T00:00:00Z',
    publicRepos: 10,
    accessToken: 'fake-token-alice',
  });

  const applicantUser = await storage.saveUser({
    id: 202,
    login: 'bob-builder',
    name: 'Bob',
    createdAt: '2023-01-01T00:00:00Z',
    publicRepos: 8,
    accessToken: 'fake-token-bob',
  });

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'alice-owner/rocket-ship',
    repoName: 'rocket-ship',
    repoOwner: 'alice-owner',
    isPrivate: false,
    joinMode: 'referral',
    title: 'Rocket Ship',
  });

  const applicantSession = await storage.createSession(applicantUser.id);
  const applicantCookie = `crewlink_session=${encodeURIComponent(signValue(applicantSession))}`;

  const ownerSession = await storage.createSession(owner.id);
  const ownerCookie = `crewlink_session=${encodeURIComponent(signValue(ownerSession))}`;

  let applicantId = '';

  await t.test('retrieves public join page data', async () => {
    const req = new NextRequest(`http://localhost:3000/api/join/${project.slug}`);
    const res = await getJoinData(req, { params: Promise.resolve({ slug: project.slug }) });
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.project.title, 'Rocket Ship');
    assert.equal(data.project.githubUrl, 'https://github.com/alice-owner/rocket-ship');
  });

  await t.test('applicant submits join request', async () => {
    const req = new NextRequest(`http://localhost:3000/api/join/${project.slug}/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: applicantCookie,
      },
      body: JSON.stringify({ message: 'I have experience in propulsion systems.' }),
    });

    const res = await applyToProject(req, { params: Promise.resolve({ slug: project.slug }) });
    assert.equal(res.status, 201);

    const data = await res.json();
    assert.ok(data.applicant);
    assert.equal(data.applicant.status, 'pending');
    applicantId = data.applicant.id;

    const stored = await storage.getApplicantById(applicantId);
    assert.ok(stored?.accountAge);
    assert.equal(stored?.publicRepoCount, 8);
    assert.equal(stored?.userLogin, 'bob-builder');
  });

  await t.test('prevents duplicate applications', async () => {
    const req = new NextRequest(`http://localhost:3000/api/join/${project.slug}/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: applicantCookie,
      },
      body: JSON.stringify({ message: 'Applying second time' }),
    });

    const res = await applyToProject(req, { params: Promise.resolve({ slug: project.slug }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('already applied'));
  });

  await t.test('owner approves applicant, sending GitHub collaborator invite', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/projects/${project.id}/applicants/${applicantId}/approve`,
      {
        method: 'POST',
        headers: { cookie: ownerCookie },
      }
    );

    const res = await approveApplicant(req, {
      params: Promise.resolve({ id: project.id, applicantId }),
    });
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.applicant.status, 'approved');
    assert.equal(data.applicant.invitationSent, true);

    assert.equal(fakeGitHub.invitations.length, 1);
    assert.equal(fakeGitHub.invitations[0].username, 'bob-builder');
  });
});
