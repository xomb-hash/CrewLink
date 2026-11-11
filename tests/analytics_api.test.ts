import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import './setup';
import { storage } from '../src/lib/storage';
import { signValue } from '../src/lib/auth';
import { rateLimiter } from '../src/lib/rateLimit';
import { MockLlmProvider } from '../src/ai/providers/mock';
import { resetLlmProvider, setLlmProvider, UnconfiguredProvider } from '../src/ai/provider';
import type { MetricKey } from '../src/analytics/metricsKeys';
import { GET as overviewRoute } from '../src/app/api/analytics/overview/route';
import { GET as postsRoute } from '../src/app/api/analytics/posts/route';
import { GET as topRoute } from '../src/app/api/analytics/top/route';
import { GET as audienceRoute } from '../src/app/api/analytics/audience/route';
import { GET as timingRoute } from '../src/app/api/analytics/timing/route';
import { GET as campaignsRoute } from '../src/app/api/analytics/campaigns/route';
import { GET as campaignDetailRoute } from '../src/app/api/analytics/campaigns/[id]/route';
import { GET as statusRoute } from '../src/app/api/analytics/status/route';
import { GET as insightsGetRoute, POST as insightsPostRoute } from '../src/app/api/analytics/insights/route';
import { POST as acceptInsightRoute } from '../src/app/api/analytics/insights/[id]/accept/route';
import { POST as syncRoute } from '../src/app/api/analytics/sync/route';
import { GET as reportRoute } from '../src/app/api/analytics/report/route';

interface Seed {
  ownerId: string;
  otherId: string;
  projectId: string;
  otherProjectId: string;
  ownerCookie: string;
  otherCookie: string;
}

async function seed(idBase: number, label: string): Promise<Seed> {
  const owner = await storage.saveUser({ id: idBase, login: `${label}-owner` });
  const other = await storage.saveUser({ id: idBase + 1, login: `${label}-other` });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: `${label}-owner/rocket`,
    repoName: 'rocket',
    repoOwner: `${label}-owner`,
    title: 'Rocket',
  });
  const otherProject = await storage.createProject({
    ownerLogin: other.login,
    ownerId: other.id,
    repoFullName: `${label}-other/boat`,
    repoName: 'boat',
    repoOwner: `${label}-other`,
    title: 'Boat',
  });
  const ownerSession = await storage.createSession(owner.id);
  const otherSession = await storage.createSession(other.id);
  return {
    ownerId: String(owner.id),
    otherId: String(other.id),
    projectId: project.id,
    otherProjectId: otherProject.id,
    ownerCookie: `crewlink_session=${encodeURIComponent(signValue(ownerSession))}`,
    otherCookie: `crewlink_session=${encodeURIComponent(signValue(otherSession))}`,
  };
}

function get(path: string, cookie: string): NextRequest {
  return new NextRequest(`http://localhost:3100${path}`, {
    headers: { cookie },
  });
}

