import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { storage } from '../src/lib/storage';
import { config } from '../src/config/index';
import {
  beginRedditAuthorization,
  completeRedditAuthorization,
  disconnectConnection,
  getConnectionToken,
} from '../src/posting/connections';
import { publishDraft, PublishError } from '../src/posting/publish';
import { redditApprovalHash } from '../src/posting/reddit/validate';
import { getRedditSubredditDetails } from '../src/posting/reddit/discovery';
import {
  mockRedditClient,
  resetMockRedditState,
  setOAuthClientForTests,
} from '../src/posting/adapters';

const code = (err: unknown) => (err instanceof PublishError ? err.code : 'unexpected');

interface RedditDraftFields {
  title: string;
  subreddit: string;
  submissionType: 'self' | 'link';
  text: string;
  linkUrl?: string;
}

test('Reddit publishing reuses the approval and publication engine', async (t) => {
  storage.reset();
  resetMockRedditState();
  setOAuthClientForTests('reddit', mockRedditClient);

  const owner = await storage.saveUser({ id: 1201, login: 'reddit-publish-owner' });
  const other = await storage.saveUser({ id: 1202, login: 'reddit-publish-other' });
  const ownerId = owner.id as string;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'reddit-publish-owner/rocket',
    repoName: 'rocket',
    repoOwner: 'reddit-publish-owner',
    title: 'Rocket',
  });
  mockRedditClient.setSubreddit('programming');
  mockRedditClient.setSubreddit('opensource', { submissionType: 'any' });

  const { authorizationUrl } = await beginRedditAuthorization({
    userId: ownerId,
    projectId: project.id,
    sessionId: 'session-owner',
  });
  const connection = await completeRedditAuthorization({
    userId: ownerId,
    state: new URL(authorizationUrl).searchParams.get('state') || '',
    code: 'code',
    sessionId: 'session-owner',
  });

  const approvedReddit = async (fields: RedditDraftFields) => {
    const draft = await storage.createDraft({
      projectId: project.id,
      platformId: 'reddit',
      title: fields.title,
      subreddit: fields.subreddit,
      submissionType: fields.submissionType,
      text: fields.text,
      linkUrl: fields.linkUrl,
    });
    const approved = await storage.approveDraft(draft.id, owner.login, {
      approvedText: draft.text,
      approvedHash: redditApprovalHash(fields),
    });
    assert.equal(approved?.status, 'approved');
    return draft;
  };

  await t.test('a text submission goes to the selected subreddit and stores its id', async () => {
    const draft = await approvedReddit({
      title: 'Looking for collaborators',
      subreddit: 'programming',
      submissionType: 'self',
      text: 'Join the project and help us build it.',
    });

    const result = await publishDraft({ userId: ownerId, draftId: draft.id });

    assert.equal(mockRedditClient.submissions.length, 1);
    assert.deepEqual(mockRedditClient.submissions[0], {
      subreddit: 'programming',
      kind: 'self',
      title: 'Looking for collaborators',
      body: 'Join the project and help us build it.',
      url: undefined,
    });
    assert.equal(result.publication.status, 'published');
    assert.equal(result.publication.mode, 'api');
    assert.equal(result.publication.externalId, 't3_mock-post-1');
    assert.deepEqual(result.publication.externalIds, ['t3_mock-post-1']);
    assert.equal(result.publication.targetName, 'programming');
    assert.ok(result.publication.externalUrl?.includes('/r/programming/comments/'));
    assert.ok(result.publication.confirmedAt);
    assert.ok(!JSON.stringify(result).includes('mock-reddit-access'));
  });

  await t.test('a published draft cannot be published twice', async () => {
    const draft = await storage.createDraft({
      projectId: project.id,
      platformId: 'reddit',
      title: 'A duplicate check',
      subreddit: 'programming',
      submissionType: 'self',
      text: 'Body',
    });
    const approved = await storage.approveDraft(draft.id, owner.login, {
      approvedText: draft.text,
      approvedHash: redditApprovalHash({
        title: 'A duplicate check',
        subreddit: 'programming',
        submissionType: 'self',
        text: 'Body',
      }),
    });
    assert.equal(approved?.status, 'approved');
    await publishDraft({ userId: ownerId, draftId: draft.id });
    const before = mockRedditClient.submissions.length;

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'already_published'
    );
    assert.equal(mockRedditClient.submissions.length, before);
  });

  await t.test('a link submission sends the URL and no body', async () => {
    const draft = await approvedReddit({
      title: 'Open source launch',
      subreddit: 'opensource',
      submissionType: 'link',
      text: '',
      linkUrl: 'https://example.com/launch',
    });

    const result = await publishDraft({ userId: ownerId, draftId: draft.id });
    const submission = mockRedditClient.submissions.at(-1);
    assert.equal(submission?.kind, 'link');
    assert.equal(submission?.url, 'https://example.com/launch');
    assert.equal(submission?.body, undefined);
    assert.equal(result.publication.targetName, 'opensource');
    assert.ok(result.publication.externalUrl);
  });

  await t.test('rules are re-read at publish time instead of trusting the cache', async () => {
    mockRedditClient.setSubreddit('strict', { submissionType: 'any' }, {});
    // Prime the discovery cache with a community that does not require flair.
    await getRedditSubredditDetails(ownerId, project.id, 'strict');
    mockRedditClient.setSubreddit('strict', { submissionType: 'any' }, { flairRequired: true });

    const draft = await approvedReddit({
      title: 'A strict community post',
      subreddit: 'strict',
      submissionType: 'self',
      text: 'Body',
    });
    const before = mockRedditClient.submissions.length;

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'invalid_post' && err instanceof Error && err.message.includes('flair')
    );
    assert.equal(mockRedditClient.submissions.length, before);
    const publication = await storage.getPublication(draft.id, 'reddit');
    assert.equal(publication, null);
  });

  await t.test('a ban discovered at publish time blocks the send', async () => {
    mockRedditClient.setSubreddit('guarded', { userIsBanned: true });
    const draft = await approvedReddit({
      title: 'A guarded post',
      subreddit: 'guarded',
      submissionType: 'self',
      text: 'Body',
    });
    const before = mockRedditClient.submissions.length;

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'invalid_post'
    );
    assert.equal(mockRedditClient.submissions.length, before);
  });

  await t.test('an approval bound to another submission is rejected', async () => {
    const draft = await storage.createDraft({
      projectId: project.id,
      platformId: 'reddit',
      title: 'Current title',
      subreddit: 'programming',
      submissionType: 'self',
      text: 'Body',
    });
    // Simulate an approval that was taken before the title changed.
    const approved = await storage.approveDraft(draft.id, owner.login, {
      approvedText: draft.text,
      approvedHash: redditApprovalHash({
        title: 'Old title',
        subreddit: 'programming',
        submissionType: 'self',
        text: 'Body',
      }),
    });
    assert.equal(approved?.status, 'approved');

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'draft_changed'
    );
  });

  await t.test('an expired token is refreshed once and the submission succeeds', async () => {
    const draft = await approvedReddit({
      title: 'Token refresh',
      subreddit: 'programming',
      submissionType: 'self',
      text: 'Body',
    });
    const before = mockRedditClient.submissions.length;
    const refreshBefore = mockRedditClient.refreshCalls;
    mockRedditClient.tokenExpiredAtSubmit = before + 1;

    const result = await publishDraft({ userId: ownerId, draftId: draft.id });
    assert.equal(result.publication.status, 'published');
    assert.equal(mockRedditClient.refreshCalls, refreshBefore + 1);
    assert.equal(mockRedditClient.submissions.length, before + 1);
    const tokens = await getConnectionToken(ownerId, connection.id);
    assert.equal(tokens.accessToken, 'mock-reddit-access-1');
  });

  await t.test('a platform rejection is recorded and can be retried explicitly', async () => {
    const draft = await approvedReddit({
      title: 'Rejected once',
      subreddit: 'programming',
      submissionType: 'self',
      text: 'Body',
    });
    mockRedditClient.submitErrors = [['SUBREDDIT_NOTALLOWED', 'You may not post there.']];

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'invalid_post'
    );
    const failed = await storage.getPublication(draft.id, 'reddit');
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.errorCode, 'validation_error');
    assert.equal(failed?.externalId, undefined);

    const before = mockRedditClient.submissions.length;
    const result = await publishDraft({ userId: ownerId, draftId: draft.id });
    assert.equal(result.publication.status, 'published');
    assert.equal(mockRedditClient.submissions.length, before + 1);
  });

  await t.test('a rate limit is surfaced and the submission can be retried', async () => {
    const draft = await approvedReddit({
      title: 'Rate limited once',
      subreddit: 'programming',
      submissionType: 'self',
      text: 'Body',
    });
    mockRedditClient.submitErrors = [['RATELIMIT', 'Looks like you have been doing that too much.']];

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'rate_limited'
    );
    const failed = await storage.getPublication(draft.id, 'reddit');
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.errorCode, 'rate_limited');

    const result = await publishDraft({ userId: ownerId, draftId: draft.id });
    assert.equal(result.publication.status, 'published');
  });

  await t.test('an uncertain outcome stays sending and is never resent', async () => {
    const draft = await approvedReddit({
      title: 'Uncertain once',
      subreddit: 'programming',
      submissionType: 'self',
      text: 'Body',
    });
    const before = mockRedditClient.submissions.length;
    mockRedditClient.uncertainAtSubmit = before + 1;

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'uncertain'
    );
    const sending = await storage.getPublication(draft.id, 'reddit');
    assert.equal(sending?.status, 'sending');
    assert.equal(sending?.externalId, undefined);

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'in_progress'
    );
    assert.equal(mockRedditClient.submissions.length, before);
    mockRedditClient.uncertainAtSubmit = null;
  });

  await t.test('another signed-in user cannot publish the draft', async () => {
    const draft = await approvedReddit({
      title: 'Owner only',
      subreddit: 'programming',
      submissionType: 'self',
      text: 'Body',
    });
    const before = mockRedditClient.submissions.length;
    await assert.rejects(
      () => publishDraft({ userId: String(other.id), draftId: draft.id }),
      (err) => code(err) === 'forbidden'
    );
    assert.equal(mockRedditClient.submissions.length, before);
  });

  await t.test('missing Reddit configuration fails closed before any send', async () => {
    const draft = await approvedReddit({
      title: 'Not configured',
      subreddit: 'programming',
      submissionType: 'self',
      text: 'Body',
    });
    const before = mockRedditClient.submissions.length;
    const savedId = config.redditClientId;
    const savedSecret = config.redditClientSecret;
    config.redditClientId = '';
    config.redditClientSecret = '';
    try {
      await assert.rejects(
        () => publishDraft({ userId: ownerId, draftId: draft.id }),
        (err) => code(err) === 'reddit_not_configured'
      );
      assert.equal(mockRedditClient.submissions.length, before);
    } finally {
      config.redditClientId = savedId;
      config.redditClientSecret = savedSecret;
    }
  });

  await t.test('a disconnected account cannot publish', async () => {
    const draft = await approvedReddit({
      title: 'Disconnected account',
      subreddit: 'programming',
      submissionType: 'self',
      text: 'Body',
    });
    await disconnectConnection(ownerId, connection.id);
    const before = mockRedditClient.submissions.length;
    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'connection_inactive'
    );
    assert.equal(mockRedditClient.submissions.length, before);
  });

  await t.test('a project without a connection is refused', async () => {
    const soloProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'reddit-publish-owner/solo',
      repoName: 'solo',
      repoOwner: 'reddit-publish-owner',
      title: 'Solo',
    });
    const draft = await storage.createDraft({
      projectId: soloProject.id,
      platformId: 'reddit',
      title: 'No connection',
      subreddit: 'programming',
      submissionType: 'self',
      text: 'Body',
    });
    await storage.approveDraft(draft.id, owner.login, {
      approvedText: draft.text,
      approvedHash: redditApprovalHash({
        title: 'No connection',
        subreddit: 'programming',
        submissionType: 'self',
        text: 'Body',
      }),
    });
    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'connection_not_found'
    );
  });

  setOAuthClientForTests('reddit', null);
});
