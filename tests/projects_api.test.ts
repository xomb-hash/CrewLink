import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { storage } from '../src/lib/storage';
import { setGitHubClient } from '../src/github/index';
import { FakeGitHubApi } from '../src/github/fake';
import { POST, GET } from '../src/app/api/projects/route';
import { signValue } from '../src/lib/auth';

test('Project API route handlers (TypeScript)', async (t) => {
  const fakeGitHub = new FakeGitHubApi();
  setGitHubClient(fakeGitHub);
  storage.reset();

  const owner = await storage.saveUser({
    id: 101,
    login: 'alice-owner',
    name: 'Alice Owner',
    createdAt: '2022-01-01T00:00:00Z',
    publicRepos: 14,
    accessToken: 'fake-token-alice',
  });

  const sessionId = await storage.createSession(owner.id);
  const sessionCookie = `crewlink_session=${encodeURIComponent(signValue(sessionId))}`;

  await t.test('creates project successfully when user is admin', async () => {
    const req = new NextRequest('http://localhost:3000/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: sessionCookie,
      },
      body: JSON.stringify({
        repoFullName: 'alice-owner/rocket-ship',
        joinMode: 'referral',
        title: 'Mission to Orbit',
        description: 'Building an orbital engine.',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 201);

    const data = await res.json();
    assert.ok(data.project);
    assert.equal(data.project.title, 'Mission to Orbit');
    assert.equal(data.project.repoFullName, 'alice-owner/rocket-ship');
    assert.ok(data.project.shareLinks.joinUrl);
  });

  await t.test('rejects project creation if user is not repo admin', async () => {
    const req = new NextRequest('http://localhost:3000/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: sessionCookie,
      },
      body: JSON.stringify({
        repoFullName: 'someone-else/private-repo',
        joinMode: 'referral',
        title: 'Unauthorized Project',
      }),
    });

    const res = await POST(req);
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.includes('administrative access'));
  });

  await t.test('lists projects with applicants and share links', async () => {
    const req = new NextRequest('http://localhost:3000/api/projects', {
      headers: { cookie: sessionCookie },
    });
    const res = await GET(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.projects));
    assert.equal(data.projects.length, 1);
    assert.equal(data.projects[0].repoFullName, 'alice-owner/rocket-ship');
  });
});
