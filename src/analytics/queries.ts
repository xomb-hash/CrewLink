import { config } from '../config/index';
import storage from '../lib/storage';
import type { Project } from '../types/index';
import type {
  AnalyticsAccount,
  AnalyticsInsight,
  AnalyticsPost,
  AnalyticsPostRow,
  AnalyticsRange,
  AnalyticsSnapshot,
  AnalyticsStatusResult,
  AnalyticsSync,
  AudienceResult,
  CampaignPerformance,
  ContentType,
  DataQualityItem,
  MetricAggregate,
  MetricAggregates,
  OverviewResult,
  PlatformPerformance,
  TimingBucket,
  TimingResult,
  TopContentResult,
  TrendDirection,
  TrendPoint,
} from './types';
import { METRIC_KEYS, type MetricKey } from './metricsKeys';
import {
  aggregateEngagement,
  aggregateMetric,
  aggregateMetrics,
  contentTypeLabel,
  engagementRate,
  engagementTotal,
  performanceBand,
  percentChange,
  sumMetric,
  trendDirection,
  trendFromSnapshots,
} from './metrics';
import { analyticsPlatforms, getAnalyticsSupport, platformName } from './platforms';
import {
  HOUR_WINDOWS,
  WEEKDAY_ORDER,
  dateKey,
  zonedDateKey,
  hourInZone,
  hourWindowLabel,
  inAnalyticsRange,
  previousAnalyticsRange,
  weekdayLabel,
} from './range';
import { aiProviderStatus } from '../ai/provider';

export interface AnalyticsQueryOptions {
  projectId: string;
  range: AnalyticsRange;
  campaignId?: string;
}

interface LoadedContext {
  posts: AnalyticsPost[];
  previousPosts: AnalyticsPost[];
  accounts: AnalyticsAccount[];
  snapshots: AnalyticsSnapshot[];
  syncs: AnalyticsSync[];
  campaigns: Array<{ id: string; name: string; createdAt: string; platforms: string[]; status: string }>;
}

async function loadContext(options: AnalyticsQueryOptions): Promise<LoadedContext> {
  const previous = previousAnalyticsRange(options.range);
  const [posts, previousPosts, accounts, snapshots, syncs, campaigns] = await Promise.all([
    storage.listAnalyticsPosts({
      projectId: options.projectId,
      from: options.range.from,
      to: options.range.to,
      ...(options.campaignId ? { campaignId: options.campaignId } : {}),
      limit: 500,
    }),
    storage.listAnalyticsPosts({
      projectId: options.projectId,
      from: previous.from,
      to: previous.to,
      ...(options.campaignId ? { campaignId: options.campaignId } : {}),
      limit: 500,
    }),
    storage.listAnalyticsAccounts(options.projectId),
    storage.listAnalyticsSnapshots({ projectId: options.projectId, limit: 2000 }),
    storage.listAnalyticsSyncs(options.projectId, 20),
    storage.getCampaignsByProject(options.projectId),
  ]);
  return {
    posts,
    previousPosts,
    accounts,
    snapshots,
    syncs,
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name || campaign.brief.slice(0, 60),
      createdAt: campaign.createdAt,
      platforms: campaign.platforms,
      status: campaign.status,
    })),
  };
}

function accountFor(accounts: AnalyticsAccount[], platformId: string): AnalyticsAccount | undefined {
  return accounts.find((account) => account.platformId === platformId);
}

function unavailableFor(
  platformId: string,
  posts: AnalyticsPost[],
  account?: AnalyticsAccount
): MetricKey[] {
  const support = getAnalyticsSupport(platformId);
  if (!support) return [];
  const available = new Set<MetricKey>([
    ...(account?.availableMetrics || []),
    ...posts.flatMap((post) => post.availableMetrics),
  ]);
  const all = new Set<MetricKey>([...support.metrics, ...support.accountMetrics]);
  return Array.from(all).filter((key) => !available.has(key));
}