function post(path: string, cookie: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3100${path}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedPost(input: {
  projectId: string;
  userId: string;
  platformId: string;
  publishedAt: string;
  metrics: Partial<Record<MetricKey, number>>;
  engagement: number | null;
  engagementRate?: number | null;
  campaignId?: string;
  contentType?: string;
  externalUrl?: string;
}): Promise<void> {
  const available = Object.keys(input.metrics) as MetricKey[];
  await storage.upsertAnalyticsPost({
    userId: input.userId,
    projectId: input.projectId,
    publicationId: `pub_${Math.random().toString(36).slice(2, 12)}`,
    draftId: `drf_${Math.random().toString(36).slice(2, 12)}`,
    campaignId: input.campaignId,
    platformId: input.platformId,
    externalUrl: input.externalUrl,
    publishedAt: input.publishedAt,
    contentType: (input.contentType || 'text') as never,
    metrics: input.metrics,
    availableMetrics: available,
    unavailableMetrics: [],
    engagement: input.engagement,
    engagementRate: input.engagementRate ?? null,
    status: 'active',
    lastSyncedAt: '2026-11-10T10:00:00.000Z',
  });
}

const day = (offset: number) =>
  new Date(Date.UTC(2026, 10, 10 - offset, 10, 0, 0)).toISOString();

test('analytics API enforces owner-only project access and returns normalized overviews', async (t) => {
  storage.reset();
  rateLimiter.reset();
  const seedData = await seed(9501, 'api-access');
  await seedPost({
    projectId: seedData.projectId,
    userId: seedData.ownerId,
    platformId: 'x',
    publishedAt: day(1),
    metrics: { impressions: 1000, likes: 50, comments: 5, reposts: 2, quotes: 1, saves: 3, clicks: 4 },
    engagement: 61,
    engagementRate: 6.1,
  });
  await seedPost({
    projectId: seedData.projectId,
    userId: seedData.ownerId,
    platformId: 'reddit',
    publishedAt: day(2),
    metrics: { score: 30, comments: 7 },
    engagement: 37,
  });

  await t.test('rejects signed-out callers', async () => {
    const response = await overviewRoute(get(`/api/analytics/overview?projectId=${seedData.projectId}`, ''));
    assert.equal(response.status, 401);
  });

  await t.test('rejects another signed-in user', async () => {
    const response = await overviewRoute(
      get(`/api/analytics/overview?projectId=${seedData.projectId}`, seedData.otherCookie)
    );
    assert.equal(response.status, 403);
  });

  await t.test('requires a project id', async () => {
    const response = await overviewRoute(get('/api/analytics/overview', seedData.ownerCookie));
    assert.equal(response.status, 400);
  });

  await t.test('rejects an invalid custom range', async () => {
    const response = await overviewRoute(
      get(
        `/api/analytics/overview?projectId=${seedData.projectId}&from=2026-11-10&to=2026-11-01`,
        seedData.ownerCookie
      )
    );
    assert.equal(response.status, 400);
  });

  await t.test('returns totals, platform comparison and explicit data quality', async () => {
    const response = await overviewRoute(
      get(`/api/analytics/overview?projectId=${seedData.projectId}&days=30`, seedData.ownerCookie)
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.posts.published, 2);
    assert.equal(data.posts.withMetrics, 2);
    assert.equal(data.engagement.value, 98);
    assert.equal(data.totals.impressions.value, 1000);
    assert.equal(data.totals.score.value, 30);
    assert.equal(data.dataQuality.length, 9);
    assert.ok(
      data.dataQuality.find((item: { platformId: string }) => item.platformId === 'whatsapp')
        .supportStatus === 'unsupported'
    );
    assert.ok(data.engagementRate);
    const serialized = JSON.stringify(data);
    assert.equal(serialized.includes('ciphertext'), false);
    assert.equal(serialized.includes('access-token'), false);
  });

  await t.test('posts route filters and paginates', async () => {
    const response = await postsRoute(
      get(
        `/api/analytics/posts?projectId=${seedData.projectId}&days=30&platformId=x&limit=1`,
        seedData.ownerCookie
      )
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.total, 1);
    assert.equal(data.rows[0].platformId, 'x');
    assert.equal(data.rows[0].engagement, 61);

    const reddit = await postsRoute(
      get(
        `/api/analytics/posts?projectId=${seedData.projectId}&days=30&platformId=reddit`,
        seedData.ownerCookie
      )
    );
    assert.equal((await reddit.json()).rows[0].metrics.score, 30);
  });

  await t.test('top, audience, timing, campaigns and status routes respond', async () => {
    for (const [handler, path] of [
      [topRoute, `/api/analytics/top?projectId=${seedData.projectId}&days=30`],
      [audienceRoute, `/api/analytics/audience?projectId=${seedData.projectId}&days=30`],
      [timingRoute, `/api/analytics/timing?projectId=${seedData.projectId}&days=30`],
      [campaignsRoute, `/api/analytics/campaigns?projectId=${seedData.projectId}&days=30`],
      [statusRoute, `/api/analytics/status?projectId=${seedData.projectId}`],
    ] as const) {
      const response = await handler(get(path, seedData.ownerCookie));
      assert.equal(response.status, 200, path);
    }
    const timing = await (
      await timingRoute(
        get(`/api/analytics/timing?projectId=${seedData.projectId}&days=30`, seedData.ownerCookie)
      )
    ).json();
    assert.equal(timing.sufficientData, false);
    assert.equal(timing.sampleSize, 2);
    assert.match(timing.note, /at least 8/);
    const audience = await (
      await audienceRoute(
        get(`/api/analytics/audience?projectId=${seedData.projectId}&days=30`, seedData.ownerCookie)
      )
    ).json();
    assert.equal(audience.platforms.length, 9);
    assert.ok(audience.platforms.some((platform: { platformId: string; available: boolean }) => platform.platformId === 'reddit' && !platform.available));
  });

  await t.test('campaign detail and cross-project campaign filters are protected', async () => {
    const campaign = await storage.createCampaign({
      projectId: seedData.projectId,
      ownerId: seedData.ownerId,
      brief: 'Campaign brief that is long enough',
      name: 'Rocket launch',
      platforms: ['x'],
      durationDays: 7,
      timezone: 'UTC',
    });
    const response = await campaignDetailRoute(
      get(`/api/analytics/campaigns/${campaign.id}`, seedData.ownerCookie),
      { params: Promise.resolve({ id: campaign.id }) }
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.performance.campaignId, campaign.id);

    const otherResponse = await campaignDetailRoute(
      get(`/api/analytics/campaigns/${campaign.id}`, seedData.otherCookie),
      { params: Promise.resolve({ id: campaign.id }) }
    );
    assert.equal(otherResponse.status, 403);

    const filterResponse = await postsRoute(
      get(
        `/api/analytics/posts?projectId=${seedData.projectId}&days=30&campaignId=${campaign.id}`,
        seedData.ownerCookie
      )
    );
    assert.equal(filterResponse.status, 200);
  });

  await t.test('CSV and PDF reports are owner-only and clearly labelled', async () => {
    const csv = await reportRoute(
      get(
        `/api/analytics/report?projectId=${seedData.projectId}&days=30&format=csv`,
        seedData.ownerCookie
      )
    );
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type') || '', /text\/csv/);
    const csvText = await csv.text();
    assert.match(csvText, /Section,Field,Value/);
    assert.match(csvText, /Section,Platform,Posts/);
    assert.match(csvText, /unavailable/);
    assert.equal(csvText.includes('ciphertext'), false);

    const pdf = await reportRoute(
      get(
        `/api/analytics/report?projectId=${seedData.projectId}&days=30&format=pdf`,
        seedData.ownerCookie
      )
    );
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get('content-type') || '', /application\/pdf/);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString('latin1'), '%PDF-');

    const denied = await reportRoute(
      get(`/api/analytics/report?projectId=${seedData.projectId}&format=csv`, seedData.otherCookie)
    );
    assert.equal(denied.status, 403);
  });
});

