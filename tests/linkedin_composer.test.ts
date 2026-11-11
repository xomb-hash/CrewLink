import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import './setup';
import { storage } from '../src/lib/storage';
import { signValue } from '../src/lib/auth';
import { PUT as editDraft } from '../src/app/api/drafts/[id]/route';
import { checkDraft } from '../src/posting/checks';
import { LINKEDIN_POST_LIMIT } from '../src/posting/linkedin/config';

const baseContext = {
  ownerName: 'alice',
  repoName: 'crew',
  repoFullName: 'alice/crew',
  joinUrl: 'https://crewlink.example/join/crew',
  roles: ['Designer'],
  description: 'A crew',
};

test('LinkedIn composer validates text before approval and publishing', async (t) => {
  storage.reset();

  const owner = await storage.saveUser({ id: 1501, login: 'linkedin-composer-owner' });
  const session = await storage.createSession(owner.id);
  const cookie = `crewlink_session=${encodeURIComponent(signValue(session))}`;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'linkedin-composer-owner/crew',
    repoName: 'crew',
    repoOwner: 'linkedin-composer-owner',
    title: 'Crew',
  });

  const draft = await storage.createDraft({
    projectId: project.id,
    platformId: 'linkedin',
    text: 'Initial text',
  });

  const joinUrl = `http://localhost:3000/join/${project.slug}`;
  const withJoinLink = (text: string) => `${text} ${joinUrl}`;

  const put = (text: string) =>
    editDraft(
      new NextRequest(`http://localhost:3000/api/drafts/${draft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ text }),
      }),
      { params: Promise.resolve({ id: draft.id }) }
    );

  await t.test('an empty post is blocked by a static check', () => {
    const checks = checkDraft(baseContext, 'linkedin', '');
    const error = checks.find((check) => check.code === 'post_required');
    assert.ok(error);
    assert.equal(error.level, 'error');
    // Other platforms may legitimately start empty; only LinkedIn blocks it.
    assert.ok(!checkDraft(baseContext, 'bluesky', '').some((check) => check.code === 'post_required'));
  });

  await t.test('the server reports the empty-post error without dropping the draft', async () => {
    const res = await put('   ');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.draft.text, '   ');
    assert.ok(
      data.draft.checks.some(
        (check: { code: string; level: string }) =>
          check.code === 'post_required' && check.level === 'error'
      )
    );
  });

  await t.test('valid text passes the check', async () => {
    const res = await put(withJoinLink('We are building Crewlink and looking for collaborators.'));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.draft.status, 'edited');
    assert.ok(!data.draft.checks.some((check: { code: string }) => check.code === 'post_required'));
    assert.ok(!data.draft.checks.some((check: { level: string }) => check.level === 'error'));
  });

  await t.test('the exact limit is accepted and one character more is rejected', async () => {
    const full = `${'a'.repeat(LINKEDIN_POST_LIMIT - joinUrl.length - 1)} ${joinUrl}`;
    assert.equal(full.length, LINKEDIN_POST_LIMIT);
    const atLimit = await put(full);
    assert.equal(atLimit.status, 200);
    const atLimitData = await atLimit.json();
    assert.equal(atLimitData.draft.text.length, LINKEDIN_POST_LIMIT);
    assert.ok(!atLimitData.draft.checks.some((check: { code: string }) => check.code === 'over_limit'));

    const overLimit = await put('a'.repeat(LINKEDIN_POST_LIMIT + 1));
    assert.equal(overLimit.status, 400);
    const overLimitData = await overLimit.json();
    assert.ok(overLimitData.error.includes(LINKEDIN_POST_LIMIT.toLocaleString()));
    // The stored draft is not silently truncated.
    const stored = await storage.getDraftById(draft.id);
    assert.equal(stored?.text.length, LINKEDIN_POST_LIMIT);
  });

  await t.test('editing an approved post resets the approval', async () => {
    const approved = await storage.approveDraft(draft.id, owner.login);
    assert.equal(approved?.status, 'approved');

    const res = await put('Edited after approval');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.draft.status, 'edited');
    assert.equal(data.draft.approvedText, undefined);
    assert.equal(data.draft.approvedHash, undefined);
  });
});
