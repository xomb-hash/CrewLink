import './setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { storage } from '../src/lib/storage';
import { setGitHubClient } from '../src/github/index';
import { FakeGitHubApi } from '../src/github/fake';
import { signValue } from '../src/lib/auth';
import { generateReferralCode, normalizeReferralCode, referralCodeMatches } from '../src/projects/referral';
import { referralCodeState } from '../src/projects/referralState';
import { generateShareLinks } from '../src/projects/share';
import { POST as regenerateCode } from '../src/app/api/projects/[id]/referral-code/route';
import { POST as applyToProject } from '../src/app/api/join/[slug]/apply/route';
import { GET as getNotifications } from '../src/app/api/notifications/route';
import { POST as approveApplicant } from '../src/app/api/projects/[id]/applicants/[applicantId]/approve/route';
import { POST as createProjectRoute, GET as getProjects } from '../src/app/api/projects/route';
import { GET as getLogo } from '../src/app/api/projects/[id]/logo/route';
import { deleteLogo, validateLogoFile } from '../src/lib/uploads';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function cookieFor(sessionId: string) {
  return `crewlink_session=${encodeURIComponent(signValue(sessionId))}`;
}

test('Referral code helpers', async (t) => {
  await t.test('generates unambiguous 8-character codes', () => {
    for (let i = 0; i < 20; i += 1) {
      assert.match(generateReferralCode(), /^[A-HJ-NP-Z2-9]{8}$/);
    }
  });

  await t.test('normalizes and compares codes case-insensitively', () => {
    assert.equal(normalizeReferralCode('  ab12cd34 '), 'AB12CD34');
    assert.equal(normalizeReferralCode(undefined), '');
    assert.equal(referralCodeMatches('AB12CD34', 'ab12cd34'), true);
    assert.equal(referralCodeMatches('AB12CD34', 'ZZ99ZZ99'), false);
    assert.equal(referralCodeMatches('AB12CD34', ''), false);
  });

  await t.test('embeds the code in the join link while it is active', () => {
    const share = generateShareLinks(
      {
        slug: 'rocket-ship-1a2b',
        title: 'Rocket Ship',
        referralCode: 'AB12CD34',
        referralCodeCreatedAt: new Date().toISOString(),
      },
      'http://localhost:3000'
    );
    assert.equal(
      share.joinUrl,
      'http://localhost:3000/join/rocket-ship-1a2b?ref=AB12CD34'
    );
  });

  await t.test('omits used or expired codes from the join link', () => {
    const base = { slug: 'rocket-ship-1a2b', title: 'Rocket Ship', referralCode: 'AB12CD34' };
    const used = generateShareLinks(
      { ...base, referralCodeUsedAt: new Date().toISOString() },
      'http://localhost:3000'
    );
    const expired = generateShareLinks(
      {
        ...base,
        referralCodeCreatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      },
      'http://localhost:3000'
    );
    assert.equal(used.joinUrl, 'http://localhost:3000/join/rocket-ship-1a2b');
    assert.equal(expired.joinUrl, 'http://localhost:3000/join/rocket-ship-1a2b');
  });
});