test('sync route is owner-only, rate-limited and returns per-platform status', async (t) => {
  storage.reset();
  rateLimiter.reset();
  const seedData = await seed(9601, 'api-sync');

  await t.test('signed-out and cross-owner calls are rejected', async () => {
    const anon = await syncRoute(post('/api/analytics/sync', '', { projectId: seedData.projectId }));
    assert.equal(anon.status, 401);
    const other = await syncRoute(
      post('/api/analytics/sync', seedData.otherCookie, { projectId: seedData.projectId })
    );
    assert.equal(other.status, 403);
  });

  await t.test('a project with no connections returns an empty result', async () => {
    const response = await syncRoute(
      post('/api/analytics/sync', seedData.ownerCookie, { projectId: seedData.projectId })
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.results, []);
  });

  await t.test('manual sync is rate-limited', async () => {
    rateLimiter.reset();
    for (let index = 0; index < 6; index += 1) {
      const response = await syncRoute(
        post('/api/analytics/sync', seedData.ownerCookie, { projectId: seedData.projectId })
      );
      assert.equal(response.status, 200);
    }
    const limited = await syncRoute(
      post('/api/analytics/sync', seedData.ownerCookie, { projectId: seedData.projectId })
    );
    assert.equal(limited.status, 429);
  });
});

