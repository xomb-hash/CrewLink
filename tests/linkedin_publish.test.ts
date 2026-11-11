import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { config } from '../src/config/index';
import { storage } from '../src/lib/storage';
import {
  beginLinkedInAuthorization,
  completeLinkedInAuthorization,
  disconnectConnection,
  getConnectionToken,
} from '../src/posting/connections';
import { publishDraft, PublishError } from '../src/posting/publish';
import {
  mockLinkedInClient,
  resetMockLinkedInState,
  setOAuthClientForTests,
} from '../src/posting/adapters';

const code = (err: unknown) => (err instanceof PublishError ? err.code : 'unexpected');

test('LinkedIn publishing reuses the approval and publication engine', async (t) => {
  storage.reset();
  resetMockLinkedInState();
  setOAuthClientForTests('linkedin', mockLinkedInClient);

  const owner = await storage.saveUser({ id: 1401, login: 'linkedin-publish-owner' });
  const other = await storage.saveUser({ id: 1402, login: 'linkedin-publish-other' });
  const ownerId = owner.id as string;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'linkedin-publish-owner/crew',
    repoName: 'crew',
    repoOwner: 'linkedin-publish-owner',
    title: 'Crew',
  });

  const connect = async () => {
    const { authorizationUrl } = await beginLinkedInAuthorization({
      userId: ownerId,
      projectId: project.id,
      sessionId: 'session-owner',
    });
    return completeLinkedInAuthorization({
      userId: ownerId,
      state: new URL(authorizationUrl).searchParams.get('state') || '',
      code: 'code',
      sessionId: 'session-owner',
    });
  };

  const connection = await connect();

  const approvedPost = async (text = 'We are looking for collaborators.') => {
    const draft = await storage.createDraft({
      projectId: project.id,
      platformId: 'linkedin',
      text,
    });
    const approved = await storage.approveDraft(draft.id, owner.login);
    assert.equal(approved?.status, 'approved');
    return draft;
  };

  await t.test('a member text post stores its id and derived feed URL', async () => {
    const draft = await approvedPost('Join our open-source crew.');

    const result = await publishDraft({ userId: ownerId, draftId: draft.id });

    assert.equal(mockLinkedInClient.posts.length, 1);
    // The author comes from the verified connection, never from the draft.
    assert.deepEqual(mockLinkedInClient.posts[0], {
      authorId: 'mock-member-id',
      text: 'Join our open-source crew.',
    });
    assert.equal(result.publication.status, 'published');
    assert.equal(result.publication.mode, 'api');
    assert.equal(result.publication.externalId, 'urn:li:share:7000000000000000001');
    assert.deepEqual(result.publication.externalIds, ['urn:li:share:7000000000000000001']);
    assert.equal(
      result.publication.externalUrl,
      'https://www.linkedin.com/feed/update/urn:li:share:7000000000000000001'
    );
    assert.ok(result.publication.confirmedAt);
    assert.ok(!JSON.stringify(result).includes('mock-linkedin-access'));
    assert.ok(!JSON.stringify(result).includes('mock-linkedin-refresh'));
  });

  await t.test('a published draft cannot be published twice', async () => {
    const draft = await approvedPost('A duplicate check');
    await publishDraft({ userId: ownerId, draftId: draft.id });
    const before = mockLinkedInClient.posts.length;

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'already_published'
    );
    assert.equal(mockLinkedInClient.posts.length, before);
  });

  await t.test('an edited draft needs a fresh approval', async () => {
    const draft = await approvedPost('The approved text');
    // Simulate an approval recorded for a different revision: the draft still
    // says approved, but the approved text no longer matches.
    await storage.approveDraft(draft.id, owner.login, { approvedText: 'An older revision' });
    const before = mockLinkedInClient.posts.length;

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'draft_changed'
    );
    assert.equal(mockLinkedInClient.posts.length, before);
  });

  await t.test('an empty post never publishes', async () => {
    const draft = await storage.createDraft({
      projectId: project.id,
      platformId: 'linkedin',
      text: '',
    });
    await storage.approveDraft(draft.id, owner.login);
    const before = mockLinkedInClient.posts.length;

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'draft_not_approved'
    );
    assert.equal(mockLinkedInClient.posts.length, before);
  });

  await t.test('an uncertain outcome stays sending and is never resent', async () => {
    const draft = await approvedPost('Uncertain once');
    const before = mockLinkedInClient.posts.length;
    mockLinkedInClient.uncertainAtSend = before + 1;

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'uncertain'
    );
    const sending = await storage.getPublication(draft.id, 'linkedin');
    assert.equal(sending?.status, 'sending');
    assert.equal(sending?.externalId, undefined);

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'in_progress'
    );
    assert.equal(mockLinkedInClient.posts.length, before);
    mockLinkedInClient.uncertainAtSend = null;
  });

  await t.test('a platform rejection is recorded and can be retried explicitly', async () => {
    const draft = await approvedPost('Rejected once');
    mockLinkedInClient.failAtSend = mockLinkedInClient.posts.length + 1;
    mockLinkedInClient.failCode = 'validation_error';

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'invalid_post'
    );
    const failed = await storage.getPublication(draft.id, 'linkedin');
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.errorCode, 'validation_error');

    const before = mockLinkedInClient.posts.length;
    mockLinkedInClient.failAtSend = null;
    const result = await publishDraft({ userId: ownerId, draftId: draft.id });
    assert.equal(result.publication.status, 'published');
    assert.equal(mockLinkedInClient.posts.length, before + 1);
  });

  await t.test('a rate limit is surfaced and can be retried', async () => {
    const draft = await approvedPost('Rate limited once');
    mockLinkedInClient.failAtSend = mockLinkedInClient.posts.length + 1;
    mockLinkedInClient.failCode = 'rate_limited';

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'rate_limited'
    );
    const failed = await storage.getPublication(draft.id, 'linkedin');
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.errorCode, 'rate_limited');

    mockLinkedInClient.failAtSend = null;
    const result = await publishDraft({ userId: ownerId, draftId: draft.id });
    assert.equal(result.publication.status, 'published');
  });

  await t.test('a revoked token disconnects the account', async () => {
    const draft = await approvedPost('Revoked once');
    mockLinkedInClient.failAtSend = mockLinkedInClient.posts.length + 1;
    mockLinkedInClient.failCode = 'revoked';

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'auth_revoked'
    );
    const failed = await storage.getPublication(draft.id, 'linkedin');
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.errorCode, 'auth_revoked');
    const stored = await storage.getPlatformConnectionById(connection.id);
    assert.equal(stored?.status, 'disconnected');
    mockLinkedInClient.failAtSend = null;
  });

  await t.test('an expired token without a refresh token needs a reconnect', async () => {
    await connect();
    const draft = await approvedPost('Expired once');
    mockLinkedInClient.tokenExpiredAtSend = mockLinkedInClient.posts.length + 1;
    const before = mockLinkedInClient.posts.length;

    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'auth_revoked'
    );
    assert.equal(mockLinkedInClient.posts.length, before);
    // No refresh token was issued, so no refresh is fabricated and the stale
    // connection is removed.
    assert.equal(mockLinkedInClient.refreshCalls, 0);
    const stored = await storage.getPlatformConnectionById(connection.id);
    assert.equal(stored?.status, 'disconnected');
  });

  await t.test('an expired token with a refresh token refreshes once and posts', async () => {
    mockLinkedInClient.issueRefreshToken = true;
    await connect();
    mockLinkedInClient.issueRefreshToken = false;

    const draft = await approvedPost('Refresh then post');
    mockLinkedInClient.tokenExpiredAtSend = mockLinkedInClient.posts.length + 1;

    const result = await publishDraft({ userId: ownerId, draftId: draft.id });
    assert.equal(result.publication.status, 'published');
    assert.equal(mockLinkedInClient.refreshCalls, 1);
    const tokens = await getConnectionToken(ownerId, connection.id);
    assert.equal(tokens.accessToken, 'mock-linkedin-access-1');
    assert.equal(tokens.refreshToken, 'mock-linkedin-refresh-1');
  });

  await t.test('another signed-in user cannot publish the draft', async () => {
    const draft = await approvedPost('Owner only');
    const before = mockLinkedInClient.posts.length;
    await assert.rejects(
      () => publishDraft({ userId: String(other.id), draftId: draft.id }),
      (err) => code(err) === 'forbidden'
    );
    assert.equal(mockLinkedInClient.posts.length, before);
  });

  await t.test('missing LinkedIn configuration fails closed before any send', async () => {
    const draft = await approvedPost('Not configured');
    const before = mockLinkedInClient.posts.length;
    const savedId = config.linkedinClientId;
    const savedSecret = config.linkedinClientSecret;
    config.linkedinClientId = '';
    config.linkedinClientSecret = '';
    try {
      await assert.rejects(
        () => publishDraft({ userId: ownerId, draftId: draft.id }),
        (err) => code(err) === 'linkedin_not_configured'
      );
      assert.equal(mockLinkedInClient.posts.length, before);
    } finally {
      config.linkedinClientId = savedId;
      config.linkedinClientSecret = savedSecret;
    }
  });

  await t.test('a malformed or sunset API version fails closed', async () => {
    const draft = await approvedPost('Bad version');
    const before = mockLinkedInClient.posts.length;
    const savedVersion = config.linkedinApiVersion;
    for (const value of ['2026-10', '202001']) {
      config.linkedinApiVersion = value;
      await assert.rejects(
        () => publishDraft({ userId: ownerId, draftId: draft.id }),
        (err) => code(err) === 'linkedin_not_configured',
        `expected ${value} to fail closed`
      );
    }
    config.linkedinApiVersion = savedVersion;
    assert.equal(mockLinkedInClient.posts.length, before);
  });

  await t.test('a disconnected account cannot publish', async () => {
    const draft = await approvedPost('Disconnected account');
    await disconnectConnection(ownerId, connection.id);
    const before = mockLinkedInClient.posts.length;
    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'connection_inactive'
    );
    assert.equal(mockLinkedInClient.posts.length, before);
  });

  await t.test('a project without a connection is refused', async () => {
    const soloProject = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'linkedin-publish-owner/solo',
      repoName: 'solo',
      repoOwner: 'linkedin-publish-owner',
      title: 'Solo',
    });
    const draft = await storage.createDraft({
      projectId: soloProject.id,
      platformId: 'linkedin',
      text: 'No connection',
    });
    await storage.approveDraft(draft.id, owner.login);
    await assert.rejects(
      () => publishDraft({ userId: ownerId, draftId: draft.id }),
      (err) => code(err) === 'connection_not_found'
    );
  });

  setOAuthClientForTests('linkedin', null);
});