function lastSyncFor(platformId: string, posts: AnalyticsPost[], account?: AnalyticsAccount): string | undefined {
  const candidates = [
    account?.lastSyncedAt,
    ...posts.filter((post) => post.platformId === platformId).map((post) => post.lastSyncedAt),
  ].filter((value): value is string => Boolean(value));
  return candidates.sort().pop();
}

function weightedEngagementRate(posts: AnalyticsPost[]): {
  value: number | null;
  label: string | null;
} {
  const eligible = posts.filter(
    (post) =>
      typeof post.metrics.impressions === 'number' &&
      post.metrics.impressions > 0 &&
      typeof post.engagement === 'number'
  );
  if (!eligible.length) {
    return { value: null, label: null };
  }
  const impressions = eligible.reduce(
    (sum, post) => sum + Number(post.metrics.impressions || 0),
    0
  );
  const engagement = eligible.reduce((sum, post) => sum + Number(post.engagement || 0), 0);
  if (impressions <= 0) return { value: null, label: null };
  const complete = eligible.every(
    (post) => engagementTotal(post.platformId, post.metrics).complete
  );
  return {
    value: Math.round((engagement / impressions) * 10000) / 100,
    label: `(likes + comments + reposts + quotes + saves) ÷ impressions × 100, Crewlink-calculated across posts with both values${
      complete ? '' : '; some posts returned only part of their engagement actions (partial)'
    }`,
  };
}

function buildPlatformPerformance(input: {
  platformId: string;
  posts: AnalyticsPost[];
  previousPosts: AnalyticsPost[];
  account?: AnalyticsAccount;
  days: number;
}): PlatformPerformance {
  const support = getAnalyticsSupport(input.platformId);
  const name = platformName(input.platformId);
  const platformPosts = input.posts.filter((post) => post.platformId === input.platformId);
  const previous = input.previousPosts.filter(
    (post) => post.platformId === input.platformId
  );
  const metrics = support ? aggregateMetrics(platformPosts, support.metrics) : {};
  const engagement = aggregateEngagement(platformPosts);
  const rate = weightedEngagementRate(platformPosts);
  const previousEngagement = aggregateMetric(previous.map((post) => post.engagement)).value;
  const trend = trendDirection(engagement.value, previousEngagement);
  const average =
    engagement.value !== null && platformPosts.length
      ? Math.round((engagement.value / platformPosts.length) * 100) / 100
      : null;

  return {
    platformId: input.platformId,
    name,
    supportStatus: support?.status || 'unsupported',
    postLevel: support?.postLevel || false,
    accountLevel: support?.accountLevel || false,
    posts: platformPosts.length,
    metrics,
    engagement,
    engagementRate: rate.value,
    engagementRateLabel: rate.label,
    averageEngagementPerPost: average,
    publishingFrequency: platformPosts.length
      ? Math.round((platformPosts.length / Math.max(1, input.days)) * 100) / 100
      : 0,
    trend,
    lastSyncedAt: lastSyncFor(input.platformId, platformPosts, input.account),
    unavailableMetrics: unavailableFor(input.platformId, platformPosts, input.account),
    note: support?.reason || 'This platform has no analytics support.',
  };
}

function emptyMetricAggregates(): MetricAggregates {
  const out: MetricAggregates = {};
  for (const key of METRIC_KEYS) out[key] = aggregateMetric([]);
  return out;
}

function buildTrendSeries(posts: AnalyticsPost[], range: AnalyticsRange): TrendPoint[] {
  const byDate = new Map<string, AnalyticsPost[]>();
  for (const post of posts) {
    const key = dateKey(post.publishedAt);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(post);
  }
  const points: TrendPoint[] = [];
  const start = new Date(`${range.from}T00:00:00.000Z`);
  for (let index = 0; index < range.days; index += 1) {
    const day = new Date(start.getTime() + index * 86_400_000);
    const key = day.toISOString().slice(0, 10);
    const rows = byDate.get(key) || [];
    points.push({
      date: key,
      posts: rows.length,
      engagement: aggregateMetric(rows.map((post) => post.engagement)).value,
      impressions: sumMetric(rows, 'impressions'),
    });
  }
  return points;
}

