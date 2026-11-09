import './setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { storage } from '../src/lib/storage';
import { POST as approveApplicant } from '../src/app/api/projects/[id]/applicants/[applicantId]/approve/route';
import { POST as rejectApplicant } from '../src/app/api/projects/[id]/applicants/[applicantId]/reject/route';
import { GET as getProjectById } from '../src/app/api/projects/[id]/route';
import { signValue } from '../src/lib/auth';

test('Server-side security checks (TypeScript)', async (t) => {
  storage.reset();

  const realOwner = await storage.saveUser({
    id: 101,
    login: 'alice-owner',
    accessToken: 'fake-token-alice',
  });

  const impostor = await storage.saveUser({
    id: 999,
    login: 'mallory-impostor',
    accessToken: 'fake-token-mallory',
  });

  const project = await storage.createProject({
    ownerLogin: realOwner.login,
    ownerId: realOwner.id,
    repoFullName: 'alice-owner/rocket-ship',
    repoName: 'rocket-ship',
    repoOwner: 'alice-owner',
    isPrivate: false,
    title: 'Rocket Ship',
  });

  const applicant = await storage.createApplicant({
    projectId: project.id,
    userId: '202',
    userLogin: 'bob-builder',
    accountAge: '2 years',
    publicRepoCount: 10,
  });

  const impostorSession = await storage.createSession(impostor.id);
  const impostorCookie = `crewlink_session=${encodeURIComponent(signValue(impostorSession))}`;

  await t.test('blocks non-owner from approving applicants with 403 Forbidden', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/projects/${project.id}/applicants/${applicant.id}/approve`,
      {
        method: 'POST',
        headers: { cookie: impostorCookie },
      }
    );

    const res = await approveApplicant(req, {
      params: Promise.resolve({ id: project.id, applicantId: applicant.id }),
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.includes('Only the project owner'));
  });

  await t.test('blocks non-owner from rejecting applicants with 403 Forbidden', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/projects/${project.id}/applicants/${applicant.id}/reject`,
      {
        method: 'POST',
        headers: { cookie: impostorCookie },
      }
    );

    const res = await rejectApplicant(req, {
      params: Promise.resolve({ id: project.id, applicantId: applicant.id }),
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.includes('Only the project owner'));
  });

  await t.test('blocks non-owner from viewing project applicant details with 403 Forbidden', async () => {
    const req = new NextRequest(`http://localhost:3000/api/projects/${project.id}`, {
      headers: { cookie: impostorCookie },
    });

    const res = await getProjectById(req, {
      params: Promise.resolve({ id: project.id }),
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.includes('not the owner'));
  });
});
