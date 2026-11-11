import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { storage } from '../src/lib/storage';
import { getCredentialVault } from '../src/posting/credentials';
import {
  AnalyticsError,
  resetAnalyticsSyncStateForTests,
  syncProjectAnalytics,
} from '../src/analytics/sync';
import {
  AnalyticsClientError,
  resetAnalyticsClientsForTests,
  setAnalyticsClientForTests,
  type AnalyticsClient,
} from '../src/analytics/clients/index';
import type { Project, User } from '../src/types/index';

process.env.ANALYTICS_SNAPSHOT_MAX_PER_ENTITY = '60';

const NOW = new Date('2026-11-10T12:00:00.000Z');

async function makeProject(idBase: number, label: string): Promise<{ owner: User; project: Project }> {
  const owner = await storage.saveUser({ id: idBase, login: `${label}-owner` });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: `${label}-owner/rocket`,
    repoName: 'rocket',
    repoOwner: `${label}-owner`,
    title: 'Rocket',
  });
  return { owner, project };
}

async function seedAccountConnection(input: {
  userId: string;
  projectId: string;
  platformId: string;
  externalAccountId?: string;
  externalAccountName?: string;
  scopes?: string[];
  instanceUrl?: string;
  channelId?: string;
  serverId?: string;
}): Promise<string> {
  const connectionId = `pcn_${input.platformId}_${Math.random().toString(36).slice(2, 10)}`;
  const vault = getCredentialVault();
  const encrypted = await vault.encrypt('access-token-test-value', {
    userId: input.userId,
    platformId: input.platformId,
    connectionId,
  });
  const now = new Date().toISOString();
  await storage.upsertPlatformConnection({
    id: connectionId,
    userId: input.userId,
    projectId: input.projectId,
    platformId: input.platformId,
    externalAccountId: input.externalAccountId || 'acct-1',
    externalAccountName: input.externalAccountName || 'account',
    ...(input.instanceUrl ? { instanceUrl: input.instanceUrl } : {}),
    ...(input.channelId ? { channelId: input.channelId } : {}),
    ...(input.serverId ? { serverId: input.serverId } : {}),
    status: 'active',
    scopes: input.scopes || [],
    accessTokenCiphertext: encrypted.ciphertext,
    credentialProvider: encrypted.provider,
    keyRef: encrypted.keyRef,
    createdAt: now,
    updatedAt: now,
  });
  return connectionId;
}

