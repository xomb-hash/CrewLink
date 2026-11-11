import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { prisma } from '../src/lib/prisma';
import { storage } from '../src/lib/storage';
import type { AnalyticsInsightPayload } from '../src/analytics/types';

// Prisma parity for M9. Delegates are mocked; no database connection is opened.
// The file-backed contract is covered in analytics_storage.test.ts.

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
};
(process.env as Record<string, string | undefined>).NODE_ENV = 'development';
(process.env as Record<string, string | undefined>).DATABASE_URL =
  'postgresql://user:pass@localhost:5432/crewlink';

type Mock = Record<string, unknown>;

function patchPrisma(mocks: Mock): () => void {
  const restores: Array<() => void> = [];
  for (const [key, value] of Object.entries(mocks)) {
    const own = Object.getOwnPropertyDescriptor(prisma, key);
    Object.defineProperty(prisma, key, { value, configurable: true });
    restores.push(() => {
      if (own) Object.defineProperty(prisma, key, own);
      else delete (prisma as unknown as Record<string, unknown>)[key];
    });
  }
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

const now = new Date('2026-11-10T10:00:00.000Z');

const accountRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'aacct_one',
  userId: '1',
  projectId: 'prj_one',
  connectionId: 'pcn_one',
  platformId: 'bluesky',
  externalAccountId: 'did:plc:one',
  externalAccountName: 'one.bsky.social',
  metrics: { followers: 120, posts: 30 },
  availableMetrics: ['followers', 'posts'],
  unavailableMetrics: [],
  status: 'active',
  note: null,
  lastSyncedAt: now,
  lastErrorCode: null,
  lastErrorMessage: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const postRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'apost_one',
  userId: '1',
  projectId: 'prj_one',
  publicationId: 'pub_one',
  draftId: 'drf_one',
  campaignId: null,
  platformId: 'bluesky',
  externalId: 'at://one',
  externalUrl: 'https://bsky.app/profile/one/post/1',
  publishedAt: now,
  contentType: 'short',
  topic: 'build',
  metrics: { likes: 5, comments: 1 },
  availableMetrics: ['likes', 'comments'],
  unavailableMetrics: ['reposts'],
  engagement: 6,
  engagementRate: null,
  engagementRateBasis: null,
  status: 'active',
  note: null,
  lastSyncedAt: now,
  lastErrorCode: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const snapshotRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'asnap_one',
  userId: '1',
  projectId: 'prj_one',
  platformId: 'bluesky',
  scope: 'post',
  analyticsPostId: 'apost_one',
  analyticsAccountId: null,
  dedupeKey: 'post:apost_one:hash:1',
  metrics: { likes: 5 },
  capturedAt: now,
  source: 'api',
  createdAt: now,
  ...overrides,
});

const syncRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'async_one',
  userId: '1',
  projectId: 'prj_one',
  platformId: 'bluesky',
  trigger: 'manual',
  status: 'running',
  startedAt: now,
  finishedAt: null,
  postsRequested: 0,
  postsUpdated: 0,
  snapshotsWritten: 0,
  errorCode: null,
  errorMessage: null,
  createdAt: now,
  ...overrides,
});

const insightPayload: AnalyticsInsightPayload = {
  summary: 'Stored insight.',
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
    range: { from: '2026-11-01', to: '2026-11-10', days: 10, timezone: 'UTC' },
    sample: { publishedPosts: 0, postsWithMetrics: 0, platforms: 0, campaigns: 0 },
    totals: { metrics: {}, engagement: null, engagementRate: null },
    platforms: [],
    previousTotals: null,
    unavailable: [],
  },
  generatedAt: now.toISOString(),
};

const insightRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'ains_one',
  userId: '1',
  projectId: 'prj_one',
  campaignId: null,
  scope: 'project',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-10',
  provider: 'mock',
  model: 'mock-deterministic',
  status: 'new',
  sampleSize: 0,
  promptTokens: 0,
  completionTokens: 0,
  payload: insightPayload,
  createdAt: now,
  updatedAt: now,
  acceptedAt: null,
  ...overrides,
});