test('AI insight routes are grounded, owner-only and fail closed', async (t) => {
  storage.reset();
  rateLimiter.reset();
  resetLlmProvider();
  const seedData = await seed(9701, 'api-insight');
  await seedPost({
    projectId: seedData.projectId,
    userId: seedData.ownerId,
    platformId: 'bluesky',
    publishedAt: day(1),
    metrics: { likes: 10, comments: 2, reposts: 1 },
    engagement: 13,
  });

  await t.test('signed-out callers are rejected', async () => {
    const response = await insightsPostRoute(
      post('/api/analytics/insights', '', { projectId: seedData.projectId, days: 30 })
    );
    assert.equal(response.status, 401);
  });

  await t.test('an unconfigured provider fails closed with 503', async () => {
    setLlmProvider(new UnconfiguredProvider('unconfigured'));
    const response = await insightsPostRoute(
      post('/api/analytics/insights', seedData.ownerCookie, {
        projectId: seedData.projectId,
        days: 30,
      })
    );
    assert.equal(response.status, 503);
    resetLlmProvider();
  });

  await t.test('insufficient data is recorded without calling the model', async () => {
    const provider = new MockLlmProvider();
    setLlmProvider(provider);
    const response = await insightsPostRoute(
      post('/api/analytics/insights', seedData.ownerCookie, {
        projectId: seedData.projectId,
        days: 30,
      })
    );
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.insight.payload.insufficientData, true);
    assert.equal(data.sample.postsWithMetrics, 1);
    assert.equal(provider.calls.length, 0);
    assert.equal(JSON.stringify(data).includes('ciphertext'), false);
  });

  await t.test('enough data produces validated advisory output', async () => {
    for (let index = 2; index <= 5; index += 1) {
      await seedPost({
        projectId: seedData.projectId,
        userId: seedData.ownerId,
        platformId: 'bluesky',
        publishedAt: day(index),
        metrics: { likes: 5 + index, comments: 1, reposts: 1 },
        engagement: 7 + index,
      });
    }
    const provider = new MockLlmProvider();
    setLlmProvider(provider);
    const response = await insightsPostRoute(
      post('/api/analytics/insights', seedData.ownerCookie, {
        projectId: seedData.projectId,
        days: 30,
      })
    );
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.insight.payload.insufficientData, false);
    assert.equal(data.insight.payload.verificationStatus, 'unverified');
    assert.ok(data.insight.payload.summary.length > 0);
    assert.ok(data.insight.sampleSize >= 3);
    for (const finding of data.insight.payload.findings) {
      assert.ok(finding.sampleSize <= data.insight.sampleSize);
    }
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].task, 'analytics');

    const listed = await insightsGetRoute(
      get(`/api/analytics/insights?projectId=${seedData.projectId}`, seedData.ownerCookie)
    );
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).insights.length, 2);

    const accept = await acceptInsightRoute(
      post(`/api/analytics/insights/${data.insight.id}/accept`, seedData.ownerCookie, {
        status: 'accepted',
      }),
      { params: Promise.resolve({ id: data.insight.id }) }
    );
    assert.equal(accept.status, 200);
    assert.equal((await accept.json()).insight.status, 'accepted');

    const denied = await acceptInsightRoute(
      post(`/api/analytics/insights/${data.insight.id}/accept`, seedData.otherCookie, {
        status: 'accepted',
      }),
      { params: Promise.resolve({ id: data.insight.id }) }
    );
    assert.equal(denied.status, 403);
  });

  await t.test('a model that cites more sample than exists is rejected', async () => {
    const provider = new MockLlmProvider({
      responses: [
        JSON.stringify({
          summary: 'A fabricated conclusion.',
          findings: [
            {
              statement: 'Everything worked.',
              basis: ['engagement'],
              sampleSize: 9999,
              confidence: 'high',
              caveat: '',
            },
          ],
          recommendations: [],
          comparisons: [],
          topFormats: [],
          topTopics: [],
          postingTime: null,
          dataQuality: [],
          insufficientData: false,
        }),
      ],
    });
    setLlmProvider(provider);
    const before = await storage.listAnalyticsInsights({ projectId: seedData.projectId });
    const response = await insightsPostRoute(
      post('/api/analytics/insights', seedData.ownerCookie, {
        projectId: seedData.projectId,
        days: 30,
      })
    );
    assert.equal(response.status, 502);
    const after = await storage.listAnalyticsInsights({ projectId: seedData.projectId });
    assert.equal(after.length, before.length);
    resetLlmProvider();
  });

  await t.test('another project campaign cannot be analyzed', async () => {
    rateLimiter.reset();
    const campaign = await storage.createCampaign({
      projectId: seedData.otherProjectId,
      ownerId: seedData.otherId,
      brief: 'Someone else campaign brief',
      name: 'Boat',
      platforms: ['bluesky'],
      durationDays: 7,
      timezone: 'UTC',
    });
    setLlmProvider(new MockLlmProvider());
    const response = await insightsPostRoute(
      post('/api/analytics/insights', seedData.ownerCookie, {
        projectId: seedData.projectId,
        campaignId: campaign.id,
        days: 30,
      })
    );
    assert.equal(response.status, 403);
    resetLlmProvider();
  });

  await t.test('insight generation is rate-limited', async () => {
    rateLimiter.reset();
    setLlmProvider(new MockLlmProvider());
    for (let index = 0; index < 5; index += 1) {
      const response = await insightsPostRoute(
        post('/api/analytics/insights', seedData.ownerCookie, {
          projectId: seedData.projectId,
          days: 30,
        })
      );
      assert.equal(response.status, 201);
    }
    const limited = await insightsPostRoute(
      post('/api/analytics/insights', seedData.ownerCookie, {
        projectId: seedData.projectId,
        days: 30,
      })
    );
    assert.equal(limited.status, 429);
    resetLlmProvider();
  });
});