function dataQualityItems(
  posts: AnalyticsPost[],
  accounts: AnalyticsAccount[],
  syncs: AnalyticsSync[]
): DataQualityItem[] {
  return analyticsPlatforms().map((support) => {
    const account = accountFor(accounts, support.platformId);
    const platformPosts = posts.filter((post) => post.platformId === support.platformId);
    const latestSync = syncs.find((sync) => sync.platformId === support.platformId);
    return {
      platformId: support.platformId,
      name: support.name,
      supportStatus: support.status,
      status: account?.status || (platformPosts.length ? 'partial' : 'not_connected'),
      reason: support.reason,
      availableMetrics: Array.from(
        new Set<MetricKey>([
          ...(account?.availableMetrics || []),
          ...platformPosts.flatMap((post) => post.availableMetrics),
        ])
      ),
      unavailableMetrics: unavailableFor(support.platformId, platformPosts, account),
      lastSyncedAt: lastSyncFor(support.platformId, platformPosts, account),
      errorCode: account?.lastErrorCode || latestSync?.errorCode,
    };
  });
}

export async function getOverview(
  options: AnalyticsQueryOptions
): Promise<OverviewResult> {
  const context = await loadContext(options);
  const posts = context.posts.filter((post) => post.status !== 'pending');
  const totalEngagement = aggregateEngagement(posts);
  const totals = emptyMetricAggregates();
  for (const key of METRIC_KEYS) {
    totals[key] = aggregateMetric(posts.map((post) => post.metrics[key]));
  }
  const rate = weightedEngagementRate(posts);
  const previousEngagement = aggregateMetric(
    context.previousPosts.map((post) => post.engagement)
  ).value;
  const previousImpressions = sumMetric(context.previousPosts, 'impressions');
  const previous = {
    from: previousAnalyticsRange(options.range).from,
    to: previousAnalyticsRange(options.range).to,
    engagement: previousEngagement,
    impressions: previousImpressions,
    posts: context.previousPosts.length,
  };

  const platforms = analyticsPlatforms().map((support) =>
    buildPlatformPerformance({
      platformId: support.platformId,
      posts,
      previousPosts: context.previousPosts,
      account: accountFor(context.accounts, support.platformId),
      days: options.range.days,
    })
  );

  return {
    range: options.range,
    generatedAt: new Date().toISOString(),
    scope: options.campaignId ? 'campaign' : 'project',
    posts: {
      published: posts.length,
      withMetrics: posts.filter((post) => post.availableMetrics.length > 0).length,
      unsupported: posts.filter((post) => post.status === 'unsupported').length,
    },
    totals,
    engagement: totalEngagement,
    engagementRate: rate.value !== null && rate.label ? { value: rate.value, label: rate.label } : null,
    platforms,
    trend: buildTrendSeries(posts, options.range),
    previous,
    changes: {
      engagement: percentChange(totalEngagement.value, previousEngagement),
      impressions: percentChange(sumMetric(posts, 'impressions'), previousImpressions),
      posts: percentChange(posts.length, context.previousPosts.length),
    },
    dataQuality: dataQualityItems(posts, context.accounts, context.syncs),
    lastSyncedAt: posts
      .map((post) => post.lastSyncedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .pop(),
    engagementDefinitions: analyticsPlatforms()
      .filter((support) => support.engagementActions.length > 0)
      .map((support) => ({
        platformId: support.platformId,
        label: engagementRate(support.platformId, {}).label,
      })),
  };
}

function previewFor(text: string | undefined): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function trendKeyFor(post: AnalyticsPost): MetricKey | null {
  const candidates: MetricKey[] = ['likes', 'score', 'comments', 'impressions'];
  return candidates.find((key) => typeof post.metrics[key] === 'number') || null;
}

function buildPostRow(
  post: AnalyticsPost,
  draftText: string | undefined,
  campaignNames: Map<string, string>,
  snapshots: AnalyticsSnapshot[]
): AnalyticsPostRow {
  const postSnapshots = snapshots.filter((snapshot) => snapshot.analyticsPostId === post.id);
  const trendKey = trendKeyFor(post);
  const trend: TrendDirection = trendKey
    ? trendFromSnapshots(postSnapshots, trendKey)
    : 'unknown';
  const engagement = engagementTotal(post.platformId, post.metrics);
  return {
    id: post.id,
    publicationId: post.publicationId,
    draftId: post.draftId,
    campaignId: post.campaignId,
    campaignName: post.campaignId ? campaignNames.get(post.campaignId) : undefined,
    platformId: post.platformId,
    platformName: platformName(post.platformId),
    contentType: post.contentType,
    topic: post.topic,
    externalUrl: post.externalUrl,
    publishedAt: post.publishedAt,
    preview: previewFor(draftText),
    metrics: post.metrics,
    availableMetrics: post.availableMetrics,
    unavailableMetrics: post.unavailableMetrics,
    engagement: post.engagement,
    engagementComplete: engagement.complete,
    engagementRate: post.engagementRate,
    trend,
    status: post.status,
    note: post.note,
  };
}

async function buildPostRows(
  posts: AnalyticsPost[],
  snapshots: AnalyticsSnapshot[]
): Promise<AnalyticsPostRow[]> {
  const campaignNames = new Map<string, string>();
  const rows = await Promise.all(
    posts.map(async (post) => {
      const draft = await storage.getDraftById(post.draftId);
      let campaignName: string | undefined;
      if (post.campaignId) {
        if (!campaignNames.has(post.campaignId)) {
          const campaign = await storage.getCampaignById(post.campaignId);
          if (campaign) {
            campaignNames.set(
              post.campaignId,
              campaign.name || campaign.brief.slice(0, 60)
            );
          }
        }
        campaignName = campaignNames.get(post.campaignId);
      }
      return buildPostRow(
        post,
        draft?.approvedText || draft?.text,
        campaignName ? new Map([[post.campaignId!, campaignName]]) : new Map(),
        snapshots
      );
    })
  );
  return rows;
}

export interface PostFilter {
  platformId?: string;
  campaignId?: string;
  contentType?: string;
  performance?: 'top' | 'weak' | 'typical' | 'unknown';
  sort?: 'publishedAt' | 'engagement' | 'impressions' | 'likes' | 'comments';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export async function getPostRows(
  options: AnalyticsQueryOptions,
  filter: PostFilter = {}
): Promise<{ rows: AnalyticsPostRow[]; total: number }> {
  const context = await loadContext(options);
  let posts = context.posts;
  if (filter.platformId) posts = posts.filter((post) => post.platformId === filter.platformId);
  if (filter.campaignId) posts = posts.filter((post) => post.campaignId === filter.campaignId);
  if (filter.contentType) posts = posts.filter((post) => post.contentType === filter.contentType);

  const rows = await buildPostRows(posts, context.snapshots);
  const engagementValues = rows.map((row) => row.engagement);
  let filtered = rows;
  if (filter.performance && filter.performance !== 'unknown') {
    filtered = rows.filter(
      (row) => performanceBand(row.engagement, engagementValues) === filter.performance
    );
  }
  const sort = filter.sort || 'publishedAt';
  const direction = filter.order === 'asc' ? 1 : -1;
  filtered.sort((left, right) => {
    if (sort === 'publishedAt') return left.publishedAt.localeCompare(right.publishedAt) * direction;
    const leftValue =
      sort === 'engagement'
        ? left.engagement
        : typeof left.metrics[sort] === 'number'
          ? Number(left.metrics[sort])
          : null;
    const rightValue =
      sort === 'engagement'
        ? right.engagement
        : typeof right.metrics[sort] === 'number'
          ? Number(right.metrics[sort])
          : null;
    if (leftValue === null && rightValue === null) return 0;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return (leftValue - rightValue) * direction;
  });
  const offset = Math.max(0, filter.offset ?? 0);
  const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
  return { rows: filtered.slice(offset, offset + limit), total: filtered.length };
}

function groupBy<T, K extends string>(items: T[], key: (item: T) => K | undefined): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const group = key(item);
    if (!group) continue;
    if (!map.has(group)) map.set(group, []);
    map.get(group)!.push(item);
  }
  return map;
}

