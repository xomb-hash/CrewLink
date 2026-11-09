import './setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { storage } from '../src/lib/storage';
import { setGitHubClient } from '../src/github/index';
import { FakeGitHubApi } from '../src/github/fake';
import { GET as getJoinData } from '../src/app/api/join/[slug]/route';
import { POST as applyToProject } from '../src/app/api/join/[slug]/apply/route';
import { POST as approveApplicant } from '../src/app/api/projects/[id]/applicants/[applicantId]/approve/route';
import { GET as getProjects } from '../src/app/api/projects/route';
import { GET as getResume } from '../src/app/api/resume/[applicantId]/route';
import { signValue } from '../src/lib/auth';
import { deleteResume } from '../src/lib/uploads';

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
    assert.equal(data.project.requiresReferralCode, true);
    assert.equal('referralCode' in data.project, false);
  });

  await t.test('applicant submits join request', async () => {
    const req = new NextRequest(`http://localhost:3000/api/join/${project.slug}/apply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: applicantCookie,
      },
      body: JSON.stringify({
        message: 'I have experience in propulsion systems.',
        referralCode: project.referralCode,
        proofUrl: 'https://bob-portfolio.dev/resume.pdf',
        linkedinUrl: 'https://linkedin.com/in/bob-builder',
      }),
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
    assert.equal(stored?.proofUrl, 'https://bob-portfolio.dev/resume.pdf');
    assert.equal(stored?.linkedinUrl, 'https://www.linkedin.com/in/bob-builder');
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

  await t.test('enforces required credentials and serves resumes to the right people', async () => {
    const strictProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'alice-owner/strict-ship',
      repoName: 'strict-ship',
      repoOwner: 'alice-owner',
      isPrivate: false,
      joinMode: 'referral',
      title: 'Strict Ship',
      creatorNote: 'Tell me why you care about orbital mechanics.',
      requireResume: true,
      requireGithubLink: true,
      requireLinkedinLink: false,
    });

    const joinReq = new NextRequest(`http://localhost:3000/api/join/${strictProject.slug}`);
    const joinRes = await getJoinData(joinReq, {
      params: Promise.resolve({ slug: strictProject.slug }),
    });
    const joinData = await joinRes.json();
    assert.equal(joinData.project.creatorNote, 'Tell me why you care about orbital mechanics.');
    assert.equal(joinData.project.requireResume, true);
    assert.equal(joinData.project.requireGithubLink, true);
    assert.equal(joinData.project.requireLinkedinLink, false);

    const carol = await storage.saveUser({
      id: 303,
      login: 'carol-candidate',
      name: 'Carol',
      createdAt: '2024-01-01T00:00:00Z',
      publicRepos: 5,
      accessToken: 'fake-token-carol',
    });
    const carolSession = await storage.createSession(carol.id);
    const carolCookie = `crewlink_session=${encodeURIComponent(signValue(carolSession))}`;

    const missingReq = new NextRequest(
      `http://localhost:3000/api/join/${strictProject.slug}/apply`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: carolCookie },
        body: JSON.stringify({ message: 'Please let me aboard.', referralCode: 'WRONGCODE' }),
      }
    );
    const missingRes = await applyToProject(missingReq, {
      params: Promise.resolve({ slug: strictProject.slug }),
    });
    assert.equal(missingRes.status, 400);
    const missingData = await missingRes.json();
    assert.ok(missingData.errors.some((e: string) => e.includes('referral code')));
    assert.ok(missingData.errors.some((e: string) => e.includes('GitHub profile link')));
    assert.ok(missingData.errors.some((e: string) => e.includes('PDF resume')));

    const form = new FormData();
    form.set('message', 'I have docked three capsules.');
    form.set('githubUrl', 'github.com/carol-candidate');
    form.set('referralCode', String(strictProject.referralCode).toLowerCase());
    form.set(
      'resume',
      new File([Buffer.from('%PDF-1.4\nresume body\n')], 'carol-resume.pdf', {
        type: 'application/pdf',
      })
    );

    const uploadReq = new NextRequest(
      `http://localhost:3000/api/join/${strictProject.slug}/apply`,
      { method: 'POST', headers: { cookie: carolCookie }, body: form }
    );
    const uploadRes = await applyToProject(uploadReq, {
      params: Promise.resolve({ slug: strictProject.slug }),
    });
    assert.equal(uploadRes.status, 201);
    const uploaded = await uploadRes.json();

    const stored = await storage.getApplicantById(uploaded.applicant.id);
    assert.equal(stored?.githubUrl, 'https://github.com/carol-candidate');
    assert.equal(stored?.linkedinUrl, '');
    assert.equal(stored?.resumeFileName, 'carol-resume.pdf');
    assert.ok(stored?.resumePath);

    const ownerResumeReq = new NextRequest(
      `http://localhost:3000/api/resume/${uploaded.applicant.id}`,
      { headers: { cookie: ownerCookie } }
    );
    const ownerResumeRes = await getResume(ownerResumeReq, {
      params: Promise.resolve({ applicantId: uploaded.applicant.id }),
    });
    assert.equal(ownerResumeRes.status, 200);
    assert.equal(ownerResumeRes.headers.get('content-type'), 'application/pdf');
    assert.equal(ownerResumeRes.headers.get('x-content-type-options'), 'nosniff');

    const stranger = await storage.saveUser({
      id: 404,
      login: 'dave-stranger',
      name: 'Dave',
      createdAt: '2024-02-01T00:00:00Z',
      publicRepos: 1,
    });
    const strangerSession = await storage.createSession(stranger.id);
    const strangerCookie = `crewlink_session=${encodeURIComponent(signValue(strangerSession))}`;

    const strangerResumeReq = new NextRequest(
      `http://localhost:3000/api/resume/${uploaded.applicant.id}`,
      { headers: { cookie: strangerCookie } }
    );
    const strangerResumeRes = await getResume(strangerResumeReq, {
      params: Promise.resolve({ applicantId: uploaded.applicant.id }),
    });
    assert.equal(strangerResumeRes.status, 403);

    const projectsReq = new NextRequest('http://localhost:3000/api/projects', {
      headers: { cookie: ownerCookie },
    });
    const projectsRes = await getProjects(projectsReq);
    const projectsData = await projectsRes.json();
    const serialized = JSON.stringify(projectsData);
    assert.equal(serialized.includes('resumePath'), false);
    assert.equal(serialized.includes(stored?.resumePath), false);

    await deleteResume(stored?.resumePath);
  });
});
