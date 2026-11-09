import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import './setup';
import { storage } from '../src/lib/storage';
import { signValue, SESSION_COOKIE } from '../src/lib/auth';
import { GET as exploreHandler } from '../src/app/api/explore/route';
import { GET as applicationsHandler } from '../src/app/api/applications/route';

test('Explore & Applications API route handlers (TypeScript)', async (t) => {
  // Setup mock owner and project
  const owner = await storage.saveUser({
    id: 991,
    login: 'explore-owner',
    name: 'Explore Owner',
    avatarUrl: 'https://github.com/explore-owner.png',
  });

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: String(owner.id),
    repoFullName: 'explore-owner/awesome-engine',
    repoName: 'awesome-engine',
    repoOwner: 'explore-owner',
    title: 'Awesome Engine',
    description: 'High performance physics engine looking for help.',
    roles: ['Physics Dev', 'C++ Expert'],
    joinMode: 'referral',
  });

  // Setup mock applicant
  const applicantUser = await storage.saveUser({
    id: 992,
    login: 'builder-bob',
    name: 'Builder Bob',
    avatarUrl: 'https://github.com/builder-bob.png',
  });

  const sessionId = await storage.createSession(applicantUser.id);
  const signedCookie = signValue(sessionId);

  // Apply to project
  await storage.createApplicant({
    projectId: project.id,
    userId: applicantUser.id,
    userLogin: applicantUser.login,
    accountAge: '2 years ago',
    publicRepoCount: 15,
    message: 'I would love to help with the collision solver!',
  });

  await t.test('GET /api/explore returns list of projects with roles and applicant counts', async () => {
    const req = new NextRequest('http://localhost:3000/api/explore');
    const res = await exploreHandler(req);

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.projects));
    assert.ok(data.total >= 1);

    const found = data.projects.find((p: { id: string }) => p.id === project.id);
    assert.ok(found);
    assert.equal(found.title, 'Awesome Engine');
    assert.deepEqual(found.roles, ['Physics Dev', 'C++ Expert']);
    assert.equal(found.applicantsCount, 1);
    assert.ok(found.joinUrl.includes(project.slug));
  });

  await t.test('GET /api/explore filters by role and search query', async () => {
    // Search matching "physics"
    const req1 = new NextRequest('http://localhost:3000/api/explore?q=physics');
    const res1 = await exploreHandler(req1);
    const data1 = await res1.json();
    assert.ok(data1.projects.some((p: { id: string }) => p.id === project.id));

    // Filter matching role "C++ Expert"
    const req2 = new NextRequest('http://localhost:3000/api/explore?role=c%2B%2B');
    const res2 = await exploreHandler(req2);
    const data2 = await res2.json();
    assert.ok(data2.projects.some((p: { id: string }) => p.id === project.id));

    // Filter with non-matching role
    const req3 = new NextRequest('http://localhost:3000/api/explore?role=nonexistentrole');
    const res3 = await exploreHandler(req3);
    const data3 = await res3.json();
    assert.equal(data3.projects.length, 0);
  });

  await t.test('GET /api/applications returns list of applications for signed in user', async () => {
    const req = new NextRequest('http://localhost:3000/api/applications', {
      headers: {
        cookie: `${SESSION_COOKIE}=${encodeURIComponent(signedCookie)}`,
      },
    });

    const res = await applicationsHandler(req);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.ok(Array.isArray(data.applications));
    assert.equal(data.total, 1);
    assert.equal(data.applications[0].projectId, project.id);
    assert.equal(data.applications[0].project.title, 'Awesome Engine');
    assert.equal(data.applications[0].status, 'pending');
  });

  await t.test('GET /api/applications blocks unauthenticated requests with 401', async () => {
    const req = new NextRequest('http://localhost:3000/api/applications');
    const res = await applicationsHandler(req);
    assert.equal(res.status, 401);
  });
});