export async function getTopContent(
  options: AnalyticsQueryOptions
): Promise<TopContentResult> {
  const context = await loadContext(options);
  const rows = await buildPostRows(context.posts, context.snapshots);
  const measured = rows.filter((row) => row.engagement !== null);

  const byEngagement = [...measured]
    .sort((left, right) => Number(right.engagement) - Number(left.engagement))
    .slice(0, 5);
  const byImpressions = [...rows]
    .filter((row) => typeof row.metrics.impressions === 'number')
    .sort(
      (left, right) => Number(right.metrics.impressions) - Number(left.metrics.impressions)
    )
    .slice(0, 5);

  const formatMap = groupBy(rows, (row) => row.contentType);
  const formats = Array.from(formatMap.entries()).map(([contentType, group]) => {
    const engagement = aggregateMetric(group.map((row) => row.engagement)).value;
    return {
      contentType: contentType as ContentType,
      posts: group.length,
      engagement,
      averageEngagement:
        engagement !== null && group.length
          ? Math.round((engagement / group.length) * 100) / 100
          : null,
    };
  });
  formats.sort((left, right) => (right.averageEngagement ?? -1) - (left.averageEngagement ?? -1));

  const topicMap = groupBy(rows, (row) => row.topic);
  const topics = Array.from(topicMap.entries())
    .map(([topic, group]) => {
      const engagement = aggregateMetric(group.map((row) => row.engagement)).value;
      return {
        topic,
        posts: group.length,
        engagement,
        averageEngagement:
          engagement !== null && group.length
            ? Math.round((engagement / group.length) * 100) / 100
            : null,
      };
    })
    .sort((left, right) => (right.averageEngagement ?? -1) - (left.averageEngagement ?? -1))
    .slice(0, 10);

  const movers = rows
    .map((row) => {
      const snapshots = context.snapshots
        .filter((snapshot) => snapshot.analyticsPostId === row.id)
        .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
      if (snapshots.length < 2) return null;
      const first = engagementTotal(row.platformId, snapshots[0].metrics).value;
      const last = engagementTotal(
        row.platformId,
        snapshots[snapshots.length - 1].metrics
      ).value;
      const change = percentChange(last, first);
      if (change === null || Math.abs(change) < 25) return null;
      return {
        post: row,
        changePercent: change,
        direction: change > 0 ? ('up' as const) : ('down' as const),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => Math.abs(right.changePercent) - Math.abs(left.changePercent))
    .slice(0, 5);

  return { byEngagement, byImpressions, formats, topics, movers };
}

export async function getAudience(options: AnalyticsQueryOptions): Promise<AudienceResult> {
  const context = await loadContext(options);
  const platforms = [];
  for (const support of analyticsPlatforms()) {
    const account = accountFor(context.accounts, support.platformId);
    const unavailable = !support.accountLevel;
    const metrics = account?.metrics || {};
    const key = support.accountMetrics.includes('followers')
      ? ('followers' as const)
      : support.accountMetrics.includes('subscribers')
        ? ('subscribers' as const)
        : null;
    const series = account
      ? context.snapshots
          .filter((snapshot) => snapshot.analyticsAccountId === account.id)
          .map((snapshot) => {
            const value = key ? snapshot.metrics[key] : undefined;
            return typeof value === 'number'
              ? { date: snapshot.capturedAt, value }
              : null;
          })
          .filter((point): point is { date: string; value: number } => Boolean(point))
      : [];
    const first = series.length ? series[0].value : null;
    const last = series.length ? series[series.length - 1].value : null;
    const growth = first !== null && last !== null ? last - first : null;
    platforms.push({
      platformId: support.platformId,
      name: support.name,
      status: support.status,
      available: Boolean(key) && !unavailable,
      followers:
        key === 'followers' && typeof metrics.followers === 'number'
          ? metrics.followers
          : null,
      subscribers:
        key === 'subscribers' && typeof metrics.subscribers === 'number'
          ? metrics.subscribers
          : null,
      posts: typeof metrics.posts === 'number' ? metrics.posts : null,
      growth,
      changePercent: growth !== null && first ? Math.round((growth / first) * 1000) / 10 : null,
      series,
      note: unavailable
        ? support.reason
        : account
          ? series.length < 2
            ? 'Only one snapshot exists, so growth cannot be calculated yet.'
            : ''
          : 'No account snapshot has been collected yet. Run a sync.',
    });
  }
  return {
    platforms,
    note: 'Audience numbers are platform-reported. Growth is Crewlink-calculated from consecutive snapshots and is only shown when at least two snapshots exist.',
  };
}

function matchWeekday(label: string): string {
  return WEEKDAY_ORDER.find((weekday) => weekday === label) || label;
}

export async function getTiming(options: AnalyticsQueryOptions): Promise<TimingResult> {
  const context = await loadContext(options);
  const measured = context.posts.filter(
    (post) => typeof post.engagement === 'number' && post.engagement !== null
  );
  const minSample = config.analyticsMinSampleForTiming;
  const distinctDays = new Set(
    measured.map((post) => zonedDateKey(post.publishedAt, options.range.timezone))
  ).size;

  const weekdayMap = new Map<string, AnalyticsPost[]>();
  const hourMap = new Map<string, AnalyticsPost[]>();
  for (const post of measured) {
    const weekday = matchWeekday(weekdayLabel(post.publishedAt, options.range.timezone));
    if (!weekdayMap.has(weekday)) weekdayMap.set(weekday, []);
    weekdayMap.get(weekday)!.push(post);
    const window = hourWindowLabel(hourInZone(post.publishedAt, options.range.timezone));
    if (!hourMap.has(window)) hourMap.set(window, []);
    hourMap.get(window)!.push(post);
  }

  const bucket = (key: string, label: string, posts: AnalyticsPost[]): TimingBucket => ({
    key,
    label,
    posts: posts.length,
    averageEngagement:
      posts.length && aggregateMetric(posts.map((post) => post.engagement)).value !== null
        ? Math.round(
            (Number(aggregateMetric(posts.map((post) => post.engagement)).value) /
              posts.length) *
              100
          ) / 100
        : null,
    averageImpressions:
      posts.length && sumMetric(posts, 'impressions') !== null
        ? Math.round((Number(sumMetric(posts, 'impressions')) / posts.length) * 100) / 100
        : null,
  });

  const byWeekday = WEEKDAY_ORDER.map((weekday) =>
    bucket(
      weekday,
      weekday,
      (weekdayMap.get(weekday) || []).slice().sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
    )
  );
  const byHour = HOUR_WINDOWS.map((start) => {
    const label = hourWindowLabel(start);
    return bucket(label, label, hourMap.get(label) || []);
  });

  const sufficientData = measured.length >= minSample && distinctDays >= 3;
  const bestWeekday = sufficientData
    ? byWeekday
        .filter((row) => row.posts >= 3 && row.averageEngagement !== null)
        .sort(
          (left, right) =>
            Number(right.averageEngagement) - Number(left.averageEngagement)
        )[0]?.key
    : undefined;
  const bestHourWindow = sufficientData
    ? byHour
        .filter((row) => row.posts >= 3 && row.averageEngagement !== null)
        .sort(
          (left, right) =>
            Number(right.averageEngagement) - Number(left.averageEngagement)
        )[0]?.key
    : undefined;

  return {
    sufficientData,
    sampleSize: measured.length,
    minimumSample: minSample,
    timezone: options.range.timezone,
    byWeekday,
    byHour,
    bestWeekday,
    bestHourWindow,
    note: sufficientData
      ? `Based on ${measured.length} measured posts across ${distinctDays} days in ${options.range.timezone}. This is an association, not a significance test.`
      : `Crewlink needs at least ${minSample} measured posts across 3+ days before suggesting a posting time. It has ${measured.length} measured post(s). No conclusion is drawn from a small sample.`,
  };
}

export async function getCampaignPerformance(
  projectId: string,
  range: AnalyticsRange
): Promise<CampaignPerformance[]> {
  const campaigns = await storage.getCampaignsByProject(projectId);
  const rows: CampaignPerformance[] = [];
  let previous: { campaignId: string; name: string; engagement: number | null; posts: number } | null =
    null;

  for (const campaign of campaigns.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const [posts, generated, insights, m8] = await Promise.all([
      storage.getAnalyticsPostsByCampaign(campaign.id),
      storage.getGeneratedPosts(campaign.id),
      storage.listAnalyticsInsights({ projectId, campaignId: campaign.id, limit: 5 }),
      storage.getCampaignAnalytics(campaign.id),
    ]);
    let approved = 0;
    for (const post of generated) {
      const draft = await storage.getDraftById(post.draftId);
      if (draft?.status === 'approved') approved += 1;
    }
    const postRows = await buildPostRows(posts, []);
    const measured = postRows.filter((row) => row.engagement !== null);
    const topPost = measured.length
      ? [...measured].sort((a, b) => Number(b.engagement) - Number(a.engagement))[0]
      : null;
    const weakestPost = measured.length
      ? [...measured].sort((a, b) => Number(a.engagement) - Number(b.engagement))[0]
      : null;
    const engagement = aggregateEngagement(posts);
    const metrics: MetricAggregates = {};
    for (const key of METRIC_KEYS) {
      metrics[key] = aggregateMetric(posts.map((post) => post.metrics[key]));
    }
    const name = campaign.name || campaign.brief.slice(0, 60);
    rows.push({
      campaignId: campaign.id,
      name,
      status: campaign.status,
      platforms: campaign.platforms,
      generated: generated.length,
      approved,
      // M8 records every publication from Crewlink's own history, so it stays
      // authoritative when analytics has not been synced yet.
      published: m8?.metrics.publishedPosts ?? posts.length,
      metrics,
      engagement,
      topPost,
      weakestPost,
      previous,
      changes: {
        engagement: percentChange(engagement.value, previous?.engagement ?? null),
        posts: percentChange(m8?.metrics.publishedPosts ?? posts.length, previous?.posts ?? null),
      },
      insights,
    });
    previous = {
      campaignId: campaign.id,
      name,
      engagement: engagement.value,
      posts: m8?.metrics.publishedPosts ?? posts.length,
    };
  }

  return rows.reverse();
}

export async function getInsights(
  projectId: string,
  campaignId?: string,
  limit = 10
): Promise<AnalyticsInsight[]> {
  return storage.listAnalyticsInsights({ projectId, campaignId, limit });
}

export async function getAnalyticsStatus(projectId: string): Promise<AnalyticsStatusResult> {
  const syncs = await storage.listAnalyticsSyncs(projectId, 20);
  return {
    provider: aiProviderStatus(),
    platforms: analyticsPlatforms(),
    syncs,
  };
}

export async function getProjectForAnalytics(projectId: string): Promise<Project | null> {
  return storage.getProjectById(projectId);
}

export function reportLimitations(range: AnalyticsRange, platformsUsed: string[]): string[] {
  const limitations = [
    'Only metrics returned by official platform APIs are stored; missing metrics are shown as unavailable, not zero.',
    'Engagement totals are Crewlink-calculated sums of the platform actions listed for each platform; they are not directly comparable across platforms.',
    'Engagement rates require a platform-reported impressions denominator and are only calculated for X and LinkedIn posts that returned it.',
    'Reddit, Bluesky, Mastodon, Discord, Telegram and Slack do not expose impressions or reach through their official APIs.',
    'WhatsApp is manual-only and has no analytics path.',
    'Snapshots are collected when an owner runs a sync; no background worker runs automatically.',
    `Selected range: ${range.from} to ${range.to} (${range.days} days, ${range.timezone} for weekday/hour grouping).`,
  ];
  if (!platformsUsed.length) {
    limitations.push('No published posts with analytics were found in this range.');
  }
  return limitations;
}

export function contentTypeName(type: ContentType): string {
  return contentTypeLabel(type);
}

export function metricAggregateLabel(aggregate: MetricAggregate): string {
  if (aggregate.value === null) return 'Unavailable';
  return aggregate.complete ? 'Complete' : 'Partial';
}
