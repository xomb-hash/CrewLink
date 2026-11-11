import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { storage } from '../src/lib/storage';
import type { AnalyticsInsightPayload, AnalyticsSnapshot } from '../src/analytics/types';

function snapshot(input: {
  id: string;
  userId: string;
  projectId: string;
  postId: string;
  capturedAt: string;
  likes: number;
  dedupeKey?: string;
}): AnalyticsSnapshot {
  return {
    id: input.id,
    userId: input.userId,
    projectId: input.projectId,
    platformId: 'bluesky',
    scope: 'post',
    analyticsPostId: input.postId,
    dedupeKey: input.dedupeKey || `${input.id}-key`,
    metrics: { likes: input.likes },
    capturedAt: input.capturedAt,
    source: 'api',
    createdAt: input.capturedAt,
  };
}

function insightPayload(): AnalyticsInsightPayload {
  return {
    summary: 'A stored insight.',
    findings: [],
    recommendations: [],
    comparisons: [],
    topFormats: [],
    topTopics: [],
    postingTime: null,
    dataQuality: [],
    limitations: [],
    insufficientData: true,
    verificationStatus: 'unverified',
    factCatalog: [],
    facts: {
      range: { from: '2026-11-01', to: '2026-11-07', days: 7, timezone: 'UTC' },
      sample: { publishedPosts: 0, postsWithMetrics: 0, platforms: 0, campaigns: 0 },
      totals: { metrics: {}, engagement: null, engagementRate: null },
      platforms: [],
      previousTotals: null,
      unavailable: [],
    },
    generatedAt: '2026-11-07T00:00:00.000Z',
  };
}

