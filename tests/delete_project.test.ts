import './setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { storage } from '../src/lib/storage';
import { signValue } from '../src/lib/auth';
import { DELETE as deleteProject } from '../src/app/api/projects/[id]/route';

function cookieFor(sessionId: string) {
  return `crewlink_session=${encodeURIComponent(signValue(sessionId))}`;
}

function uploadsPath(name: string) {
  return path.resolve(process.cwd(), 'data', 'uploads', name);
}

function createUploadFile(name: string) {
  const dir = path.resolve(process.cwd(), 'data', 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(uploadsPath(name), 'fake-upload');
}

test('Delete project API', async (t) => {
  storage.reset();

  const owner = await storage.saveUser({
    id: 301,
    login: 'owner-delete',
    name: 'Owner',
    createdAt: '2021-01-01T00:00:00Z',
    publicRepos: 12,
    accessToken: 'fake-token-owner',
  });
  const other = await storage.saveUser({
    id: 302,
    login: 'other-user',
    name: 'Other',
    createdAt: '2022-01-01T00:00:00Z',
    publicRepos: 3,
    accessToken: 'fake-token-other',
  });
  const applicantUser = await storage.saveUser({
    id: 303,
    login: 'applicant-one',
    name: 'Applicant',
    createdAt: '2023-01-01T00:00:00Z',
    publicRepos: 4,
    accessToken: 'fake-token-applicant',
  });

  const ownerCookie = cookieFor(await storage.createSession(owner.id));
  const otherCookie = cookieFor(await storage.createSession(other.id));

  const logoName = `logo-${crypto.randomUUID()}.png`;
  const resumeName = `${crypto.randomUUID()}.pdf`;
  createUploadFile(logoName);
  createUploadFile(resumeName);

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'owner-delete/rocket',
    repoName: 'rocket',
    repoOwner: 'owner-delete',
    joinMode: 'screening',
    title: 'Rocket',
    logoPath: logoName,
  });
  const otherProject = await storage.createProject({
    ownerLogin: other.login,
    ownerId: other.id,
    repoFullName: 'other-user/keep-me',
    repoName: 'keep-me',
    repoOwner: 'other-user',
    joinMode: 'referral',
    title: 'Keep Me',
  });

  await storage.createApplicant({
    projectId: project.id,
    userId: applicantUser.id,
    userLogin: applicantUser.login,
    accountAge: '2 years',
    publicRepoCount: 4,
    resumeFileName: 'cv.pdf',
    resumePath: resumeName,
  });
  await storage.createDraft({ projectId: project.id, platformId: 'linkedin', text: 'Draft text' });

  await t.test('rejects unauthenticated requests', async () => {
    const req = new NextRequest(`http://localhost:3000/api/projects/${project.id}`, {
      method: 'DELETE',
    });
    const res = await deleteProject(req, { params: Promise.resolve({ id: project.id }) });
    assert.equal(res.status, 401);
    assert.ok(await storage.getProjectById(project.id));
  });

  await t.test('returns 404 for unknown projects', async () => {
    const req = new NextRequest('http://localhost:3000/api/projects/prj_missing', {
      method: 'DELETE',
      headers: { cookie: ownerCookie },
    });
    const res = await deleteProject(req, { params: Promise.resolve({ id: 'prj_missing' }) });
    assert.equal(res.status, 404);
  });

  await t.test('only the owner can delete a project', async () => {
    const req = new NextRequest(`http://localhost:3000/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: { cookie: otherCookie },
    });
    const res = await deleteProject(req, { params: Promise.resolve({ id: project.id }) });
    assert.equal(res.status, 403);
    assert.ok(await storage.getProjectById(project.id));
  });

  await t.test('owner deletion removes the project, applicants, drafts, and uploads', async () => {
    const req = new NextRequest(`http://localhost:3000/api/projects/${project.id}`, {
      method: 'DELETE',
      headers: { cookie: ownerCookie },
    });
    const res = await deleteProject(req, { params: Promise.resolve({ id: project.id }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);

    assert.equal(await storage.getProjectById(project.id), null);
    assert.equal((await storage.getApplicantsByProject(project.id)).length, 0);
    assert.equal((await storage.getDraftsByProject(project.id)).length, 0);
    assert.equal(fs.existsSync(uploadsPath(logoName)), false);
    assert.equal(fs.existsSync(uploadsPath(resumeName)), false);

    // Another owner's project is untouched.
    assert.ok(await storage.getProjectById(otherProject.id));
  });
});
