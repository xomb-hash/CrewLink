import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import './setup';
import { storage } from '../src/lib/storage';
import { signValue } from '../src/lib/auth';
import { connectBotChannel } from '../src/posting/connections';
import { resetMockBotState } from '../src/posting/bots/mock';
import { POST as publishRoute } from '../src/app/api/drafts/[id]/publish/route';

test('Draft publish API', async (t) => {
  storage.reset();
  resetMockBotState();

  const owner = await storage.saveUser({ id: 601, login: 'publish-api-owner' });
  const other = await storage.saveUser({ id: 602, login: 'publish-api-other' });
  const ownerSession = await storage.createSession(owner.id);
  const otherSession = await storage.createSession(other.id);
  const cookie = `crewlink_session=${encodeURIComponent(signValue(ownerSession))}`;
  const otherCookie = `crewlink_session=${encodeURIComponent(signValue(otherSession))}`;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'publish-api-owner/rocket',
    repoName: 'rocket',
    repoOwner: 'publish-api-owner',
    title: 'Rocket',
  });

  const approvedDraft = await storage.createDraft({
    projectId: project.id,
    platformId: 'discord',
    text: 'Approved crewlink text https://crewlink.test/join/rocket',
  });
  await storage.approveDraft(approvedDraft.id, owner.login);

  const failingDraft = await storage.createDraft({
    projectId: project.id,
    platformId: 'discord',
    text: 'This one fails to send',
  });
  await storage.approveDraft(failingDraft.id, owner.login);

  const unapprovedDraft = await storage.createDraft({
    projectId: project.id,
    platformId: 'discord',
    text: 'Not approved yet',
  });

  await connectBotChannel({
    userId: owner.id as string,
    projectId: project.id,
    platformId: 'discord',
    channelId: '1234567890',
  });

  const publishRequest = (draftId: string, headers: Record<string, string> = {}) =>
    new NextRequest(`http://localhost:3100/api/drafts/${draftId}/publish`, {
      method: 'POST',
      headers,
    });
  const paramsFor = (draftId: string) => ({ params: Promise.resolve({ id: draftId }) });

  await t.test('requires a signed-in user', async () => {
    const res = await publishRoute(publishRequest(approvedDraft.id), paramsFor(approvedDraft.id));
    assert.equal(res.status, 401);
  });

  await t.test('returns 404 for a missing draft', async () => {
    const res = await publishRoute(publishRequest('drf_missing', { cookie }), paramsFor('drf_missing'));
    assert.equal(res.status, 404);
  });

  await t.test('returns 403 for anyone but the owner', async () => {
    const res = await publishRoute(
      publishRequest(approvedDraft.id, { cookie: otherCookie }),
      paramsFor(approvedDraft.id)
    );
    assert.equal(res.status, 403);
  });

  await t.test('returns 400 for an unapproved draft', async () => {
    const res = await publishRoute(
      publishRequest(unapprovedDraft.id, { cookie }),
      paramsFor(unapprovedDraft.id)
    );
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'draft_not_approved');
  });

  await t.test('publishes once without echoing text, tokens or ciphertext', async () => {
    const res = await publishRoute(
      publishRequest(approvedDraft.id, { cookie }),
      paramsFor(approvedDraft.id)
    );
    assert.equal(res.status, 200);

    const raw = await res.text();
    assert.ok(!raw.includes('Approved crewlink text'));
    assert.ok(!raw.includes('join/rocket'));
    assert.ok(!raw.includes('test-discord-bot-token'));
    assert.ok(!raw.includes('Ciphertext'));
    assert.ok(!raw.includes('keyRef'));

    const data = JSON.parse(raw);
    assert.equal(data.publication.status, 'published');
    assert.equal(data.publication.platformId, 'discord');
    assert.ok(data.publication.externalId);
    assert.equal(data.connection.channelName, '#1234567890');

    const duplicate = await publishRoute(
      publishRequest(approvedDraft.id, { cookie }),
      paramsFor(approvedDraft.id)
    );
    assert.equal(duplicate.status, 409);
    const duplicateData = await duplicate.json();
    assert.equal(duplicateData.code, 'already_published');
  });

  await t.test('maps a platform send failure to 502 without leaking secrets', async () => {
    await connectBotChannel({
      userId: owner.id as string,
      projectId: project.id,
      platformId: 'discord',
      channelId: 'mock-send-fails',
    });

    // A destination change cleared the approval; the owner must approve again.
    const staleApproval = await publishRoute(
      publishRequest(failingDraft.id, { cookie }),
      paramsFor(failingDraft.id)
    );
    assert.equal(staleApproval.status, 400);
    assert.equal((await staleApproval.json()).code, 'draft_not_approved');
    await storage.approveDraft(failingDraft.id, owner.login);

    const res = await publishRoute(
      publishRequest(failingDraft.id, { cookie }),
      paramsFor(failingDraft.id)
    );
    assert.equal(res.status, 502);
    const raw = await res.text();
    assert.ok(!raw.includes('This one fails to send'));
    assert.ok(!raw.includes('test-discord-bot-token'));
    const data = JSON.parse(raw);
    assert.equal(data.code, 'send_failed');
  });
});