test('Referral code API and notifications', async (t) => {
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
  const applicant = await storage.saveUser({
    id: 202,
    login: 'bob-builder',
    name: 'Bob',
    createdAt: '2023-01-01T00:00:00Z',
    publicRepos: 8,
    accessToken: 'fake-token-bob',
  });

  const ownerCookie = cookieFor(await storage.createSession(owner.id));
  const applicantCookie = cookieFor(await storage.createSession(applicant.id));

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

  const originalCode = String(project.referralCode);
  assert.match(originalCode, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(referralCodeState(project), 'active');
  let currentCode = originalCode;

  await t.test('rejects joining without the invite code', async () => {
    const req = new NextRequest(`http://localhost:3000/api/join/${project.slug}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: applicantCookie },
      body: JSON.stringify({ message: 'Let me in.' }),
    });
    const res = await applyToProject(req, { params: Promise.resolve({ slug: project.slug }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.errors.some((e: string) => e.includes('referral code')));
  });

  await t.test('only the owner can regenerate the code', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/projects/${project.id}/referral-code`,
      { method: 'POST', headers: { cookie: applicantCookie } }
    );
    const res = await regenerateCode(req, { params: Promise.resolve({ id: project.id }) });
    assert.equal(res.status, 403);
  });

  await t.test('regenerating invalidates the old code and updates the link', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/projects/${project.id}/referral-code`,
      { method: 'POST', headers: { cookie: ownerCookie } }
    );
    const res = await regenerateCode(req, { params: Promise.resolve({ id: project.id }) });
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.match(data.referralCode, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.notEqual(data.referralCode, originalCode);
    assert.ok(data.shareLinks.joinUrl.endsWith(`?ref=${data.referralCode}`));

    const staleReq = new NextRequest(`http://localhost:3000/api/join/${project.slug}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: applicantCookie },
      body: JSON.stringify({ message: 'Old link.', referralCode: originalCode }),
    });
    const staleRes = await applyToProject(staleReq, {
      params: Promise.resolve({ slug: project.slug }),
    });
    assert.equal(staleRes.status, 400);

    const freshReq = new NextRequest(`http://localhost:3000/api/join/${project.slug}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: applicantCookie },
      body: JSON.stringify({ message: 'Fresh link.', referralCode: data.referralCode.toLowerCase() }),
    });
    const freshRes = await applyToProject(freshReq, {
      params: Promise.resolve({ slug: project.slug }),
    });
    assert.equal(freshRes.status, 201);

    currentCode = String(data.referralCode);
    assert.ok(data.referralCodeCreatedAt);
    assert.ok(data.expiresAt);
    const storedAfterFresh = await storage.getProjectById(project.id);
    assert.equal(referralCodeState(storedAfterFresh!), 'used');
  });

  await t.test('rejects a second person using the same code', async () => {
    const carol = await storage.saveUser({
      id: 303,
      login: 'carol-dev',
      name: 'Carol',
      createdAt: '2022-01-01T00:00:00Z',
      publicRepos: 5,
      accessToken: 'fake-token-carol',
    });
    const carolCookie = cookieFor(await storage.createSession(carol.id));

    const req = new NextRequest(`http://localhost:3000/api/join/${project.slug}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: carolCookie },
      body: JSON.stringify({ message: 'Second person.', referralCode: currentCode }),
    });
    const res = await applyToProject(req, { params: Promise.resolve({ slug: project.slug }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.errors.some((e: string) => e.includes('already been used')));

    const applicants = await storage.getApplicantsByProject(project.id);
    assert.equal(applicants.length, 1);
  });

  await t.test('rejects an expired code', async () => {
    const expiredProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'alice-owner/old-ship',
      repoName: 'old-ship',
      repoOwner: 'alice-owner',
      isPrivate: false,
      joinMode: 'referral',
      referralCode: 'EXPIRE22',
      referralCodeCreatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      title: 'Old Ship',
    });
    assert.equal(referralCodeState(expiredProject), 'expired');

    const req = new NextRequest(`http://localhost:3000/api/join/${expiredProject.slug}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: applicantCookie },
      body: JSON.stringify({ message: 'Late.', referralCode: 'EXPIRE22' }),
    });
    const res = await applyToProject(req, {
      params: Promise.resolve({ slug: expiredProject.slug }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.errors.some((e: string) => e.includes('expired')));
  });

  await t.test('owner can replace a used code with a fresh one', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/projects/${project.id}/referral-code`,
      { method: 'POST', headers: { cookie: ownerCookie } }
    );
    const res = await regenerateCode(req, { params: Promise.resolve({ id: project.id }) });
    assert.equal(res.status, 200);
    const data = await res.json();

    const stored = await storage.getProjectById(project.id);
    assert.equal(referralCodeState(stored!), 'active');
    assert.ok(!stored?.referralCodeUsedAt);
    assert.ok(data.shareLinks.joinUrl.endsWith(`?ref=${data.referralCode}`));
  });

  await t.test('screening projects cannot have referral codes', async () => {
    const screeningProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'alice-owner/screening-ship',
      repoName: 'screening-ship',
      repoOwner: 'alice-owner',
      isPrivate: false,
      joinMode: 'screening',
      screeningUrl: 'https://example.com/test',
      title: 'Screening Ship',
    });

    const req = new NextRequest(
      `http://localhost:3000/api/projects/${screeningProject.id}/referral-code`,
      { method: 'POST', headers: { cookie: ownerCookie } }
    );
    const res = await regenerateCode(req, {
      params: Promise.resolve({ id: screeningProject.id }),
    });
    assert.equal(res.status, 400);
  });

  await t.test('notifies the owner about pending requests and the applicant about decisions', async () => {
    const ownerReq = new NextRequest('http://localhost:3000/api/notifications', {
      headers: { cookie: ownerCookie },
    });
    const ownerRes = await getNotifications(ownerReq);
    assert.equal(ownerRes.status, 200);
    const ownerData = await ownerRes.json();
    assert.equal(ownerData.pendingCount, 1);
    assert.ok(
      ownerData.notifications.some(
        (item: { kind: string; title: string }) =>
          item.kind === 'join_request' && item.title.includes('@bob-builder')
      )
    );

    const applications = await storage.getApplicantsByUser(applicant.id);
    assert.equal(applications.length, 1);

    const approveReq = new NextRequest(
      `http://localhost:3000/api/projects/${project.id}/applicants/${applications[0].id}/approve`,
      { method: 'POST', headers: { cookie: ownerCookie } }
    );
    const approveRes = await approveApplicant(approveReq, {
      params: Promise.resolve({ id: project.id, applicantId: applications[0].id }),
    });
    assert.equal(approveRes.status, 200);

    const afterRes = await getNotifications(ownerReq);
    const afterData = await afterRes.json();
    assert.equal(afterData.pendingCount, 0);

    const applicantReq = new NextRequest('http://localhost:3000/api/notifications', {
      headers: { cookie: applicantCookie },
    });
    const applicantRes = await getNotifications(applicantReq);
    const applicantData = await applicantRes.json();
    assert.ok(
      applicantData.notifications.some(
        (item: { kind: string; title: string }) =>
          item.kind === 'application_status' && item.title.includes('approved')
      )
    );
  });

  await t.test('requires a session for notifications', async () => {
    const req = new NextRequest('http://localhost:3000/api/notifications');
    const res = await getNotifications(req);
    assert.equal(res.status, 401);
  });
});

