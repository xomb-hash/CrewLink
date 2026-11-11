import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import './setup';
import { storage } from '../src/lib/storage';
import { publishDraft, PublishError } from '../src/posting/publish';
import {
  beginSlackAuthorization,
  completeSlackAuthorization,
  selectSlackChannel,
} from '../src/posting/connections';
import {
  mockSlackClient,
  resetMockSlackState,
  setOAuthClientForTests,
} from '../src/posting/adapters';
import { SlackError } from '../src/posting/adapters/slack';

const code = (err: unknown) => (err instanceof PublishError ? err.code : 'unexpected');
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

test('Slack publishing reuses the approval and duplicate gates', async (t) => {
  storage.reset();
  resetMockSlackState();
  setOAuthClientForTests('slack', mockSlackClient);

  const owner = await storage.saveUser({ id: 2301, login: 'slack-publisher' });
  const other = await storage.saveUser({ id: 2302, login: 'slack-outsider' });
  const ownerId = owner.id as string;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'slack-publisher/rocket',
    repoName: 'rocket',
    repoOwner: 'slack-publisher',
    title: 'Rocket',
  });
  const otherProject = await storage.createProject({
    ownerLogin: other.login,
    ownerId: other.id,
    repoFullName: 'slack-outsider/boat',
    repoName: 'boat',
    repoOwner: 'slack-outsider',
    title: 'Boat',
  });

  const connect = async (projectId: string) => {
    const sessionId = 'slack-publish-session';
    const { authorizationUrl } = await beginSlackAuthorization({
      userId: ownerId,
      projectId,
      sessionId,
    });
    const state = new URL(authorizationUrl).searchParams.get('state') || '';
    return completeSlackAuthorization({ userId: ownerId, state, code: 'code', sessionId });
  };

  const approvedDraft = async (text: string) => {
    const draft = await storage.createDraft({
      projectId: project.id,
      platformId: 'slack',
      text,
    });
    await storage.approveDraft(draft.id, owner.login);
    return draft;
  };

  const text = 'Crewlink join https://crewlink.test/join/rocket';

  await t.test('needs an active connection with a selected channel', async () => {
    const draft = await approvedDraft(text);

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'connection_not_found'
    );

    const connection = await connect(project.id);
    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'connection_inactive'
    );

    const selected = await selectSlackChannel({
      userId: ownerId,
      connectionId: connection.id,
      channelId: 'C0GENERAL',
    });
    assert.equal(selected.channelId, 'C0GENERAL');
  });

  await t.test('publishes the approved text once and records the Slack ts', async () => {
    const draft = await approvedDraft(text);
    const result = await publishDraft({ userId: ownerId, draftId: draft.id });

    assert.equal(result.publication.status, 'published');
    assert.equal(result.publication.mode, 'api');
    assert.equal(result.publication.platformId, 'slack');
    assert.equal(result.publication.targetName, 'C0GENERAL');
    assert.equal(result.publication.contentHash, sha256(text));
    assert.ok(result.publication.externalId);

    const posts = mockSlackClient.posts;
    assert.equal(posts.length, 1);
    assert.equal(posts[0].channelId, 'C0GENERAL');
    assert.equal(posts[0].text, text);
    assert.equal(result.publication.externalId, posts[0].ts);
    assert.deepEqual(result.publication.externalIds, [posts[0].ts]);

    const serialized = JSON.stringify(result.publication);
    assert.ok(!serialized.includes(text));
    assert.ok(!serialized.includes('mock-slack-bot-token'));

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'already_published'
    );
    assert.equal(mockSlackClient.posts.length, 1);
  });

  await t.test('refuses unapproved, edited and non-owner drafts', async () => {
    const unapproved = await storage.createDraft({
      projectId: project.id,
      platformId: 'slack',
      text,
    });
    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: unapproved.id }),
      (err) => code(err) === 'draft_not_approved'
    );

    const edited = await approvedDraft(text);
    const stored = await storage.getDraftById(edited.id);
    assert.ok(stored);
    stored.text = `${text} (edited)`;
    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: edited.id }),
      (err) => code(err) === 'draft_changed'
    );

    const otherDraft = await storage.createDraft({
      projectId: otherProject.id,
      platformId: 'slack',
      text,
    });
    await storage.approveDraft(otherDraft.id, other.login);
    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: otherDraft.id }),
      (err) => code(err) === 'forbidden'
    );
  });

  await t.test('a partial channel failure never restarts on its own', async () => {
    const draft = await approvedDraft(text);
    const before = mockSlackClient.posts.length;
    mockSlackClient.uncertainAtSend = before + 1;

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'uncertain'
    );

    const stored = await storage.getPublication(draft.id, 'slack');
    assert.equal(stored?.status, 'sending');
    assert.equal(mockSlackClient.posts.length, before);

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'in_progress'
    );
    assert.equal(mockSlackClient.posts.length, before);
    mockSlackClient.uncertainAtSend = null;
  });

  await t.test('a rate limit is reported with Retry-After and no resend', async () => {
    const draft = await approvedDraft(text);
    const before = mockSlackClient.posts.length;
    mockSlackClient.failAtSend = before + 1;
    mockSlackClient.failSendWith = new SlackError(
      'Slack rate-limited the request.',
      'ratelimited',
      'rate_limited',
      9
    );

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) =>
        err instanceof PublishError &&
        err.code === 'rate_limited' &&
        err.retryAfterSeconds === 9
    );

    const stored = await storage.getPublication(draft.id, 'slack');
    assert.equal(stored?.status, 'failed');
    assert.equal(stored?.errorCode, 'rate_limited');
    assert.equal(mockSlackClient.posts.length, before);

    mockSlackClient.failAtSend = null;
    mockSlackClient.failSendWith = null;
  });

  await t.test('Slack channel errors are recorded specifically and stay retryable', async () => {
    const cases: Array<{
      slackError: string;
      errorCode: string;
      publishCode: string;
    }> = [
      { slackError: 'not_in_channel', errorCode: 'slack_not_in_channel', publishCode: 'send_failed' },
      { slackError: 'channel_not_found', errorCode: 'slack_channel_not_found', publishCode: 'send_failed' },
      { slackError: 'is_archived', errorCode: 'slack_channel_archived', publishCode: 'send_failed' },
      { slackError: 'restricted_action', errorCode: 'slack_restricted_action', publishCode: 'send_failed' },
      { slackError: 'msg_too_long', errorCode: 'validation_error', publishCode: 'invalid_post' },
    ];

    for (const item of cases) {
      const draft = await approvedDraft(text);
      const before = mockSlackClient.posts.length;
      mockSlackClient.failAtSend = before + 1;
      mockSlackClient.failSendWith = new SlackError(
        `Slack error ${item.slackError}`,
        item.slackError,
        'validation_error'
      );

      await assert.rejects(
        () => publishDraft({ userId: ownerId, draftId: draft.id }),
        (err) => code(err) === item.publishCode
      );

      const stored = await storage.getPublication(draft.id, 'slack');
      assert.equal(stored?.status, 'failed');
      assert.equal(stored?.errorCode, item.errorCode);
      assert.equal(mockSlackClient.posts.length, before);

      mockSlackClient.failAtSend = null;
      mockSlackClient.failSendWith = null;
    }
  });

  await t.test('a missing scope fails closed without wiping a working install', async () => {
    const draft = await approvedDraft(text);
    mockSlackClient.failAtSend = mockSlackClient.posts.length + 1;

    mockSlackClient.failSendWith = new SlackError(
      'The Crewlink Slack app is missing a required permission.',
      'missing_scope',
      'auth_failed'
    );

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'auth_revoked'
    );

    const stored = await storage.getPublication(draft.id, 'slack');
    assert.equal(stored?.errorCode, 'slack_missing_scope');
    const connection = await storage.findPlatformConnection(ownerId, project.id, 'slack');
    assert.equal(connection?.status, 'active');

    mockSlackClient.failAtSend = null;
    mockSlackClient.failSendWith = null;
  });

  await t.test('a definitive failure can be retried manually exactly once', async () => {
    const draft = await approvedDraft(text);
    mockSlackClient.failAtSend = mockSlackClient.posts.length + 1;
    mockSlackClient.failSendWith = new SlackError(
      'The Crewlink bot is not a member of this channel.',
      'not_in_channel',
      'validation_error'
    );

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'send_failed'
    );
    const failed = await storage.getPublication(draft.id, 'slack');
    assert.equal(failed?.status, 'failed');

    mockSlackClient.failAtSend = null;
    mockSlackClient.failSendWith = null;

    const before = mockSlackClient.posts.length;
    const retried = await publishDraft({ userId: ownerId, draftId: draft.id });
    assert.equal(retried.publication.status, 'published');
    assert.equal(mockSlackClient.posts.length, before + 1);

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'already_published'
    );
    assert.equal(mockSlackClient.posts.length, before + 1);
  });

  await t.test('concurrent publishes send at most once', async () => {
    const draft = await approvedDraft(text);
    const before = mockSlackClient.posts.length;
    const results = await Promise.allSettled([
      publishDraft({ userId: ownerId, draftId: draft.id }),
      publishDraft({ userId: ownerId, draftId: draft.id }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(mockSlackClient.posts.length, before + 1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(
      reason instanceof PublishError &&
        (reason.code === 'in_progress' || reason.code === 'already_published')
    );
  });

  setOAuthClientForTests('slack', null);
});