test('analytics storage keeps accounts, posts, snapshots, syncs and insights project-scoped', async (t) => {
  storage.reset();
  const owner = await storage.saveUser({ id: 9001, login: 'analytics-owner' });
  const other = await storage.saveUser({ id: 9002, login: 'analytics-other' });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'analytics-owner/rocket',
    repoName: 'rocket',
    repoOwner: 'analytics-owner',
    title: 'Rocket',
  });
  const otherProject = await storage.createProject({
    ownerLogin: other.login,
    ownerId: other.id,
    repoFullName: 'analytics-other/boat',
    repoName: 'boat',
    repoOwner: 'analytics-other',
    title: 'Boat',
  });

  const account = await storage.upsertAnalyticsAccount({
    userId: String(owner.id),
    projectId: project.id,
    connectionId: 'pcn_test_bluesky',
    platformId: 'bluesky',
    externalAccountId: 'did:plc:test',
    externalAccountName: 'tester.bsky.social',
    metrics: { followers: 120, posts: 40 },
    availableMetrics: ['followers', 'posts'],
    unavailableMetrics: [],
    status: 'active',
    lastSyncedAt: '2026-11-10T10:00:00.000Z',
  });

  await t.test('account upsert is keyed by connection, not by a new row', async () => {
    assert.equal(account.platformId, 'bluesky');
    const updated = await storage.upsertAnalyticsAccount({
      userId: String(owner.id),
      projectId: project.id,
      connectionId: 'pcn_test_bluesky',
      platformId: 'bluesky',
      metrics: { followers: 150, posts: 42 },
      availableMetrics: ['followers', 'posts'],
      unavailableMetrics: [],
      status: 'active',
    });
    assert.equal(updated.id, account.id);
    assert.equal(updated.metrics.followers, 150);
    const listed = await storage.listAnalyticsAccounts(project.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].metrics.followers, 150);
    assert.equal(await storage.getAnalyticsAccountByConnection('missing'), null);
  });

  const draft = await storage.createDraft({
    projectId: project.id,
    platformId: 'bluesky',
    text: 'Join the rocket crew at https://crewlink.test/join/rocket',
  });

  const publication = await storage.createPublicationIfAbsent({
    id: 'pub_test_bluesky',
    userId: String(owner.id),
    projectId: project.id,
    draftId: draft.id,
    platformId: 'bluesky',
    status: 'published',
    mode: 'api',
    contentHash: 'hash',
    externalId: 'at://did:plc:test/app.bsky.feed.post/abc',
    externalIds: [],
    confirmedAt: '2026-11-08T10:00:00.000Z',
    createdAt: '2026-11-08T10:00:00.000Z',
    updatedAt: '2026-11-08T10:00:00.000Z',
  });

  await t.test('publications can be listed for the sync engine', async () => {
    const all = await storage.listPublicationsByProject(project.id);
    assert.equal(all.length, 1);
    const filtered = await storage.listPublicationsByProject(project.id, 'bluesky');
    assert.equal(filtered.length, 1);
    const none = await storage.listPublicationsByProject(project.id, 'reddit');
    assert.equal(none.length, 0);
    const otherProjectList = await storage.listPublicationsByProject(otherProject.id);
    assert.equal(otherProjectList.length, 0);
  });

  const post = await storage.upsertAnalyticsPost({
    userId: String(owner.id),
    projectId: project.id,
    publicationId: publication.publication.id,
    draftId: draft.id,
    platformId: 'bluesky',
    externalId: 'at://did:plc:test/app.bsky.feed.post/abc',
    externalUrl: 'https://bsky.app/profile/tester.bsky.social/post/abc',
    publishedAt: '2026-11-08T10:00:00.000Z',
    contentType: 'short',
    topic: 'launch',
    metrics: { likes: 5, comments: 1 },
    availableMetrics: ['likes', 'comments'],
    unavailableMetrics: ['reposts'],
    engagement: 6,
    engagementRate: null,
    status: 'active',
  });

  await t.test('post upsert is idempotent per publication', async () => {
    assert.equal(post.metrics.likes, 5);
    const updated = await storage.upsertAnalyticsPost({
      userId: String(owner.id),
      projectId: project.id,
      publicationId: publication.publication.id,
      draftId: draft.id,
      platformId: 'bluesky',
      externalId: 'at://did:plc:test/app.bsky.feed.post/abc',
      publishedAt: '2026-11-08T10:00:00.000Z',
      contentType: 'short',
      metrics: { likes: 9 },
      availableMetrics: ['likes'],
      unavailableMetrics: ['comments'],
      engagement: 9,
      engagementRate: null,
      status: 'partial',
    });
    assert.equal(updated.id, post.id);
    assert.equal(updated.metrics.likes, 9);
    const fetched = await storage.getAnalyticsPostByPublication(publication.publication.id);
    assert.equal(fetched?.id, post.id);
    const listed = await storage.listAnalyticsPosts({ projectId: project.id });
    assert.equal(listed.length, 1);
    const otherList = await storage.listAnalyticsPosts({ projectId: otherProject.id });
    assert.equal(otherList.length, 0);
  });

  await t.test('post filters cover platform, campaign, status, date and pagination', async () => {
    await storage.upsertAnalyticsPost({
      userId: String(owner.id),
      projectId: project.id,
      publicationId: 'pub_other_date',
      draftId: draft.id,
      platformId: 'x',
      publishedAt: '2026-09-01T10:00:00.000Z',
      contentType: 'text',
      metrics: {},
      availableMetrics: [],
      unavailableMetrics: ['impressions'],
      engagement: null,
      engagementRate: null,
      status: 'error',
    });
    assert.equal((await storage.listAnalyticsPosts({ projectId: project.id, platformId: 'x' })).length, 1);
    assert.equal((await storage.listAnalyticsPosts({ projectId: project.id, platformId: 'reddit' })).length, 0);
    assert.equal((await storage.listAnalyticsPosts({ projectId: project.id, status: 'error' })).length, 1);
    assert.equal(
      (await storage.listAnalyticsPosts({ projectId: project.id, from: '2026-11-01', to: '2026-11-30' })).length,
      1
    );
    assert.equal(
      (await storage.listAnalyticsPosts({ projectId: project.id, from: '2026-10-01', to: '2026-10-31' })).length,
      0
    );
    const page = await storage.listAnalyticsPosts({ projectId: project.id, limit: 1, offset: 1 });
    assert.equal(page.length, 1);
    assert.equal(page[0].platformId, 'x');
  });

  await t.test('snapshots are immutable, deduplicated and ordered', async () => {
    const first = snapshot({
      id: 'snap_1',
      userId: String(owner.id),
      projectId: project.id,
      postId: post.id,
      capturedAt: '2026-11-08T10:00:00.000Z',
      likes: 5,
    });
    const created = await storage.createAnalyticsSnapshotIfAbsent(first);
    assert.equal(created.created, true);
    const duplicate = await storage.createAnalyticsSnapshotIfAbsent({ ...first, id: 'snap_1b' });
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.snapshot.id, 'snap_1');

    await storage.createAnalyticsSnapshotIfAbsent(
      snapshot({
        id: 'snap_2',
        userId: String(owner.id),
        projectId: project.id,
        postId: post.id,
        capturedAt: '2026-11-09T10:00:00.000Z',
        likes: 20,
      })
    );
    const ascending = await storage.listAnalyticsSnapshots({ analyticsPostId: post.id });
    assert.deepEqual(ascending.map((row) => row.id), ['snap_1', 'snap_2']);
    const descending = await storage.listAnalyticsSnapshots({
      analyticsPostId: post.id,
      order: 'desc',
      limit: 1,
    });
    assert.equal(descending[0].id, 'snap_2');
    assert.equal(descending[0].metrics.likes, 20);
  });

  await t.test('retention pruning keeps the newest snapshots', async () => {
    const createdPost = await storage.upsertAnalyticsPost({
      userId: String(owner.id),
      projectId: project.id,
      publicationId: 'pub_prune',
      draftId: draft.id,
      platformId: 'bluesky',
      publishedAt: '2026-11-01T00:00:00.000Z',
      contentType: 'short',
      metrics: {},
      availableMetrics: [],
      unavailableMetrics: [],
      engagement: null,
      engagementRate: null,
      status: 'active',
    });
    for (let index = 0; index < 5; index += 1) {
      await storage.createAnalyticsSnapshotIfAbsent(
        snapshot({
          id: `snap_prune_${index}`,
          userId: String(owner.id),
          projectId: project.id,
          postId: createdPost.id,
          capturedAt: `2026-11-0${index + 1}T00:00:00.000Z`,
          likes: index,
        })
      );
    }
    const removed = await storage.pruneAnalyticsSnapshots({
      scope: 'post',
      id: createdPost.id,
      keep: 2,
      olderThan: '2026-11-03T00:00:00.000Z',
    });
    assert.ok(removed >= 3);
    const remaining = await storage.listAnalyticsSnapshots({ analyticsPostId: createdPost.id });
    assert.equal(remaining.length, 2);
    assert.deepEqual(remaining.map((row) => row.id), ['snap_prune_3', 'snap_prune_4']);
  });

  await t.test('sync records track status and can be found while running', async () => {
    const sync = await storage.createAnalyticsSync({
      userId: String(owner.id),
      projectId: project.id,
      platformId: 'bluesky',
      trigger: 'manual',
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    const running = await storage.getRunningAnalyticsSync(
      project.id,
      new Date(Date.now() - 120_000).toISOString()
    );
    assert.equal(running?.id, sync.id);
    const updated = await storage.updateAnalyticsSync(sync.id, {
      status: 'completed',
      finishedAt: new Date().toISOString(),
      postsRequested: 3,
      postsUpdated: 2,
      snapshotsWritten: 1,
    });
    assert.equal(updated?.status, 'completed');
    assert.equal(updated?.postsUpdated, 2);
    const listed = await storage.listAnalyticsSyncs(project.id);
    assert.equal(listed[0].id, sync.id);
    assert.equal(
      await storage.getRunningAnalyticsSync(project.id, new Date(Date.now() - 120_000).toISOString()),
      null
    );
  });

  await t.test('insights store advisory payloads and accept/dismiss state', async () => {
    const insight = await storage.createAnalyticsInsight({
      userId: String(owner.id),
      projectId: project.id,
      scope: 'project',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-07',
      provider: 'mock',
      model: 'mock-deterministic',
      sampleSize: 0,
      promptTokens: 0,
      completionTokens: 0,
      payload: insightPayload(),
    });
    assert.equal(insight.status, 'new');
    assert.equal((await storage.getAnalyticsInsight(insight.id))?.payload.summary, 'A stored insight.');
    const listed = await storage.listAnalyticsInsights({ projectId: project.id });
    assert.equal(listed.length, 1);
    const otherListing = await storage.listAnalyticsInsights({ projectId: otherProject.id });
    assert.equal(otherListing.length, 0);
    const accepted = await storage.updateAnalyticsInsightStatus(insight.id, 'accepted');
    assert.equal(accepted?.status, 'accepted');
    assert.ok(accepted?.acceptedAt);
    const dismissed = await storage.updateAnalyticsInsightStatus(insight.id, 'dismissed');
    assert.equal(dismissed?.status, 'dismissed');
    assert.equal(dismissed?.acceptedAt, undefined);
    assert.equal(await storage.updateAnalyticsInsightStatus('missing', 'accepted'), null);
  });

  await t.test('deleting a project removes all analytics rows', async () => {
    assert.equal(await storage.deleteProject(project.id), true);
    assert.equal((await storage.listAnalyticsAccounts(project.id)).length, 0);
    assert.equal((await storage.listAnalyticsPosts({ projectId: project.id })).length, 0);
    assert.equal((await storage.listAnalyticsSnapshots({ projectId: project.id })).length, 0);
    assert.equal((await storage.listAnalyticsSyncs(project.id)).length, 0);
    assert.equal((await storage.listAnalyticsInsights({ projectId: project.id })).length, 0);
  });
});