test('Prisma analytics storage maps the same fields as the file-backed store', async (t) => {
  await t.test('account upsert is keyed by connectionId', async () => {
    let args: Record<string, unknown> | undefined;
    const restore = patchPrisma({
      analyticsAccount: {
        async upsert(input: Record<string, unknown>) {
          args = input;
          return accountRow();
        },
      },
    });
    try {
      const account = await storage.upsertAnalyticsAccount({
        userId: '1',
        projectId: 'prj_one',
        connectionId: 'pcn_one',
        platformId: 'bluesky',
        metrics: { followers: 120, posts: 30 },
        availableMetrics: ['followers', 'posts'],
        unavailableMetrics: [],
        status: 'active',
        lastSyncedAt: now.toISOString(),
      });
      assert.equal(account.id, 'aacct_one');
      assert.equal(account.metrics.followers, 120);
      assert.equal((args?.where as { connectionId: string }).connectionId, 'pcn_one');
      assert.match(String((args?.create as { id: string }).id), /^aacct_/);
    } finally {
      restore();
    }
  });

  await t.test('post upsert is keyed by publicationId and maps dates', async () => {
    let args: Record<string, unknown> | undefined;
    const restore = patchPrisma({
      analyticsPost: {
        async upsert(input: Record<string, unknown>) {
          args = input;
          return postRow();
        },
      },
    });
    try {
      const post = await storage.upsertAnalyticsPost({
        userId: '1',
        projectId: 'prj_one',
        publicationId: 'pub_one',
        draftId: 'drf_one',
        platformId: 'bluesky',
        publishedAt: now.toISOString(),
        contentType: 'short',
        metrics: { likes: 5, comments: 1 },
        availableMetrics: ['likes', 'comments'],
        unavailableMetrics: ['reposts'],
        engagement: 6,
        engagementRate: null,
        status: 'active',
      });
      assert.equal(post.id, 'apost_one');
      assert.equal(post.publishedAt, now.toISOString());
      assert.equal((args?.where as { publicationId: string }).publicationId, 'pub_one');
      assert.equal((args?.create as { status: string }).status, 'active');
    } finally {
      restore();
    }
  });

  await t.test('post listing builds the documented filters and pagination', async () => {
    let args: Record<string, unknown> | undefined;
    const restore = patchPrisma({
      analyticsPost: {
        async findMany(input: Record<string, unknown>) {
          args = input;
          return [postRow()];
        },
      },
    });
    try {
      const rows = await storage.listAnalyticsPosts({
        projectId: 'prj_one',
        platformId: 'bluesky',
        campaignId: 'cmp_one',
        status: 'active',
        from: '2026-11-01',
        to: '2026-11-10',
        limit: 10,
        offset: 5,
      });
      assert.equal(rows.length, 1);
      assert.deepEqual(args?.where, {
        projectId: 'prj_one',
        platformId: 'bluesky',
        campaignId: 'cmp_one',
        status: 'active',
        publishedAt: {
          gte: new Date('2026-11-01T00:00:00.000Z'),
          lte: new Date('2026-11-10T23:59:59.999Z'),
        },
      });
      assert.deepEqual(args?.orderBy, { publishedAt: 'desc' });
      assert.equal(args?.take, 10);
      assert.equal(args?.skip, 5);
    } finally {
      restore();
    }
  });

  await t.test('snapshot dedupe handles a unique violation', async () => {
    let findUniqueCalls = 0;
    const restore = patchPrisma({
      analyticsSnapshot: {
        async create() {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        },
        async findUnique(input: { where: { dedupeKey: string } }) {
          findUniqueCalls += 1;
          assert.equal(input.where.dedupeKey, 'post:apost_one:hash:1');
          return snapshotRow();
        },
      },
    });
    try {
      const result = await storage.createAnalyticsSnapshotIfAbsent({
        id: 'asnap_new',
        userId: '1',
        projectId: 'prj_one',
        platformId: 'bluesky',
        scope: 'post',
        analyticsPostId: 'apost_one',
        dedupeKey: 'post:apost_one:hash:1',
        metrics: { likes: 5 },
        capturedAt: now.toISOString(),
        source: 'api',
        createdAt: now.toISOString(),
      });
      assert.equal(result.created, false);
      assert.equal(result.snapshot.id, 'asnap_one');
      assert.equal(findUniqueCalls, 1);
    } finally {
      restore();
    }
  });

  await t.test('snapshot listing honours descending order', async () => {
    let args: Record<string, unknown> | undefined;
    const restore = patchPrisma({
      analyticsSnapshot: {
        async findMany(input: Record<string, unknown>) {
          args = input;
          return [snapshotRow({ id: 'asnap_latest', metrics: { likes: 9 } })];
        },
      },
    });
    try {
      const rows = await storage.listAnalyticsSnapshots({
        analyticsPostId: 'apost_one',
        order: 'desc',
        limit: 1,
      });
      assert.equal(rows[0].metrics.likes, 9);
      assert.deepEqual(args?.orderBy, { capturedAt: 'desc' });
    } finally {
      restore();
    }
  });

  await t.test('sync create, update and running lookup', async () => {
    let updateArgs: Record<string, unknown> | undefined;
    const restore = patchPrisma({
      analyticsSync: {
        async create(input: Record<string, unknown>) {
          return syncRow({ id: (input.data as { id: string }).id });
        },
        async update(input: Record<string, unknown>) {
          updateArgs = input;
          return syncRow({ status: 'completed', finishedAt: now, postsUpdated: 2 });
        },
        async findFirst(input: Record<string, unknown>) {
          return syncRow({ status: 'running', startedAt: now });
        },
      },
    });
    try {
      const sync = await storage.createAnalyticsSync({
        userId: '1',
        projectId: 'prj_one',
        platformId: 'bluesky',
        trigger: 'manual',
        status: 'running',
        startedAt: now.toISOString(),
      });
      assert.match(sync.id, /^async_/);
      const updated = await storage.updateAnalyticsSync(sync.id, {
        status: 'completed',
        finishedAt: now.toISOString(),
        postsUpdated: 2,
      });
      assert.equal(updated?.status, 'completed');
      assert.equal(updated?.postsUpdated, 2);
      assert.equal(
        (updateArgs?.where as { id: string }).id,
        sync.id
      );
      const running = await storage.getRunningAnalyticsSync(
        'prj_one',
        '2026-11-10T09:00:00.000Z'
      );
      assert.equal(running?.status, 'running');
    } finally {
      restore();
    }
  });

  await t.test('insight create and status update', async () => {
    let statusArgs: Record<string, unknown> | undefined;
    const restore = patchPrisma({
      analyticsInsight: {
        async create(input: Record<string, unknown>) {
          return insightRow({ id: (input.data as { id: string }).id });
        },
        async update(input: Record<string, unknown>) {
          statusArgs = input;
          return insightRow({ status: 'accepted', acceptedAt: now });
        },
      },
    });
    try {
      const insight = await storage.createAnalyticsInsight({
        userId: '1',
        projectId: 'prj_one',
        scope: 'project',
        periodStart: '2026-11-01',
        periodEnd: '2026-11-10',
        provider: 'mock',
        model: 'mock-deterministic',
        sampleSize: 0,
        promptTokens: 0,
        completionTokens: 0,
        payload: insightPayload,
      });
      assert.match(insight.id, /^ains_/);
      const accepted = await storage.updateAnalyticsInsightStatus(insight.id, 'accepted');
      assert.equal(accepted?.status, 'accepted');
      assert.equal(
        (statusArgs?.data as { status: string }).status,
        'accepted'
      );
    } finally {
      restore();
    }
  });
});