test('partial engagement is labelled and the API rejects fabricated AI numbers', async () => {
  storage.reset();
  rateLimiter.reset();
  resetLlmProvider();
  const seedData = await seed(9751, 'api-partial');
  await seedPost({
    projectId: seedData.projectId,
    userId: seedData.ownerId,
    platformId: 'bluesky',
    publishedAt: day(1),
    metrics: { likes: 5 },
    engagement: 5,
  });
  await seedPost({
    projectId: seedData.projectId,
    userId: seedData.ownerId,
    platformId: 'bluesky',
    publishedAt: day(2),
    metrics: { likes: 9 },
    engagement: 9,
  });
  await seedPost({
    projectId: seedData.projectId,
    userId: seedData.ownerId,
    platformId: 'bluesky',
    publishedAt: day(3),
    metrics: { likes: 12 },
    engagement: 12,
  });
  await seedPost({
    projectId: seedData.projectId,
    userId: seedData.ownerId,
    platformId: 'bluesky',
    publishedAt: day(4),
    metrics: { likes: 15 },
    engagement: 15,
  });

  const posts = await postsRoute(
    get(`/api/analytics/posts?projectId=${seedData.projectId}&days=30`, seedData.ownerCookie)
  );
  const postData = await posts.json();
  assert.equal(postData.rows.length, 4);
  for (const row of postData.rows) {
    assert.equal(row.engagementComplete, false);
  }

  const overview = await overviewRoute(
    get(`/api/analytics/overview?projectId=${seedData.projectId}&days=30`, seedData.ownerCookie)
  );
  const overviewData = await overview.json();
  const bluesky = overviewData.platforms.find(
    (platform: { platformId: string }) => platform.platformId === 'bluesky'
  );
  assert.equal(bluesky.engagement.complete, false);
  assert.equal(overviewData.engagement.complete, false);

  const provider = new MockLlmProvider({
    responses: [
      JSON.stringify({
        summary: 'Engagement increased 42% this period.',
        findings: [],
        recommendations: [],
        comparisons: [],
        topFormats: [],
        topTopics: [],
        postingTime: null,
      }),
    ],
  });
  setLlmProvider(provider);
  const response = await insightsPostRoute(
    post('/api/analytics/insights', seedData.ownerCookie, {
      projectId: seedData.projectId,
      days: 30,
    })
  );
  assert.equal(response.status, 502);
  assert.equal((await storage.listAnalyticsInsights({ projectId: seedData.projectId })).length, 0);
  resetLlmProvider();
});