async function seedBotConnection(input: {
  userId: string;
  projectId: string;
  platformId: 'discord' | 'telegram';
  channelId: string;
  serverId?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await storage.upsertPlatformConnection({
    id: `pcn_${input.platformId}_${Math.random().toString(36).slice(2, 10)}`,
    userId: input.userId,
    projectId: input.projectId,
    platformId: input.platformId,
    externalAccountId: input.serverId || input.channelId,
    externalAccountName: 'Test channel',
    channelId: input.channelId,
    ...(input.serverId ? { serverId: input.serverId } : {}),
    status: 'active',
    scopes: ['bot'],
    accessTokenCiphertext: '',
    credentialProvider: 'none',
    keyRef: '',
    createdAt: now,
    updatedAt: now,
  });
}

async function seedPublished(input: {
  userId: string;
  project: Project;
  platformId: string;
  externalId?: string;
  externalUrl?: string;
  mode?: 'api' | 'manual';
  campaignId?: string;
  createdAt?: string;
  threadParts?: string[];
  title?: string;
}): Promise<{ draftId: string; publicationId: string }> {
  const draft = await storage.createDraft({
    projectId: input.project.id,
    platformId: input.platformId,
    text: `Join the ${input.project.title} crew at ${input.project.repoFullName}`,
    ...(input.threadParts ? { threadParts: input.threadParts } : {}),
    ...(input.title ? { title: input.title, subreddit: 'test', submissionType: 'self' as const } : {}),
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
  });
  const createdAt = input.createdAt || NOW.toISOString();
  const publication = await storage.createPublicationIfAbsent({
    id: `pub_${Math.random().toString(36).slice(2, 12)}`,
    userId: input.userId,
    projectId: input.project.id,
    draftId: draft.id,
    platformId: input.platformId,
    status: 'published',
    mode: input.mode || 'api',
    contentHash: 'approved-hash',
    externalId: input.mode === 'manual' ? undefined : input.externalId,
    externalIds: [],
    externalUrl: input.externalUrl,
    confirmedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  });
  return { draftId: draft.id, publicationId: publication.publication.id };
}

function fixedClient(input: {
  platform: 'x' | 'bluesky' | 'reddit' | 'discord' | 'telegram';
  account?: Record<string, unknown>;
  post?: (externalId: string) => Record<string, unknown>;
}): AnalyticsClient {
  return {
    platform: input.platform,
    async fetchAccount() {
      return { metrics: input.account || {} };
    },
    async fetchPost({ publication }) {
      return {
        metrics: input.post ? input.post(publication.externalId || '') : {},
      };
    },
  };
}

test('sync collects account and post metrics, links campaigns and is idempotent', async (t) => {
  storage.reset();
  resetAnalyticsClientsForTests();
  resetAnalyticsSyncStateForTests();

  const { owner, project } = await makeProject(9101, 'sync-success');
  await seedAccountConnection({
    userId: String(owner.id),
    projectId: project.id,
    platformId: 'x',
    externalAccountId: 'x-account',
    externalAccountName: 'rocket',
    scopes: ['tweet.read', 'users.read'],
  });
  const campaign = await storage.createCampaign({
    projectId: project.id,
    ownerId: String(owner.id),
    brief: 'Launch the rocket project consistently',
    name: 'Launch',
    platforms: ['x'],
    durationDays: 7,
    timezone: 'UTC',
  });
  await seedPublished({
    userId: String(owner.id),
    project,
    platformId: 'x',
    externalId: 'tweet-1',
    campaignId: campaign.id,
    createdAt: '2026-11-08T10:00:00.000Z',
  });
  await seedPublished({
    userId: String(owner.id),
    project,
    platformId: 'x',
    externalId: 'tweet-2',
    createdAt: '2026-11-09T10:00:00.000Z',
  });

  let likes = 10;
  const client: AnalyticsClient = {
    platform: 'x',
    async fetchAccount() {
      return { metrics: { followers_count: 500, tweet_count: 60 } };
    },
    async fetchPost() {
      return {
        metrics: {
          impression_count: 1000,
          like_count: likes,
          reply_count: 4,
          retweet_count: 2,
          quote_count: 1,
          bookmark_count: 3,
          url_link_clicks: 7,
        },
      };
    },
  };
  setAnalyticsClientForTests('x', client);

  await t.test('first sync writes normalized account, posts and snapshots', async () => {
    const result = await syncProjectAnalytics({
      user: owner,
      project,
      platformIds: ['x'],
      now: NOW,
    });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].status, 'completed');
    assert.equal(result.results[0].postsUpdated, 2);

    const accounts = await storage.listAnalyticsAccounts(project.id);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].metrics.followers, 500);
    assert.equal(accounts[0].metrics.posts, 60);
    assert.equal(accounts[0].status, 'active');

    const posts = await storage.listAnalyticsPosts({ projectId: project.id });
    assert.equal(posts.length, 2);
    const campaignPost = posts.find((post) => post.campaignId === campaign.id);
    assert.ok(campaignPost);
    assert.equal(campaignPost?.contentType, 'text');
    assert.equal(campaignPost?.engagement, 20);
    assert.equal(campaignPost?.engagementRate, 2);
    assert.equal(campaignPost?.metrics.impressions, 1000);
    assert.equal(campaignPost?.status, 'active');

    const snapshots = await storage.listAnalyticsSnapshots({ projectId: project.id });
    // Two account snapshots? One account + two posts = 3.
    assert.equal(snapshots.length, 3);
    const resultSnapshots = result.results[0].snapshotsWritten;
    assert.equal(resultSnapshots, 3);
  });

  await t.test('a repeat sync with unchanged metrics adds no duplicate snapshot', async () => {
    const before = await storage.listAnalyticsSnapshots({ projectId: project.id });
    const result = await syncProjectAnalytics({
      user: owner,
      project,
      platformIds: ['x'],
      now: NOW,
    });
    assert.equal(result.results[0].status, 'completed');
    assert.equal(result.results[0].snapshotsWritten, 0);
    const after = await storage.listAnalyticsSnapshots({ projectId: project.id });
    assert.equal(after.length, before.length);
    const posts = await storage.listAnalyticsPosts({ projectId: project.id });
    assert.equal(posts.length, 2);
  });

  await t.test('changed metrics create a new historical snapshot', async () => {
    likes = 50;
    const result = await syncProjectAnalytics({
      user: owner,
      project,
      platformIds: ['x'],
      now: new Date('2026-11-10T18:00:00.000Z'),
    });
    assert.equal(result.results[0].snapshotsWritten, 2);
    const posts = await storage.listAnalyticsPosts({ projectId: project.id });
    assert.equal(posts[0].engagement, 60);
    for (const post of posts) {
      const snapshots = await storage.listAnalyticsSnapshots({
        analyticsPostId: post.id,
        order: 'asc',
      });
      assert.equal(snapshots.length, 2);
      assert.equal(snapshots[0].metrics.likes, 10);
      assert.equal(snapshots[1].metrics.likes, 50);
    }
  });

  await t.test('no credential material appears in analytics rows', async () => {
    const serialized = JSON.stringify([
      await storage.listAnalyticsAccounts(project.id),
      await storage.listAnalyticsPosts({ projectId: project.id }),
      await storage.listAnalyticsSnapshots({ projectId: project.id }),
      await storage.listAnalyticsSyncs(project.id),
    ]);
    assert.equal(serialized.includes('access-token-test-value'), false);
    assert.equal(serialized.toLowerCase().includes('ciphertext'), false);
  });
});

