import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import './setup';
import { storage } from '../src/lib/storage';
import { connectBotChannel, disconnectConnection } from '../src/posting/connections';
import { PublishError, publishDraft } from '../src/posting/publish';
import { listMockSentMessages, resetMockBotState } from '../src/posting/bots/mock';

const code = (err: unknown) => (err instanceof PublishError ? err.code : 'unexpected');
const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

test('Publishing requires the owner and an approved, unchanged draft', async (t) => {
  storage.reset();
  resetMockBotState();

  const owner = await storage.saveUser({ id: 501, login: 'publish-owner' });
  const other = await storage.saveUser({ id: 502, login: 'publish-other' });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'publish-owner/rocket',
    repoName: 'rocket',
    repoOwner: 'publish-owner',
    title: 'Rocket',
  });

  const draft = await storage.createDraft({
    projectId: project.id,
    platformId: 'discord',
    text: 'Join the rocket crew at https://crewlink.test/join/rocket',
  });

  await t.test('rejects a draft that is not approved', async () => {
    await assert.rejects(
      () => publishDraft({ userId: owner.id as string, draftId: draft.id }),
      (err) => code(err) === 'draft_not_approved'
    );

    await assert.rejects(
      () => publishDraft({ userId: owner.id as string, draftId: 'drf_missing' }),
      (err) => code(err) === 'draft_not_found'
    );
  });

  await t.test('rejects another user even when the draft is approved', async () => {
    await storage.approveDraft(draft.id, owner.login);

    await assert.rejects(
      () => publishDraft({ userId: other.id as string, draftId: draft.id }),
      (err) => code(err) === 'forbidden'
    );
  });

  await t.test('rejects a draft edited after approval', async () => {
    // Simulate text that changed without going through the approval route.
    const stored = await storage.getDraftById(draft.id);
    assert.ok(stored);
    stored.text = 'Changed after approval';

    await assert.rejects(
      () => publishDraft({ userId: owner.id as string, draftId: draft.id }),
      (err) => code(err) === 'draft_changed'
    );
  });

  await t.test('rejects an edit that also clears the approval', async () => {
    await storage.updateDraft(draft.id, 'Edited text');
    await assert.rejects(
      () => publishDraft({ userId: owner.id as string, draftId: draft.id }),
      (err) => code(err) === 'draft_not_approved'
    );
  });

  await t.test('rejects platforms outside this milestone', async () => {
    // Slack and WhatsApp are supported since M7, so use an unregistered id.
    const otherDraft = await storage.createDraft({
      projectId: project.id,
      platformId: 'myspace',
      text: 'Join us',
    });
    await storage.approveDraft(otherDraft.id, owner.login);

    await assert.rejects(
      () => publishDraft({ userId: owner.id as string, draftId: otherDraft.id }),
      (err) => code(err) === 'unsupported_platform'
    );
  });
});

test('Publishing needs an active verified connection and sends exactly once', async (t) => {
  storage.reset();
  resetMockBotState();

  const owner = await storage.saveUser({ id: 511, login: 'publish-owner-2' });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'publish-owner-2/rocket',
    repoName: 'rocket',
    repoOwner: 'publish-owner-2',
    title: 'Rocket',
  });

  const draft = await storage.createDraft({
    projectId: project.id,
    platformId: 'discord',
    text: 'Approved crewlink text https://crewlink.test/join/rocket',
  });
  await storage.approveDraft(draft.id, owner.login);

  await t.test('fails when no channel is connected', async () => {
    await assert.rejects(
      () => publishDraft({ userId: owner.id as string, draftId: draft.id }),
      (err) => code(err) === 'connection_not_found'
    );
  });

  await t.test('refuses a publication that is already in progress', async () => {
    await connectBotChannel({
      userId: owner.id as string,
      projectId: project.id,
      platformId: 'discord',
      channelId: '1234567890',
    });

    const inflightDraft = await storage.createDraft({
      projectId: project.id,
      platformId: 'discord',
      text: 'Another approved draft',
    });
    await storage.approveDraft(inflightDraft.id, owner.login);
    await storage.createPublicationIfAbsent({
      id: 'pub_inflight',
      userId: owner.id as string,
      projectId: project.id,
      draftId: inflightDraft.id,
      connectionId: 'pcn_inflight',
      platformId: 'discord',
      status: 'sending',
      mode: 'api',
      contentHash: sha256(inflightDraft.text),
      externalIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await assert.rejects(
      () => publishDraft({ userId: owner.id as string, draftId: inflightDraft.id }),
      (err) => code(err) === 'in_progress'
    );
  });

  await t.test('publishes the approved text once and records no content', async () => {
    const result = await publishDraft({ userId: owner.id as string, draftId: draft.id });

    assert.equal(result.publication.status, 'published');
    assert.ok(result.publication.externalId);
    assert.equal(result.publication.contentHash, sha256(draft.text));
    assert.equal(result.publication.platformId, 'discord');

    const serialized = JSON.stringify(result.publication);
    assert.ok(!serialized.includes('Approved crewlink text'));
    assert.ok(!serialized.includes('join/rocket'));

    const sent = listMockSentMessages();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].content, draft.text);
    assert.equal(sent[0].channelId, '1234567890');

    await assert.rejects(
      () => publishDraft({ userId: owner.id as string, draftId: draft.id }),
      (err) => code(err) === 'already_published'
    );
    assert.equal(listMockSentMessages().length, 1);
  });
});