test('Project logo upload and serving', async (t) => {
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
  const ownerCookie = cookieFor(await storage.createSession(owner.id));

  let logoPath: string | undefined;
  let projectId = '';

  await t.test('validates logo type, size, and extension', () => {
    assert.equal(validateLogoFile({ size: 1024, type: 'image/png', name: 'logo.png' }), null);
    assert.match(
      validateLogoFile({ size: 0, type: 'image/png', name: 'logo.png' }) || '',
      /empty/
    );
    assert.match(
      validateLogoFile({ size: 3 * 1024 * 1024, type: 'image/png', name: 'logo.png' }) || '',
      /2 MB/
    );
    assert.match(
      validateLogoFile({ size: 1024, type: 'image/gif', name: 'logo.gif' }) || '',
      /PNG/
    );
  });

  await t.test('creates a project with a logo from multipart form data', async () => {
    const form = new FormData();
    form.set('repoFullName', 'alice-owner/rocket-ship');
    form.set('joinMode', 'referral');
    form.set('title', 'Rocket Ship');
    form.set('description', 'Building an orbital engine.');
    form.set('roles', JSON.stringify(['Propulsion', 'Avionics']));
    form.set('logo', new File([PNG_BYTES], 'badge.png', { type: 'image/png' }));

    const req = new NextRequest('http://localhost:3000/api/projects', {
      method: 'POST',
      headers: { cookie: ownerCookie },
      body: form,
    });
    const res = await createProjectRoute(req);
    assert.equal(res.status, 201);
    const data = await res.json();

    projectId = data.project.id;
    assert.equal(data.project.logoUrl, `/api/projects/${projectId}/logo`);
    assert.equal('logoPath' in data.project, false);
    assert.ok(data.project.referralCode);
    assert.ok(data.project.shareLinks.joinUrl.includes(`?ref=${data.project.referralCode}`));

    const stored = await storage.getProjectById(projectId);
    assert.match(String(stored?.logoPath), /^logo-[a-f0-9-]+\.png$/);
    logoPath = stored?.logoPath;
  });

  await t.test('serves the stored logo with safe headers', async () => {
    const req = new NextRequest(`http://localhost:3000/api/projects/${projectId}/logo`);
    const res = await getLogo(req, { params: Promise.resolve({ id: projectId }) });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(bytes, PNG_BYTES);
  });

  await t.test('does not leak the logo path through the projects API', async () => {
    const req = new NextRequest('http://localhost:3000/api/projects', {
      headers: { cookie: ownerCookie },
    });
    const res = await getProjects(req);
    const data = await res.json();
    assert.equal(JSON.stringify(data).includes('logoPath'), false);
    assert.ok(data.projects[0].logoUrl);
  });

  await t.test('rejects files that are not real images', async () => {
    const form = new FormData();
    form.set('repoFullName', 'alice-owner/secret-engine');
    form.set('joinMode', 'referral');
    form.set('title', 'Secret Engine');
    form.set('logo', new File([Buffer.from('not an image')], 'badge.png', { type: 'image/png' }));

    const req = new NextRequest('http://localhost:3000/api/projects', {
      method: 'POST',
      headers: { cookie: ownerCookie },
      body: form,
    });
    const res = await createProjectRoute(req);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.errors.some((e: string) => e.includes('valid PNG')));
  });

  await t.test('returns 404 when a project has no logo', async () => {
    const bare = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'alice-owner/bare-ship',
      repoName: 'bare-ship',
      repoOwner: 'alice-owner',
      isPrivate: false,
      joinMode: 'screening',
      screeningUrl: 'https://example.com/form',
      title: 'Bare Ship',
    });
    const req = new NextRequest(`http://localhost:3000/api/projects/${bare.id}/logo`);
    const res = await getLogo(req, { params: Promise.resolve({ id: bare.id }) });
    assert.equal(res.status, 404);
  });

  await deleteLogo(logoPath);
});