test('partial failures, revoked auth and rate limits are recorded without resending', async (t) => {
  storage.reset();
  resetAnalyticsClientsForTests();
  resetAnalyticsSyncStateForTests();

  const { owner, project } = await makeProject(9201, 'sync-partial');
  await seedAccountConnection({
    userId: String(owner.id),
    projectId: project.id,
    platformId: 'x',
    scopes: ['tweet.read'],
  });
  await seedPublished({
    userId: String(owner.id),
    project,
    platformId: 'x',
    externalId: 'good-1',
    createdAt: '2026-11-09T10:00:00.000Z',
  });
  await seedPublished({
    userId: String(owner.id),
    project,
    platformId: 'x',
    externalId: 'bad-1',
    createdAt: '2026-11-08T10:00:00.000Z',
  });

  setAnalyticsClientForTests('x', {
    platform: 'x',
    async fetchAccount() {
      return { metrics: { followers_count: 10 } };
    },
    async fetchPost({ publication }) {
      if (publication.externalId === 'bad-1') {
        throw new AnalyticsClientError('Platform exploded.', 'platform_error');
      }
      return {
        metrics: {
          impression_count: 100,
          like_count: 5,
          reply_count: 1,
          retweet_count: 1,
          quote_count: 0,
          bookmark_count: 0,
          url_link_clicks: 0,
        },
      };
    },
  });

  await t.test('one failed post does not erase the successful ones', async () => {
    const result = await syncProjectAnalytics({ user: owner, project, platformIds: ['x'], now: NOW });
    assert.equal(result.results[0].status, 'partial');
    assert.equal(result.results[0].postsUpdated, 1);
    assert.equal(result.results[0].errorCode, 'platform_error');
    const posts = await storage.listAnalyticsPosts({ projectId: project.id });
    assert.equal(posts.find((post) => post.externalId === 'good-1')?.status, 'active');
    assert.equal(posts.find((post) => post.externalId === 'bad-1')?.status, 'error');
    const syncs = await storage.listAnalyticsSyncs(project.id);
    assert.equal(syncs[0].status, 'partial');
    assert.equal(syncs[0].errorCode, 'platform_error');
    assert.equal(JSON.stringify(syncs).includes('Platform exploded'), true);
    assert.equal(JSON.stringify(syncs).includes('access-token'), false);
  });

  await t.test('a revoked account stops the sweep and records auth_revoked', async () => {
    setAnalyticsClientForTests('x', {
      platform: 'x',
      async fetchAccount() {
        throw new AnalyticsClientError('Revoked.', 'auth_revoked');
      },
      async fetchPost() {
        return { metrics: { impression_count: 1 } };
      },
    });
    const result = await syncProjectAnalytics({ user: owner, project, platformIds: ['x'], now: NOW });
    assert.equal(result.results[0].status, 'failed');
    assert.equal(result.results[0].errorCode, 'auth_revoked');
    const accounts = await storage.listAnalyticsAccounts(project.id);
    assert.equal(accounts[0].status, 'error');
    assert.equal(accounts[0].lastErrorCode, 'auth_revoked');
  });

  await t.test('a rate limit stops the sweep instead of hammering the platform', async () => {
    setAnalyticsClientForTests('x', {
      platform: 'x',
      async fetchAccount() {
        return { metrics: { followers_count: 10 } };
      },
      async fetchPost() {
        throw new AnalyticsClientError('Slow down.', 'rate_limited', 30);
      },
    });
    const result = await syncProjectAnalytics({ user: owner, project, platformIds: ['x'], now: NOW });
    assert.equal(result.results[0].status, 'failed');
    assert.equal(result.results[0].errorCode, 'rate_limited');
    const syncs = await storage.listAnalyticsSyncs(project.id);
    assert.ok(syncs.some((sync) => sync.errorCode === 'rate_limited'));
  });
});