test('Discord and Telegram publish independently and a manual retry works after failure', async (t) => {
  storage.reset();
  resetMockBotState();

  const owner = await storage.saveUser({ id: 521, login: 'publish-owner-3' });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'publish-owner-3/rocket',
    repoName: 'rocket',
    repoOwner: 'publish-owner-3',
    title: 'Rocket',
  });

  const text = 'Crewlink join https://crewlink.test/join/rocket';
  const discordDraft = await storage.createDraft({
    projectId: project.id,
    platformId: 'discord',
    text,
  });
  const telegramDraft = await storage.createDraft({
    projectId: project.id,
    platformId: 'telegram',
    text,
  });
  await storage.approveDraft(discordDraft.id, owner.login);
  await storage.approveDraft(telegramDraft.id, owner.login);

  await connectBotChannel({
    userId: owner.id as string,
    projectId: project.id,
    platformId: 'discord',
    channelId: 'mock-send-fails',
  });
  await connectBotChannel({
    userId: owner.id as string,
    projectId: project.id,
    platformId: 'telegram',
    channelId: '@crewlinktest',
  });

  await t.test('a Discord failure does not block Telegram', async () => {
    await assert.rejects(
      () => publishDraft({ userId: owner.id as string, draftId: discordDraft.id }),
      (err) => code(err) === 'send_failed'
    );

    const telegram = await publishDraft({
      userId: owner.id as string,
      draftId: telegramDraft.id,
    });
    assert.equal(telegram.publication.status, 'published');

    const failed = await storage.getPublication(discordDraft.id, 'discord');
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.errorCode, 'transport_error');
    assert.equal(listMockSentMessages().length, 1);
  });

  await t.test('changing the destination invalidates approval and needs a fresh one', async () => {
    await connectBotChannel({
      userId: owner.id as string,
      projectId: project.id,
      platformId: 'discord',
      channelId: '1234567890',
    });

    const stored = await storage.getDraftById(discordDraft.id);
    assert.equal(stored?.status, 'drafted');
    assert.equal(stored?.approvedText, undefined);

    await assert.rejects(
      () => publishDraft({ userId: owner.id as string, draftId: discordDraft.id }),
      (err) => code(err) === 'draft_not_approved'
    );

    await storage.approveDraft(discordDraft.id, owner.login);
    const retried = await publishDraft({ userId: owner.id as string, draftId: discordDraft.id });
    assert.equal(retried.publication.status, 'published');
    assert.equal(retried.publication.errorCode, undefined);
    assert.equal(listMockSentMessages().length, 2);
  });

  await t.test('deleting the project removes its publication records', async () => {
    await storage.deleteProject(project.id);
    assert.equal(await storage.getPublication(discordDraft.id, 'discord'), null);
    assert.equal(await storage.getPublication(telegramDraft.id, 'telegram'), null);
  });
});

test('Publishing fails closed when the bot token is missing', async () => {
  storage.reset();
  resetMockBotState();

  const owner = await storage.saveUser({ id: 531, login: 'publish-owner-4' });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'publish-owner-4/rocket',
    repoName: 'rocket',
    repoOwner: 'publish-owner-4',
    title: 'Rocket',
  });
  const draft = await storage.createDraft({
    projectId: project.id,
    platformId: 'telegram',
    text: 'Join us https://crewlink.test/join/rocket',
  });
  await storage.approveDraft(draft.id, owner.login);
  await connectBotChannel({
    userId: owner.id as string,
    projectId: project.id,
    platformId: 'telegram',
    channelId: '@crewlinktest',
  });

  const saved = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    await assert.rejects(
      () => publishDraft({ userId: owner.id as string, draftId: draft.id }),
      (err) => code(err) === 'bot_token_missing'
    );
  } finally {
    process.env.TELEGRAM_BOT_TOKEN = saved;
  }

  const failed = await storage.getPublication(draft.id, 'telegram');
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.errorCode, 'bot_token_missing');
  assert.equal(listMockSentMessages().length, 0);
});

