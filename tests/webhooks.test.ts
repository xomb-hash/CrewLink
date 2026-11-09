import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import './setup';
import { storage } from '../src/lib/storage';
import { POST as webhookHandler } from '../src/app/api/webhooks/github/route';

test('GitHub webhook: handles ping event', async () => {
  const payload = JSON.stringify({ zen: 'Keep it logically awesome.' });
  const req = new NextRequest('http://localhost:3000/api/webhooks/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'ping',
    },
    body: payload,
  });

  const res = await webhookHandler(req);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.message, 'pong');
  assert.equal(data.zen, 'Keep it logically awesome.');
});

test('GitHub webhook: validates HMAC-SHA256 signature', async () => {
  process.env.GITHUB_WEBHOOK_SECRET = 'test-secret-key-123';

  const payload = JSON.stringify({ zen: 'Non-matching signature payload' });

  // 1. Invalid signature
  const badReq = new NextRequest('http://localhost:3000/api/webhooks/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'ping',
      'x-hub-signature-256': 'sha256=invalidhexsignature000000000000000000000000000000000000000000000000',
    },
    body: payload,
  });

  const badRes = await webhookHandler(badReq);
  assert.equal(badRes.status, 401);

  // 2. Valid signature
  const hmac = crypto.createHmac('sha256', 'test-secret-key-123').update(payload).digest('hex');
  const goodReq = new NextRequest('http://localhost:3000/api/webhooks/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'ping',
      'x-hub-signature-256': `sha256=${hmac}`,
    },
    body: payload,
  });

  const goodRes = await webhookHandler(goodReq);
  assert.equal(goodRes.status, 200);

  delete process.env.GITHUB_WEBHOOK_SECRET;
});

test('GitHub webhook: records collaborator acceptance when member is added', async () => {
  storage.reset();

  const project = await storage.createProject({
    ownerLogin: 'repo-owner',
    ownerId: 501,
    repoFullName: 'repo-owner/enterprise-suite',
    repoName: 'enterprise-suite',
    repoOwner: 'repo-owner',
  });

  const applicant = await storage.createApplicant({
    projectId: project.id,
    userId: 888,
    userLogin: 'awesome-dev',
    accountAge: '2 years ago',
    publicRepoCount: 15,
  });

  assert.equal(applicant.status, 'pending');

  const webhookPayload = JSON.stringify({
    action: 'added',
    member: {
      id: 888,
      login: 'awesome-dev',
    },
    repository: {
      full_name: 'repo-owner/enterprise-suite',
    },
  });

  const req = new NextRequest('http://localhost:3000/api/webhooks/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': 'member',
    },
    body: webhookPayload,
  });

  const res = await webhookHandler(req);
  assert.equal(res.status, 200);

  const updatedApplicant = await storage.getApplicantById(applicant.id);
  assert.equal(updatedApplicant?.status, 'approved');
  assert.ok(updatedApplicant?.invitationDetails);
});