test('unsupported platforms, missing connections and manual posts are explicit', async (t) => {
  storage.reset();
  resetAnalyticsClientsForTests();
  resetAnalyticsSyncStateForTests();

  const { owner, project } = await makeProject(9301, 'sync-unsupported');

  await t.test('WhatsApp is skipped with no API call', async () => {
    let called = false;
    setAnalyticsClientForTests('whatsapp', {
      platform: 'whatsapp',
      async fetchAccount() {
        called = true;
        return { metrics: {} };
      },
      async fetchPost() {
        called = true;
        return { metrics: {} };
      },
    });
    const result = await syncProjectAnalytics({
      user: owner,
      project,
      platformIds: ['whatsapp'],
      now: NOW,
    });
    assert.equal(result.results[0].status, 'skipped');
    assert.equal(result.results[0].errorCode, 'unsupported_platform');
    assert.equal(called, false);
  });

  await t.test('a platform with no active connection is skipped', async () => {
    const result = await syncProjectAnalytics({ user: owner, project, platformIds: ['bluesky'], now: NOW });
    assert.equal(result.results[0].status, 'skipped');
    assert.equal(result.results[0].errorCode, 'connection_missing');
    const syncs = await storage.listAnalyticsSyncs(project.id);
    assert.ok(syncs.some((sync) => sync.status === 'skipped'));
  });

  await t.test('a manual publication is stored as unsupported and never fetched', async () => {
    await seedAccountConnection({
      userId: String(owner.id),
      projectId: project.id,
      platformId: 'x',
      scopes: ['tweet.read'],
    });
    await seedPublished({
      userId: String(owner.id),
      project,
      platformId: 'x',
      mode: 'manual',
    });
    let postCalls = 0;
    setAnalyticsClientForTests('x', {
      platform: 'x',
      async fetchAccount() {
        return { metrics: { followers_count: 1 } };
      },
      async fetchPost() {
        postCalls += 1;
        return { metrics: {} };
      },
    });
    const result = await syncProjectAnalytics({ user: owner, project, platformIds: ['x'], now: NOW });
    assert.equal(result.results[0].status, 'completed');
    assert.equal(postCalls, 0);
    const posts = await storage.listAnalyticsPosts({ projectId: project.id });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].status, 'unsupported');
    assert.match(posts[0].note || '', /manual/i);
  });

  await t.test('Telegram stores its subscriber count and marks post metrics unsupported', async () => {
    await seedBotConnection({
      userId: String(owner.id),
      projectId: project.id,
      platformId: 'telegram',
      channelId: '@rocket',
    });
    await seedPublished({
      userId: String(owner.id),
      project,
      platformId: 'telegram',
      externalId: '42',
      createdAt: '2026-11-09T10:00:00.000Z',
    });
    setAnalyticsClientForTests('telegram', fixedClient({ platform: 'telegram', account: { memberCount: 700 } }));
    const result = await syncProjectAnalytics({
      user: owner,
      project,
      platformIds: ['telegram'],
      now: NOW,
    });
    assert.equal(result.results[0].status, 'completed');
    const accounts = await storage.listAnalyticsAccounts(project.id);
    const telegram = accounts.find((account) => account.platformId === 'telegram');
    assert.equal(telegram?.metrics.subscribers, 700);
    const posts = await storage.listAnalyticsPosts({ projectId: project.id, platformId: 'telegram' });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].status, 'unsupported');
  });

  await t.test('Discord reactions and member counts are normalized', async () => {
    await seedBotConnection({
      userId: String(owner.id),
      projectId: project.id,
      platformId: 'discord',
      channelId: 'chan-1',
      serverId: 'guild-1',
    });
    await seedPublished({
      userId: String(owner.id),
      project,
      platformId: 'discord',
      externalId: 'msg-1',
      createdAt: '2026-11-09T11:00:00.000Z',
    });
    setAnalyticsClientForTests(
      'discord',
      fixedClient({ platform: 'discord', account: { approximate_member_count: 250 }, post: () => ({ reactionCount: 12 }) })
    );
    const result = await syncProjectAnalytics({
      user: owner,
      project,
      platformIds: ['discord'],
      now: NOW,
    });
    assert.equal(result.results[0].status, 'completed');
    const posts = await storage.listAnalyticsPosts({ projectId: project.id, platformId: 'discord' });
    assert.equal(posts.length, 1);
    assert.deepEqual(posts[0].metrics, { likes: 12 });
    assert.equal(posts[0].engagement, 12);
    assert.equal(posts[0].engagementRate, null);
  });
});

test('two concurrent syncs for one project cannot both run', async () => {
  storage.reset();
  resetAnalyticsClientsForTests();
  resetAnalyticsSyncStateForTests();
  const { owner, project } = await makeProject(9401, 'sync-lock');
  await seedBotConnection({
    userId: String(owner.id),
    projectId: project.id,
    platformId: 'discord',
    channelId: 'chan-lock',
    serverId: 'guild-lock',
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  setAnalyticsClientForTests('discord', {
    platform: 'discord',
    async fetchAccount() {
      await gate;
      return { metrics: { approximate_member_count: 5 } };
    },
    async fetchPost() {
      return { metrics: { reactionCount: 1 } };
    },
  });

  const first = syncProjectAnalytics({ user: owner, project, platformIds: ['discord'], now: NOW });
  await assert.rejects(
    () => syncProjectAnalytics({ user: owner, project, platformIds: ['discord'], now: NOW }),
    (error) => error instanceof AnalyticsError && error.code === 'sync_in_progress'
  );
  release();
  const result = await first;
  assert.equal(result.results[0].status, 'completed');
  resetAnalyticsClientsForTests();
});