test('Concurrent publish requests cannot double-send', async () => {
  storage.reset();
  resetMockBotState();

  const owner = await storage.saveUser({ id: 541, login: 'publish-owner-5' });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'publish-owner-5/rocket',
    repoName: 'rocket',
    repoOwner: 'publish-owner-5',
    title: 'Rocket',
  });
  const draft = await storage.createDraft({
    projectId: project.id,
    platformId: 'discord',
    text: 'Concurrent claim https://crewlink.test/join/rocket',
  });
  await storage.approveDraft(draft.id, owner.login);
  await connectBotChannel({
    userId: owner.id as string,
    projectId: project.id,
    platformId: 'discord',
    channelId: '1234567890',
  });

  const outcomes = await Promise.allSettled([
    publishDraft({ userId: owner.id as string, draftId: draft.id }),
    publishDraft({ userId: owner.id as string, draftId: draft.id }),
  ]);
  const rejected = outcomes.filter(
    (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
  );
  assert.equal(outcomes.length - rejected.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(
    ['in_progress', 'already_published'].includes(code(rejected[0].reason)),
    `unexpected rejection: ${code(rejected[0].reason)}`
  );
  assert.equal(listMockSentMessages().length, 1);
});

test('A concurrent retry of a failed publication sends once', async () => {
  storage.reset();
  resetMockBotState();

  const owner = await storage.saveUser({ id: 551, login: 'publish-owner-6' });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'publish-owner-6/rocket',
    repoName: 'rocket',
    repoOwner: 'publish-owner-6',
    title: 'Rocket',
  });
  const draft = await storage.createDraft({
    projectId: project.id,
    platformId: 'discord',
    text: 'Retry claim https://crewlink.test/join/rocket',
  });

  await storage.approveDraft(draft.id, owner.login);

  // First attempt fails at the platform.
  await connectBotChannel({
    userId: owner.id as string,
    projectId: project.id,
    platformId: 'discord',
    channelId: 'mock-send-fails',
  });
  await assert.rejects(
    () => publishDraft({ userId: owner.id as string, draftId: draft.id }),
    (err) => code(err) === 'send_failed'
  );

  // Reconnect to a working channel; approval must be refreshed first.
  await connectBotChannel({
    userId: owner.id as string,
    projectId: project.id,
    platformId: 'discord',
    channelId: '1234567890',
  });
  await storage.approveDraft(draft.id, owner.login);

  const outcomes = await Promise.allSettled([
    publishDraft({ userId: owner.id as string, draftId: draft.id }),
    publishDraft({ userId: owner.id as string, draftId: draft.id }),
  ]);
  const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  const rejected = outcomes.filter(
    (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
  );
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(['in_progress', 'already_published'].includes(code(rejected[0].reason)));
  assert.equal(listMockSentMessages().length, 1);
  assert.equal((await storage.getPublication(draft.id, 'discord'))?.status, 'published');
});

test('Inactive connections and uncertain attempts fail closed', async () => {
  storage.reset();
  resetMockBotState();

  const owner = await storage.saveUser({ id: 561, login: 'publish-owner-7' });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'publish-owner-7/rocket',
    repoName: 'rocket',
    repoOwner: 'publish-owner-7',
    title: 'Rocket',
  });

  const publishedDraft = await storage.createDraft({
    projectId: project.id,
    platformId: 'telegram',
    text: 'First draft https://crewlink.test/join/rocket',
  });
  const blockedDraft = await storage.createDraft({
    projectId: project.id,
    platformId: 'telegram',
    text: 'Second draft https://crewlink.test/join/rocket',
  });
  await storage.approveDraft(publishedDraft.id, owner.login);
  await storage.approveDraft(blockedDraft.id, owner.login);

  const connection = await connectBotChannel({
    userId: owner.id as string,
    projectId: project.id,
    platformId: 'telegram',
    channelId: '@crewlinktest',
  });
  await publishDraft({ userId: owner.id as string, draftId: publishedDraft.id });

  await disconnectConnection(owner.id as string, connection.id);
  await assert.rejects(
    () => publishDraft({ userId: owner.id as string, draftId: blockedDraft.id }),
    (err) => code(err) === 'connection_inactive'
  );

  // Reconnecting the same destination keeps the approval.
  await connectBotChannel({
    userId: owner.id as string,
    projectId: project.id,
    platformId: 'telegram',
    channelId: '@crewlinktest',
  });

  // A stale `sending` row is uncertain: never resent automatically.
  await storage.createPublicationIfAbsent({
    id: 'pub_stale',
    userId: owner.id as string,
    projectId: project.id,
    draftId: blockedDraft.id,
    connectionId: connection.id,
    platformId: 'telegram',
    status: 'sending',
    mode: 'api',
    contentHash: sha256(blockedDraft.text),
    externalIds: [],
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  });

  await assert.rejects(
    () => publishDraft({ userId: owner.id as string, draftId: blockedDraft.id }),
    (err) => code(err) === 'uncertain'
  );
  assert.equal(listMockSentMessages().length, 1);
});
