import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { storage } from '../src/lib/storage';
import {
  beginXAuthorization,
  completeXAuthorization,
  getConnectionToken,
} from '../src/posting/connections';
import { markPublishedManually, publishDraft, PublishError } from '../src/posting/publish';
import { getXBudgetSummary } from '../src/posting/x/usage';
import {
  mockXClient,
  resetMockXState,
  setOAuthClientForTests,
} from '../src/posting/adapters';

const code = (err: unknown) => (err instanceof PublishError ? err.code : 'unexpected');

test('X publishing: automatic API posts and free manual records', async (t) => {
  storage.reset();
  resetMockXState();
  setOAuthClientForTests('x', mockXClient);

  const owner = await storage.saveUser({ id: 1001, login: 'x-publish-owner' });
  const other = await storage.saveUser({ id: 1002, login: 'x-publish-other' });
  const ownerId = owner.id as string;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'x-publish-owner/rocket',
    repoName: 'rocket',
    repoOwner: 'x-publish-owner',
    title: 'Rocket',
  });

  // Start and finish the OAuth flow so the connection holds encrypted tokens.
  const { authorizationUrl } = await beginXAuthorization({
    userId: ownerId,
    projectId: project.id,
    sessionId: 'session-owner',
  });
  const state = new URL(authorizationUrl).searchParams.get('state') || '';
  const connection = await completeXAuthorization({
    userId: ownerId,
    state,
    code: 'code',
    sessionId: 'session-owner',
  });

  const approvedX = async (parts: string[]) => {
    const draft = await storage.createDraft({
      projectId: project.id,
      platformId: 'x',
      text: parts.join('\n\n'),
      threadParts: parts,
    });
    const approved = await storage.approveDraft(draft.id, owner.login);
    assert.equal(approved?.status, 'approved');
    return draft;
  };

  await t.test('a single post requires cost confirmation and records one id', async () => {
    const draft = await approvedX(['Crewlink launch post']);

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'cost_confirmation_required'
    );
    assert.equal(mockXClient.sends.length, 0);

    const result = await publishDraft({
      userId: ownerId,
      draftId: draft.id,
      confirmCost: true,
      maxCostUsd: 0.015,
    });

    assert.equal(mockXClient.sends.length, 1);
    assert.equal(mockXClient.sends[0].text, 'Crewlink launch post');
    assert.equal(mockXClient.sends[0].replyToId, undefined);
    assert.equal(result.publication.status, 'published');
    assert.equal(result.publication.mode, 'api');
    assert.deepEqual(result.publication.externalIds, ['mock-x-post-1']);
    assert.ok(result.publication.confirmedAt);
    assert.equal(result.estimate?.costMicros, 15_000);
    assert.ok(!JSON.stringify(result).includes('mock-x-access'));
  });

  await t.test('a cost cap below the estimate blocks the send', async () => {
    const draft = await approvedX(['Text with a link https://example.com']);
    const before = mockXClient.sends.length;

    await assert.rejects(
      () =>
        publishDraft({
          userId: ownerId,
          draftId: draft.id,
          confirmCost: true,
          maxCostUsd: 0.015,
        }),
      (err) => code(err) === 'cost_limit_exceeded'
    );
    assert.equal(mockXClient.sends.length, before);
  });

  await t.test('threads are chained as replies and store every id in order', async () => {
    const draft = await approvedX(['First part', 'Second part', 'Third part']);
    const result = await publishDraft({
      userId: ownerId,
      draftId: draft.id,
      confirmCost: true,
      maxCostUsd: 0.045,
    });

    assert.deepEqual(
      mockXClient.sends.slice(-3).map((send) => send.text),
      ['First part', 'Second part', 'Third part']
    );
    assert.deepEqual(
      mockXClient.sends.slice(-3).map((send) => send.replyToId),
      [undefined, 'mock-x-post-2', 'mock-x-post-3']
    );
    assert.deepEqual(result.publication.externalIds, [
      'mock-x-post-2',
      'mock-x-post-3',
      'mock-x-post-4',
    ]);
    assert.equal(result.estimate?.requests, 3);
  });

  await t.test('an expired access token is refreshed once and the post sent', async () => {
    const draft = await approvedX(['Refreshed token post']);
    const refreshesBefore = mockXClient.refreshCalls;
    mockXClient.tokenExpiredAtCall = mockXClient.sends.length + 1;

    const result = await publishDraft({
      userId: ownerId,
      draftId: draft.id,
      confirmCost: true,
      maxCostUsd: 0.015,
    });

    assert.equal(mockXClient.refreshCalls, refreshesBefore + 1);
    assert.equal(result.publication.status, 'published');
    const tokens = await getConnectionToken(ownerId, connection.id);
    assert.ok(tokens.accessToken.startsWith('mock-x-access-'));
  });

  await t.test('a duplicate publish is refused and never sends twice', async () => {
    const draft = await approvedX(['Only once']);
    await publishDraft({
      userId: ownerId,
      draftId: draft.id,
      confirmCost: true,
      maxCostUsd: 0.015,
    });
    const sends = mockXClient.sends.length;

    await assert.rejects(
      () =>
        publishDraft({
          userId: ownerId,
          draftId: draft.id,
          confirmCost: true,
          maxCostUsd: 0.015,
        }),
      (err) => code(err) === 'already_published'
    );
    assert.equal(mockXClient.sends.length, sends);
  });

  await t.test('a rate limit fails the attempt and releases its reservation', async () => {
    const draft = await approvedX(['Rate limited post']);
    const spentBefore = (await getXBudgetSummary()).spentMicros;
    mockXClient.failAtCall = mockXClient.sends.length + 1;
    mockXClient.failCode = 'rate_limited';

    await assert.rejects(
      () =>
        publishDraft({
          userId: ownerId,
          draftId: draft.id,
          confirmCost: true,
          maxCostUsd: 0.015,
        }),
      (err) => code(err) === 'rate_limited'
    );
    mockXClient.failAtCall = null;

    const publication = await storage.getPublication(draft.id, 'x');
    assert.equal(publication?.status, 'failed');
    assert.equal(publication?.errorCode, 'rate_limited');
    assert.equal((await getXBudgetSummary()).spentMicros, spentBefore);

    // An explicit retry is allowed after a definitive failure.
    const retried = await publishDraft({
      userId: ownerId,
      draftId: draft.id,
      confirmCost: true,
      maxCostUsd: 0.015,
    });
    assert.equal(retried.publication.status, 'published');
  });

  await t.test('a partial thread can never be restarted', async () => {
    const draft = await approvedX(['Posted first', 'Fails second']);
    mockXClient.failAtCall = mockXClient.sends.length + 2;
    mockXClient.failCode = 'instance_error';
    const sendsBefore = mockXClient.sends.length;

    await assert.rejects(
      () =>
        publishDraft({
          userId: ownerId,
          draftId: draft.id,
          confirmCost: true,
          maxCostUsd: 0.030,
        }),
      (err) => code(err) === 'partial_thread'
    );
    mockXClient.failAtCall = null;

    const publication = await storage.getPublication(draft.id, 'x');
    assert.equal(publication?.status, 'failed');
    assert.equal(publication?.errorCode, 'partial_thread');
    assert.equal(publication?.externalIds.length, 1);
    assert.equal(mockXClient.sends.length, sendsBefore + 1);

    await assert.rejects(
      () =>
        publishDraft({
          userId: ownerId,
          draftId: draft.id,
          confirmCost: true,
          maxCostUsd: 0.030,
        }),
      (err) => code(err) === 'partial_thread'
    );
    assert.equal(mockXClient.sends.length, sendsBefore + 1);
  });

  await t.test('an uncertain send stays sending and keeps its charge', async () => {
    const draft = await approvedX(['Maybe posted']);
    const spentBefore = (await getXBudgetSummary()).spentMicros;
    mockXClient.uncertainAtCall = mockXClient.sends.length + 1;

    await assert.rejects(
      () =>
        publishDraft({
          userId: ownerId,
          draftId: draft.id,
          confirmCost: true,
          maxCostUsd: 0.015,
        }),
      (err) => code(err) === 'uncertain'
    );
    mockXClient.uncertainAtCall = null;

    const publication = await storage.getPublication(draft.id, 'x');
    assert.equal(publication?.status, 'sending');
    assert.ok((await getXBudgetSummary()).spentMicros > spentBefore);

    // The row stays `sending`, so a retry is refused rather than resent. Once it
    // is stale the engine reports `uncertain`; either way nothing is sent again.
    const sends = mockXClient.sends.length;
    await assert.rejects(
      () =>
        publishDraft({
          userId: ownerId,
          draftId: draft.id,
          confirmCost: true,
          maxCostUsd: 0.015,
        }),
      (err) => code(err) === 'in_progress'
    );
    assert.equal(mockXClient.sends.length, sends);
  });

  await t.test('another owner cannot publish this draft', async () => {
    const draft = await approvedX(['Owner only']);
    await assert.rejects(
      () =>
        publishDraft({
          userId: String(other.id),
          draftId: draft.id,
          confirmCost: true,
          maxCostUsd: 0.015,
        }),
      (err) => code(err) === 'forbidden'
    );
  });

  await t.test('manual publishing is free, unverified and makes no X call', async () => {
    const manualProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'x-publish-owner/manual',
      repoName: 'manual',
      repoOwner: 'x-publish-owner',
      title: 'Manual',
    });
    const draft = await storage.createDraft({
      projectId: manualProject.id,
      platformId: 'x',
      text: 'Manual post',
    });
    await storage.approveDraft(draft.id, owner.login);
    const sends = mockXClient.sends.length;
    const spent = (await getXBudgetSummary()).spentMicros;

    const result = await markPublishedManually({ userId: ownerId, draftId: draft.id });

    assert.equal(mockXClient.sends.length, sends);
    assert.equal((await getXBudgetSummary()).spentMicros, spent);
    assert.equal(result.verified, false);
    assert.equal(result.publication.status, 'published');
    assert.equal(result.publication.mode, 'manual');
    assert.deepEqual(result.publication.externalIds, []);
    assert.equal(result.publication.connectionId, undefined);
    assert.ok(result.publication.confirmedAt);
  });

  await t.test('manual publishing rejects unapproved, wrong-owner and non-X drafts', async () => {
    const manualProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'x-publish-owner/manual-two',
      repoName: 'manual-two',
      repoOwner: 'x-publish-owner',
      title: 'Manual two',
    });
    const unapproved = await storage.createDraft({
      projectId: manualProject.id,
      platformId: 'x',
      text: 'Not approved',
    });
    await assert.rejects(
      () => markPublishedManually({ userId: ownerId, draftId: unapproved.id }),
      (err) => code(err) === 'draft_not_approved'
    );

    const approved = await storage.createDraft({
      projectId: manualProject.id,
      platformId: 'x',
      text: 'Approved but not the owner',
    });
    await storage.approveDraft(approved.id, owner.login);
    await assert.rejects(
      () => markPublishedManually({ userId: String(other.id), draftId: approved.id }),
      (err) => code(err) === 'forbidden'
    );

    const discordDraft = await storage.createDraft({
      projectId: manualProject.id,
      platformId: 'discord',
      text: 'Not X',
    });
    await storage.approveDraft(discordDraft.id, owner.login);
    await assert.rejects(
      () => markPublishedManually({ userId: ownerId, draftId: discordDraft.id }),
      (err) => code(err) === 'unsupported_platform'
    );
  });

  await t.test('an exhausted monthly budget blocks automatic publishing only', async () => {
    await storage.createUsageEntryIfAbsent({
      id: 'xuse_budget_fill',
      userId: ownerId,
      projectId: project.id,
      draftId: 'draft_budget_fill',
      publicationId: 'pub_budget_fill',
      platformId: 'x',
      mode: 'api',
      requestCount: 1,
      costMicros: 10_000_000,
      currency: 'USD',
      status: 'committed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    assert.equal((await getXBudgetSummary()).remainingMicros, 0);

    const draft = await approvedX(['Blocked by budget']);
    const sends = mockXClient.sends.length;
    await assert.rejects(
      () =>
        publishDraft({
          userId: ownerId,
          draftId: draft.id,
          confirmCost: true,
          maxCostUsd: 0.015,
        }),
      (err) => code(err) === 'budget_exhausted'
    );
    assert.equal(mockXClient.sends.length, sends);

    const manual = await markPublishedManually({ userId: ownerId, draftId: draft.id });
    assert.equal(manual.publication.mode, 'manual');
  });

  setOAuthClientForTests('x', null);
});
