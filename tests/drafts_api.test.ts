import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import './setup';
import { storage } from '../src/lib/storage';
import { signValue } from '../src/lib/auth';
import { GET as getDrafts, POST as createDrafts } from '../src/app/api/projects/[id]/drafts/route';
import { PUT as editDraft } from '../src/app/api/drafts/[id]/route';
import { POST as approveDraft } from '../src/app/api/drafts/[id]/approve/route';
import { POST as skipDraft } from '../src/app/api/drafts/[id]/skip/route';
import { POST as personalPost } from '../src/app/api/projects/[id]/personal-post/route';

test('Drafts API route handlers (TypeScript)', async (t) => {
  storage.reset();

  const owner = await storage.saveUser({
    id: 101,
    login: 'alice-owner',
    name: 'Alice',
  });

  const session = await storage.createSession(owner.id);
  const cookie = `crewlink_session=${encodeURIComponent(signValue(session))}`;

  const otherUser = await storage.saveUser({
    id: 202,
    login: 'intruder',
    name: 'Eve',
  });
  const intruderSession = await storage.createSession(otherUser.id);
  const intruderCookie = `crewlink_session=${encodeURIComponent(signValue(intruderSession))}`;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'alice-owner/rocket-ship',
    repoName: 'rocket-ship',
    repoOwner: 'alice-owner',
    title: 'Rocket Ship',
    roles: ['Avionics Engineer', 'Rust Developer'],
    description: 'Next-gen rocket propulsion system.',
  });

  let draftId = '';

  await t.test('creates drafts for specified platforms', async () => {
    const req = new NextRequest(`http://localhost:3000/api/projects/${project.id}/drafts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({ platforms: ['discord', 'linkedin'] }),
    });

    const res = await createDrafts(req, { params: Promise.resolve({ id: project.id }) });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.drafts.length, 2);
    assert.ok(data.drafts.some((d: { platformId: string }) => d.platformId === 'discord'));
    assert.ok(data.drafts.some((d: { platformId: string }) => d.platformId === 'linkedin'));

    const discordDraft = data.drafts.find((d: { platformId: string }) => d.platformId === 'discord');
    assert.ok(discordDraft.text.includes(project.slug));
    draftId = discordDraft.id;
  });

  await t.test('blocks non-owner from viewing or managing drafts', async () => {
    const req = new NextRequest(`http://localhost:3000/api/projects/${project.id}/drafts`, {
      headers: { cookie: intruderCookie },
    });
    const res = await getDrafts(req, { params: Promise.resolve({ id: project.id }) });
    assert.equal(res.status, 403);
  });

  await t.test('lists drafts with checks for project owner', async () => {
    const req = new NextRequest(`http://localhost:3000/api/projects/${project.id}/drafts`, {
      headers: { cookie },
    });
    const res = await getDrafts(req, { params: Promise.resolve({ id: project.id }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.drafts.length, 2);
    assert.ok(Array.isArray(data.drafts[0].checks));
  });

  await t.test('edits draft and resets approval state', async () => {
    const joinUrl = `http://localhost:3000/join/${project.slug}`;
    const newText = `Updated rocket launch announcement! Join: ${joinUrl}`;
    const req = new NextRequest(`http://localhost:3000/api/drafts/${draftId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({ text: newText }),
    });

    const res = await editDraft(req, { params: Promise.resolve({ id: draftId }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.draft.status, 'edited');
    assert.equal(data.draft.text, newText);
    assert.equal(data.draft.approvedText, undefined);
  });

  await t.test('approves draft and computes SHA-256 hash', async () => {
    const req = new NextRequest(`http://localhost:3000/api/drafts/${draftId}/approve`, {
      method: 'POST',
      headers: { cookie },
    });

    const res = await approveDraft(req, { params: Promise.resolve({ id: draftId }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.draft.status, 'approved');
    assert.ok(data.draft.approvedHash);
    assert.equal(data.draft.approvedHash.length, 64);
    assert.equal(data.draft.approvedBy, 'alice-owner');
  });

  await t.test('skips draft', async () => {
    const req = new NextRequest(`http://localhost:3000/api/drafts/${draftId}/skip`, {
      method: 'POST',
      headers: { cookie },
    });

    const res = await skipDraft(req, { params: Promise.resolve({ id: draftId }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.draft.status, 'skipped');
  });

  await t.test('generates personal post with checks', async () => {
    const req = new NextRequest(`http://localhost:3000/api/projects/${project.id}/personal-post`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({ tone: 'casual', extraLine: 'We are launching next month!' }),
    });

    const res = await personalPost(req, { params: Promise.resolve({ id: project.id }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.text);
    assert.ok(data.text.includes(project.slug));
    assert.ok(data.text.includes('launching next month'));
    assert.ok(Array.isArray(data.checks));
  });
});
