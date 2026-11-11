import './setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { storage } from '../src/lib/storage';
import { setGitHubClient } from '../src/github/index';
import { FakeGitHubApi } from '../src/github/fake';
import { signValue } from '../src/lib/auth';
import { rateLimiter } from '../src/lib/rateLimit';
import { generateReferralCode, normalizeReferralCode, referralCodeMatches } from '../src/projects/referral';
import { referralCodeState } from '../src/projects/referralState';
import { generateShareLinks } from '../src/projects/share';
import {
  POST as regenerateCode,
  PATCH as updateReferralSettings,
  DELETE as revokeReferralCode,
} from '../src/app/api/projects/[id]/referral-code/route';
import { POST as applyToProject } from '../src/app/api/join/[slug]/apply/route';
import { GET as getJoinData } from '../src/app/api/join/[slug]/route';
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

function applyRequest(
  identifier: string,
  cookie: string,
  body: Record<string, unknown>
): NextRequest {
  return new NextRequest(`http://localhost:3000/api/join/${identifier}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

test('Referral code helpers', async (t) => {
  await t.test('generates short CREW- codes from an unambiguous alphabet', () => {
    for (let i = 0; i < 20; i += 1) {
      assert.match(generateReferralCode(), /^CREW-[A-HJ-NP-Z2-9]{5}$/);
    }
  });

  await t.test('normalizes and compares codes case-insensitively', () => {
    assert.equal(normalizeReferralCode('  crew-ab234 '), 'CREW-AB234');
    assert.equal(normalizeReferralCode(undefined), '');
    assert.equal(referralCodeMatches('CREW-AB234', 'crew-ab234'), true);
    assert.equal(referralCodeMatches('CREW-AB234', 'CREW-ZZ999'), false);
    assert.equal(referralCodeMatches('CREW-AB234', ''), false);
  });

  await t.test('uses the reusable code URL while the link is active', () => {
    const share = generateShareLinks(
      {
        slug: 'rocket-ship-1a2b',
        title: 'Rocket Ship',
        referralCode: 'CREW-AB234',
        referralCodeCreatedAt: new Date().toISOString(),
      },
      'http://localhost:3000'
    );
    assert.equal(share.joinUrl, 'http://localhost:3000/join/CREW-AB234');
    assert.ok(share.whatsApp.includes(encodeURIComponent('http://localhost:3000/join/CREW-AB234')));
  });

  await t.test('honours remaining uses before the limit is reached', () => {
    const project = {
      slug: 'rocket-ship-1a2b',
      title: 'Rocket Ship',
      referralCode: 'CREW-AB234',
      referralCodeUsageLimit: 2,
    };
    assert.equal(
      generateShareLinks(project, 'http://localhost:3000', 1).joinUrl,
      'http://localhost:3000/join/CREW-AB234'
    );
    assert.equal(
      generateShareLinks(project, 'http://localhost:3000', 2).joinUrl,
      'http://localhost:3000/join/rocket-ship-1a2b'
    );
  });

  await t.test('falls back to the slug URL for expired, revoked or missing codes', () => {
    const base = { slug: 'rocket-ship-1a2b', title: 'Rocket Ship', referralCode: 'CREW-AB234' };
    assert.equal(
      generateShareLinks(
        { ...base, referralCodeExpiresAt: new Date(Date.now() - 1000).toISOString() },
        'http://localhost:3000'
      ).joinUrl,
      'http://localhost:3000/join/rocket-ship-1a2b'
    );
    assert.equal(
      generateShareLinks(
        { ...base, referralCodeRevokedAt: new Date().toISOString() },
        'http://localhost:3000'
      ).joinUrl,
      'http://localhost:3000/join/rocket-ship-1a2b'
    );
    assert.equal(
      generateShareLinks({ slug: 'rocket-ship-1a2b', title: 'Rocket Ship' }, 'http://localhost:3000')
        .joinUrl,
      'http://localhost:3000/join/rocket-ship-1a2b'
    );
  });

  await t.test('classifies referral link state', () => {
    const project = {
      referralCode: 'CREW-AB234',
      referralCodeCreatedAt: new Date().toISOString(),
    };
    assert.equal(referralCodeState(project), 'active');
    assert.equal(referralCodeState({ ...project, referralCodeRevokedAt: new Date().toISOString() }), 'revoked');
    assert.equal(referralCodeState({ ...project, referralCodeUsedAt: new Date().toISOString() }), 'used');
    assert.equal(
      referralCodeState(
        { ...project, referralCodeExpiresAt: new Date(Date.now() - 1000).toISOString() },
        0
      ),
      'expired'
    );
    assert.equal(referralCodeState({ ...project, referralCodeUsageLimit: 2 }, 2), 'limit-reached');
    assert.equal(referralCodeState({}, 0), 'missing');
  });
});

test('Reusable referral links', async (t) => {
  const fakeGitHub = new FakeGitHubApi();
  setGitHubClient(fakeGitHub);
  storage.reset();
  rateLimiter.reset();

  const owner = await storage.saveUser({
    id: 101,
    login: 'alice-owner',
    name: 'Alice',
    createdAt: '2021-01-01T00:00:00Z',
    publicRepos: 10,
    accessToken: 'fake-token-alice',
  });
  const bob = await storage.saveUser({
    id: 202,
    login: 'bob-builder',
    name: 'Bob',
    createdAt: '2023-01-01T00:00:00Z',
    publicRepos: 8,
    accessToken: 'fake-token-bob',
  });
  const carol = await storage.saveUser({
    id: 303,
    login: 'carol-dev',
    name: 'Carol',
    createdAt: '2022-01-01T00:00:00Z',
    publicRepos: 5,
    accessToken: 'fake-token-carol',
  });
  const dave = await storage.saveUser({
    id: 404,
    login: 'dave-maker',
    name: 'Dave',
    createdAt: '2022-06-01T00:00:00Z',
    publicRepos: 4,
    accessToken: 'fake-token-dave',
  });
  const erin = await storage.saveUser({
    id: 505,
    login: 'erin-ops',
    name: 'Erin',
    createdAt: '2022-09-01T00:00:00Z',
    publicRepos: 6,
    accessToken: 'fake-token-erin',
  });
  const frank = await storage.saveUser({
    id: 606,
    login: 'frank-qa',
    name: 'Frank',
    createdAt: '2022-10-01T00:00:00Z',
    publicRepos: 3,
    accessToken: 'fake-token-frank',
  });
  const gina = await storage.saveUser({
    id: 707,
    login: 'gina-lab',
    name: 'Gina',
    createdAt: '2022-11-01T00:00:00Z',
    publicRepos: 7,
    accessToken: 'fake-token-gina',
  });

  const ownerCookie = cookieFor(await storage.createSession(owner.id));
  const bobCookie = cookieFor(await storage.createSession(bob.id));
  const carolCookie = cookieFor(await storage.createSession(carol.id));
  const daveCookie = cookieFor(await storage.createSession(dave.id));
  const erinCookie = cookieFor(await storage.createSession(erin.id));
  const frankCookie = cookieFor(await storage.createSession(frank.id));
  const ginaCookie = cookieFor(await storage.createSession(gina.id));

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'alice-owner/rocket-ship',
    repoName: 'rocket-ship',
    repoOwner: 'alice-owner',
    isPrivate: true,
    joinMode: 'referral',
    title: 'Rocket Ship',
  });

  const originalCode = String(project.referralCode);
  assert.match(originalCode, /^CREW-[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(referralCodeState(project), 'active');
  assert.equal(
    generateShareLinks(project, 'http://localhost:3000').joinUrl,
    `http://localhost:3000/join/${originalCode}`
  );
  let currentCode = originalCode;

  await t.test('rejects joining without the invite code', async () => {
    const req = applyRequest(project.slug, daveCookie, { message: 'Let me in.' });
    const res = await applyToProject(req, { params: Promise.resolve({ slug: project.slug }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.errors.some((e: string) => e.includes('referral code')));
  });

  await t.test('accepts the first applicant with the code in the body', async () => {
    const req = applyRequest(project.slug, bobCookie, {
      message: 'I built propulsion systems.',
      referralCode: currentCode.toLowerCase(),
    });
    const res = await applyToProject(req, { params: Promise.resolve({ slug: project.slug }) });
    assert.equal(res.status, 201);
  });

  await t.test('accepts a second applicant through the same code in the URL', async () => {
    const req = applyRequest(currentCode, carolCookie, { message: 'Avionics is my thing.' });
    const res = await applyToProject(req, { params: Promise.resolve({ slug: currentCode }) });
    assert.equal(res.status, 201);

    assert.equal(await storage.countApplicantsByReferralCode(project.id, currentCode), 2);
  });

  await t.test('prevents the same user from applying twice', async () => {
    const req = applyRequest(project.slug, bobCookie, {
      message: 'Trying again.',
      referralCode: currentCode,
    });
    const res = await applyToProject(req, { params: Promise.resolve({ slug: project.slug }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('already applied'));
  });

  await t.test('serves the private project by code without leaking the code', async () => {
    const req = new NextRequest(`http://localhost:3000/api/join/${currentCode}`);
    const res = await getJoinData(req, { params: Promise.resolve({ slug: currentCode }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.project.title, 'Rocket Ship');
    assert.equal(data.project.requiresReferralCode, true);
    assert.equal(JSON.stringify(data).includes(currentCode), false);
  });

  await t.test('only the owner can manage the link', async () => {
    const post = await regenerateCode(
      new NextRequest(`http://localhost:3000/api/projects/${project.id}/referral-code`, {
        method: 'POST',
        headers: { cookie: carolCookie },
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(post.status, 403);

    const patch = await updateReferralSettings(
      new NextRequest(`http://localhost:3000/api/projects/${project.id}/referral-code`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: carolCookie },
        body: JSON.stringify({ usageLimit: 10 }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(patch.status, 403);

    const del = await revokeReferralCode(
      new NextRequest(`http://localhost:3000/api/projects/${project.id}/referral-code`, {
        method: 'DELETE',
        headers: { cookie: carolCookie },
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(del.status, 403);
  });

  await t.test('enforces an optional usage limit', async () => {
    const patch = await updateReferralSettings(
      new NextRequest(`http://localhost:3000/api/projects/${project.id}/referral-code`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ usageLimit: 2 }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(patch.status, 200);
    const data = await patch.json();
    assert.equal(data.referralCodeUsageLimit, 2);
    assert.equal(data.usageCount, 2);
    assert.equal(data.shareLinks.joinUrl, `http://localhost:3000/join/${project.slug}`);

    const req = applyRequest(project.slug, daveCookie, {
      message: 'One more seat?',
      referralCode: currentCode,
    });
    const res = await applyToProject(req, { params: Promise.resolve({ slug: project.slug }) });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.errors.some((e: string) => e.includes('usage limit')));
  });

  await t.test('removing the limit makes the link reusable again', async () => {
    const patch = await updateReferralSettings(
      new NextRequest(`http://localhost:3000/api/projects/${project.id}/referral-code`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ usageLimit: null }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(patch.status, 200);
    const data = await patch.json();
    assert.equal(data.shareLinks.joinUrl, `http://localhost:3000/join/${currentCode}`);

    const req = applyRequest(project.slug, daveCookie, {
      message: 'Thanks for the extra seat.',
      referralCode: currentCode,
    });
    const res = await applyToProject(req, { params: Promise.resolve({ slug: project.slug }) });
    assert.equal(res.status, 201);
    assert.equal(await storage.countApplicantsByReferralCode(project.id, currentCode), 3);
  });

  await t.test('regenerating replaces the code and invalidates the old link', async () => {
    const res = await regenerateCode(
      new NextRequest(`http://localhost:3000/api/projects/${project.id}/referral-code`, {
        method: 'POST',
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.match(data.referralCode, /^CREW-[A-HJ-NP-Z2-9]{5}$/);
    assert.notEqual(data.referralCode, originalCode);
    assert.equal(data.usageCount, 0);
    assert.equal(data.shareLinks.joinUrl, `http://localhost:3000/join/${data.referralCode}`);

    const stale = await applyToProject(
      applyRequest(project.slug, erinCookie, { message: 'Old link.', referralCode: currentCode }),
      { params: Promise.resolve({ slug: project.slug }) }
    );
    assert.equal(stale.status, 400);
    const staleBody = await stale.json();
    assert.ok(staleBody.errors.some((e: string) => e.includes('not valid')));

    const fresh = await applyToProject(
      applyRequest(data.referralCode, erinCookie, { message: 'New link.' }),
      { params: Promise.resolve({ slug: data.referralCode }) }
    );
    assert.equal(fresh.status, 201);

    currentCode = String(data.referralCode);
    assert.equal(await storage.countApplicantsByReferralCode(project.id, currentCode), 1);
  });

  await t.test('rejects an expired link', async () => {
    const patch = await updateReferralSettings(
      new NextRequest(`http://localhost:3000/api/projects/${project.id}/referral-code`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
        body: JSON.stringify({ expiresAt: new Date(Date.now() - 60_000).toISOString() }),
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(patch.status, 200);
    const data = await patch.json();
    assert.equal(data.shareLinks.joinUrl, `http://localhost:3000/join/${project.slug}`);

    const res = await applyToProject(
      applyRequest(project.slug, frankCookie, { message: 'Late.', referralCode: currentCode }),
      { params: Promise.resolve({ slug: project.slug }) }
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.errors.some((e: string) => e.includes('expired')));
  });

  await t.test('revoking deactivates the link immediately', async () => {
    const res = await revokeReferralCode(
      new NextRequest(`http://localhost:3000/api/projects/${project.id}/referral-code`, {
        method: 'DELETE',
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.referralCodeRevokedAt);
    assert.equal(data.shareLinks.joinUrl, `http://localhost:3000/join/${project.slug}`);

    const apply = await applyToProject(
      applyRequest(currentCode, ginaCookie, { message: 'Can I still join?', referralCode: currentCode }),
      { params: Promise.resolve({ slug: currentCode }) }
    );
    assert.equal(apply.status, 400);
    const body = await apply.json();
    assert.ok(body.errors.some((e: string) => e.includes('revoked')));
  });

  await t.test('screening projects cannot have referral links', async () => {
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

    const res = await regenerateCode(
      new NextRequest(`http://localhost:3000/api/projects/${screeningProject.id}/referral-code`, {
        method: 'POST',
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: screeningProject.id }) }
    );
    assert.equal(res.status, 400);
  });

  await t.test('every private project gets its own unique code', async () => {
    const second = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'alice-owner/second-ship',
      repoName: 'second-ship',
      repoOwner: 'alice-owner',
      isPrivate: true,
      joinMode: 'referral',
      title: 'Second Ship',
    });
    assert.match(String(second.referralCode), /^CREW-[A-HJ-NP-Z2-9]{5}$/);
    assert.notEqual(second.referralCode, originalCode);
    assert.notEqual(second.referralCode, currentCode);
  });

  await t.test('notifies the owner about every pending request', async () => {
    const ownerReq = new NextRequest('http://localhost:3000/api/notifications', {
      headers: { cookie: ownerCookie },
    });
    const ownerRes = await getNotifications(ownerReq);
    assert.equal(ownerRes.status, 200);
    const ownerData = await ownerRes.json();
    assert.equal(ownerData.pendingCount, 4);
    for (const login of ['bob-builder', 'carol-dev', 'dave-maker', 'erin-ops']) {
      assert.ok(
        ownerData.notifications.some(
          (item: { kind: string; title: string }) =>
            item.kind === 'join_request' && item.title.includes(`@${login}`)
        )
      );
    }

    const bobApplications = await storage.getApplicantsByUser(bob.id);
    assert.equal(bobApplications.length, 1);

    const approveRes = await approveApplicant(
      new NextRequest(
        `http://localhost:3000/api/projects/${project.id}/applicants/${bobApplications[0].id}/approve`,
        { method: 'POST', headers: { cookie: ownerCookie } }
      ),
      { params: Promise.resolve({ id: project.id, applicantId: bobApplications[0].id }) }
    );
    assert.equal(approveRes.status, 200);

    const afterData = await (await getNotifications(ownerReq)).json();
    assert.equal(afterData.pendingCount, 3);

    const bobData = await (
      await getNotifications(
        new NextRequest('http://localhost:3000/api/notifications', {
          headers: { cookie: bobCookie },
        })
      )
    ).json();
    assert.ok(
      bobData.notifications.some(
        (item: { kind: string; title: string }) =>
          item.kind === 'application_status' && item.title.includes('approved')
      )
    );
  });

  await t.test('requires a session for notifications', async () => {
    const res = await getNotifications(new NextRequest('http://localhost:3000/api/notifications'));
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
    assert.match(data.project.referralCode, /^CREW-[A-HJ-NP-Z2-9]{5}$/);
    assert.ok(
      data.project.shareLinks.joinUrl.endsWith(`/join/${data.project.referralCode}`)
    );

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