test('Prisma sync leases use create/conditional-update and token-safe delete', async (t) => {
  const lockRow = (overrides: Record<string, unknown> = {}) => ({
    key: 'analytics:prj_one:x',
    ownerToken: 'owner-a',
    projectId: 'prj_one',
    platformId: 'x',
    connectionId: 'pcn_one',
    acquiredAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    updatedAt: now,
    ...overrides,
  });

  await t.test('a free lease is acquired by create', async () => {
    let created = false;
    const restore = patchPrisma({
      analyticsSyncLock: {
        async create(input: Record<string, unknown>) {
          created = true;
          return lockRow({ ownerToken: (input.data as { ownerToken: string }).ownerToken });
        },
      },
    });
    try {
      const result = await storage.acquireAnalyticsSyncLock({
        key: 'analytics:prj_one:x',
        ownerToken: 'owner-a',
        projectId: 'prj_one',
        platformId: 'x',
        now,
        leaseMs: 60_000,
      });
      assert.equal(result.acquired, true);
      assert.equal(result.lock?.ownerToken, 'owner-a');
      assert.equal(created, true);
    } finally {
      restore();
    }
  });

  await t.test('a live lease blocks another owner', async () => {
    const restore = patchPrisma({
      analyticsSyncLock: {
        async create() {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        },
        async updateMany() {
          return { count: 0 };
        },
        async findUnique() {
          return lockRow({ ownerToken: 'owner-a' });
        },
      },
    });
    try {
      const result = await storage.acquireAnalyticsSyncLock({
        key: 'analytics:prj_one:x',
        ownerToken: 'owner-b',
        projectId: 'prj_one',
        platformId: 'x',
        now,
        leaseMs: 60_000,
      });
      assert.equal(result.acquired, false);
      assert.equal(result.heldByToken, 'owner-a');
    } finally {
      restore();
    }
  });

  await t.test('an expired lease is taken over by a conditional update', async () => {
    let where: unknown;
    const restore = patchPrisma({
      analyticsSyncLock: {
        async create() {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        },
        async updateMany(input: Record<string, unknown>) {
          where = input.where;
          return { count: 1 };
        },
        async findUnique() {
          return lockRow({ ownerToken: 'owner-b' });
        },
      },
    });
    try {
      const result = await storage.acquireAnalyticsSyncLock({
        key: 'analytics:prj_one:x',
        ownerToken: 'owner-b',
        projectId: 'prj_one',
        platformId: 'x',
        now,
        leaseMs: 60_000,
      });
      assert.equal(result.acquired, true);
      assert.deepEqual(where, {
        key: 'analytics:prj_one:x',
        expiresAt: { lt: now },
      });
    } finally {
      restore();
    }
  });

  await t.test('release only deletes the matching owner token', async () => {
    let where: unknown;
    const restore = patchPrisma({
      analyticsSyncLock: {
        async deleteMany(input: Record<string, unknown>) {
          where = input.where;
          return { count: 0 };
        },
      },
    });
    try {
      const released = await storage.releaseAnalyticsSyncLock(
        'analytics:prj_one:x',
        'stale-owner'
      );
      assert.equal(released, false);
      assert.deepEqual(where, {
        key: 'analytics:prj_one:x',
        ownerToken: 'stale-owner',
      });
    } finally {
      restore();
    }
  });
});

test('Prisma scheduler project listing filters active connections', async () => {
  let where: unknown;
  const restore = patchPrisma({
    project: {
      async findMany(input: Record<string, unknown>) {
        where = input.where;
        return [];
      },
    },
  });
  try {
    const projects = await storage.listProjectsWithAnalyticsConnections();
    assert.deepEqual(projects, []);
    assert.deepEqual(where, {
      platformConnections: { some: { status: 'active' } },
    });
  } finally {
    restore();
  }
});

test.after(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv.NODE_ENV;
  (process.env as Record<string, string | undefined>).DATABASE_URL = originalEnv.DATABASE_URL;
});
