import {
  ANALYTICS_PLATFORM_IDS,
  type AnalyticsPlatformId,
  type ContentType,
  type MetricAggregate,
  type MetricAggregates,
  type MetricSet,
  type PlatformAnalyticsSupport,
  type TrendDirection,
} from './types';
import { METRIC_KEYS, isMetricKey, type MetricKey } from './metricsKeys';
import { engagementFormula, getAnalyticsSupport } from './platforms';

// Platform-specific response fields. The first field present wins. Only numbers
// are accepted: a missing field stays missing and is never coerced to zero.
const POST_FIELDS: Record<AnalyticsPlatformId, Partial<Record<MetricKey, string[]>>> = {
  x: {
    impressions: ['impression_count', 'impressions', 'impressionCount'],
    likes: ['like_count', 'likes', 'likeCount'],
    comments: ['reply_count', 'replies', 'replyCount'],
    reposts: ['retweet_count', 'retweets', 'reposts', 'repostCount'],
    quotes: ['quote_count', 'quote_tweets', 'quotes', 'quoteCount'],
    saves: ['bookmark_count', 'bookmarks', 'saves', 'bookmarkCount'],
    clicks: ['url_link_clicks', 'url_clicks', 'clicks', 'clickCount'],
    videoViews: ['media_views', 'video_views', 'view_count', 'videoViews'],
  },
  linkedin: {
    impressions: ['impressionCount', 'impressions', 'IMPRESSION'],
    reach: ['uniqueImpressionsCount', 'membersReached', 'MEMBERS_REACHED', 'reach'],
    likes: ['likeCount', 'reactionCount', 'reactions', 'REACTION'],
    comments: ['commentCount', 'comments', 'COMMENT'],
    reposts: ['shareCount', 'reshareCount', 'shares', 'RESHARE'],
    saves: ['postSaveCount', 'saves', 'POST_SAVE'],
    clicks: ['clickCount', 'clicks', 'LINK_CLICKS'],
  },
  reddit: {
    score: ['score'],
    comments: ['num_comments', 'numComments', 'comments'],
  },
  bluesky: {
    likes: ['likeCount', 'likes'],
    comments: ['replyCount', 'replies'],
    reposts: ['repostCount', 'reposts'],
    quotes: ['quoteCount', 'quotes'],
    saves: ['bookmarkCount', 'bookmarks'],
  },
  mastodon: {
    likes: ['favourites_count', 'favouritesCount', 'likes'],
    comments: ['replies_count', 'repliesCount', 'replies'],
    reposts: ['reblogs_count', 'reblogsCount', 'reposts'],
    quotes: ['quotes_count', 'quotesCount', 'quotes'],
  },
  discord: {
    likes: ['reactionCount', 'reactions', 'likes'],
  },
  telegram: {},
  slack: {
    likes: ['reactionCount', 'reactions', 'likes'],
    comments: ['replyCount', 'replies', 'comments'],
  },
  whatsapp: {},
};

const ACCOUNT_FIELDS: Record<AnalyticsPlatformId, Partial<Record<MetricKey, string[]>>> = {
  x: {
    followers: ['followers_count', 'followers', 'followersCount'],
    posts: ['tweet_count', 'posts', 'postsCount'],
  },
  linkedin: {
    followers: ['followerCount', 'followers', 'followersCount'],
  },
  reddit: {},
  bluesky: {
    followers: ['followersCount', 'followers', 'followers_count'],
    posts: ['postsCount', 'posts', 'statuses_count'],
  },
  mastodon: {
    followers: ['followers_count', 'followersCount', 'followers'],
    posts: ['statuses_count', 'statusesCount', 'posts'],
  },
  discord: {
    subscribers: ['approximate_member_count', 'memberCount', 'subscribers'],
  },
  telegram: {
    subscribers: ['memberCount', 'subscribers'],
  },
  slack: {},
  whatsapp: {},
};

export interface NormalizedMetrics {
  metrics: MetricSet;
  available: MetricKey[];
  missing: MetricKey[];
}

function toCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function readField(raw: Record<string, unknown>, names: string[]): number | null {
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(raw, name)) continue;
    const parsed = toCount(raw[name]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function normalize(
  platformId: AnalyticsPlatformId,
  raw: Record<string, unknown>,
  scope: 'post' | 'account'
): NormalizedMetrics {
  const support = getAnalyticsSupport(platformId);
  const allowed = new Set<MetricKey>(
    scope === 'post' ? support?.metrics || [] : support?.accountMetrics || []
  );
  const fields = scope === 'post' ? POST_FIELDS[platformId] : ACCOUNT_FIELDS[platformId];
  const metrics: MetricSet = {};
  const available: MetricKey[] = [];
  const missing: MetricKey[] = [];

  for (const key of METRIC_KEYS) {
    if (!allowed.has(key)) continue;
    const names = fields?.[key];
    const value = names ? readField(raw, names) : null;
    if (value !== null) {
      metrics[key] = value;
      available.push(key);
    } else {
      missing.push(key);
    }
  }
  return { metrics, available, missing };
}

export function normalizePostMetrics(
  platformId: string,
  raw: Record<string, unknown>
): NormalizedMetrics {
  if (!isAnalyticsPlatformId(platformId)) {
    return { metrics: {}, available: [], missing: [] };
  }
  return normalize(platformId, raw, 'post');
}

export function normalizeAccountMetrics(
  platformId: string,
  raw: Record<string, unknown>
): NormalizedMetrics {
  if (!isAnalyticsPlatformId(platformId)) {
    return { metrics: {}, available: [], missing: [] };
  }
  return normalize(platformId, raw, 'account');
}

export function isAnalyticsPlatformId(value: unknown): value is AnalyticsPlatformId {
  return (
    typeof value === 'string' &&
    (ANALYTICS_PLATFORM_IDS as readonly string[]).includes(value)
  );
}

export function supportFor(platformId: string): PlatformAnalyticsSupport | null {
  return isAnalyticsPlatformId(platformId) ? getAnalyticsSupport(platformId) : null;
}

// --- Engagement ------------------------------------------------------------

export interface EngagementTotal {
  value: number | null;
  complete: boolean;
  missing: MetricKey[];
}

// The engagement total is a Crewlink-calculated sum of the actions the platform
// actually returned. Missing actions are reported, never treated as zero.
export function engagementTotal(platformId: string, metrics: MetricSet): EngagementTotal {
  if (!isAnalyticsPlatformId(platformId)) {
    return { value: null, complete: false, missing: [] };
  }
  const formula = engagementFormula(platformId);
  const values: number[] = [];
  const missing: MetricKey[] = [];
  for (const action of formula.actions) {
    const value = metrics[action];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      values.push(value);
    } else {
      missing.push(action);
    }
  }
  return {
    value: values.length ? values.reduce((sum, value) => sum + value, 0) : null,
    complete: missing.length === 0 && values.length > 0,
    missing,
  };
}

export interface EngagementRate {
  value: number | null;
  basis: string | null;
  label: string;
  // Why a rate is unavailable, when it is.
  reason?: string;
}

// A rate is only produced when the platform has a documented denominator and the
// denominator is present and greater than zero. No denominator means raw
// engagement only, never an invented rate.
export function engagementRate(platformId: string, metrics: MetricSet): EngagementRate {
  if (!isAnalyticsPlatformId(platformId)) {
    return { value: null, basis: null, label: 'Not a supported analytics platform.' };
  }
  const formula = engagementFormula(platformId);
  if (!formula.denominator) {
    return {
      value: null,
      basis: null,
      label: formula.label,
      reason: 'This platform has no reliable denominator (impressions/reach), so Crewlink shows raw engagement only.',
    };
  }
  const denominator = metrics[formula.denominator];
  if (typeof denominator !== 'number' || !Number.isFinite(denominator) || denominator <= 0) {
    return {
      value: null,
      basis: null,
      label: formula.label,
      reason: `No ${formula.denominator} value was returned, so an engagement rate cannot be calculated.`,
    };
  }
  const total = engagementTotal(platformId, metrics);
  if (total.value === null) {
    return {
      value: null,
      basis: null,
      label: formula.label,
      reason: 'No engagement actions were returned, so an engagement rate cannot be calculated.',
    };
  }
  return {
    value: Math.round((total.value / denominator) * 10000) / 100,
    basis: formula.label,
    label: formula.label,
  };
}

// --- Aggregation -----------------------------------------------------------

export function aggregateMetric(values: Array<number | null | undefined>): MetricAggregate {
  const numbers = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  return {
    // null, not 0, when nothing was returned.
    value: numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null,
    complete: numbers.length === values.length && values.length > 0,
    withMetric: numbers.length,
    missing: values.length - numbers.length,
  };
}

export function aggregateMetrics(
  posts: Array<{ metrics: MetricSet }>,
  keys: MetricKey[]
): MetricAggregates {
  const out: MetricAggregates = {};
  for (const key of keys) {
    out[key] = aggregateMetric(posts.map((post) => post.metrics[key]));
  }
  return out;
}

export function sumMetric(posts: Array<{ metrics: MetricSet }>, key: MetricKey): number | null {
  return aggregateMetric(posts.map((post) => post.metrics[key])).value;
}

// Aggregated engagement is complete only when every post's action set was
// complete. Summing present values is not enough: a post with likes but no
// comments still has a partial engagement total.
export function aggregateEngagement(
  posts: Array<{ platformId: string; metrics: MetricSet; engagement: number | null }>
): MetricAggregate {
  const aggregate = aggregateMetric(posts.map((post) => post.engagement));
  if (aggregate.value === null) return aggregate;
  const complete = posts.every(
    (post) => engagementTotal(post.platformId, post.metrics).complete
  );
  return { ...aggregate, complete: aggregate.complete && complete };
}

export function averageEngagementPerPost(
  posts: Array<{ engagement: number | null }>
): number | null {
  const values = posts
    .map((post) => post.engagement)
    .filter((value): value is number => typeof value === 'number');
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

// --- Trends and bands ------------------------------------------------------

export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function trendDirection(
  current: number | null,
  previous: number | null
): TrendDirection {
  if (current === null || previous === null) return 'unknown';
  if (previous === 0) return current > 0 ? 'up' : 'flat';
  const change = (current - previous) / previous;
  if (change > 0.05) return 'up';
  if (change < -0.05) return 'down';
  return 'flat';
}

export function trendFromSnapshots(
  snapshots: Array<{ metrics: MetricSet; capturedAt: string }>,
  key: MetricKey
): TrendDirection {
  if (snapshots.length < 2) return 'unknown';
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const first = sorted.find((snapshot) => typeof snapshot.metrics[key] === 'number');
  const last = [...sorted]
    .reverse()
    .find((snapshot) => typeof snapshot.metrics[key] === 'number');
  if (!first || !last || first === last) return 'unknown';
  return trendDirection(last.metrics[key] ?? null, first.metrics[key] ?? null);
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index];
}

export type PerformanceBand = 'top' | 'typical' | 'weak' | 'unknown';

// Bands are relative to the posts actually in the selected range. With fewer
// than four measured posts there is no band, because a "top" claim from two
// posts is not meaningful.
export function performanceBand(
  value: number | null,
  allValues: Array<number | null>
): PerformanceBand {
  const values = allValues.filter(
    (item): item is number => typeof item === 'number' && Number.isFinite(item)
  );
  if (value === null || values.length < 4) return 'unknown';
  const sorted = [...values].sort((a, b) => a - b);
  const p25 = percentile(sorted, 0.25);
  const p75 = percentile(sorted, 0.75);
  if (value >= p75) return 'top';
  if (value <= p25) return 'weak';
  return 'typical';
}

// --- Content type ----------------------------------------------------------

export function deriveContentType(input: {
  platformId: string;
  threadParts?: string[] | null;
  submissionType?: string | null;
  mode?: string | null;
}): ContentType {
  if (input.mode === 'manual') return 'manual';
  if (input.threadParts && input.threadParts.length > 1) return 'thread';
  if (input.platformId === 'reddit' && input.submissionType === 'link') return 'link';
  if (input.platformId === 'reddit') return 'text';
  if (
    input.platformId === 'discord' ||
    input.platformId === 'telegram' ||
    input.platformId === 'slack'
  ) {
    return 'message';
  }
  if (input.platformId === 'bluesky' || input.platformId === 'mastodon') return 'short';
  return 'text';
}

export function contentTypeLabel(type: ContentType): string {
  switch (type) {
    case 'thread':
      return 'Thread';
    case 'link':
      return 'Link post';
    case 'message':
      return 'Chat message';
    case 'short':
      return 'Short post';
    case 'manual':
      return 'Manual share';
    default:
      return 'Text post';
  }
}

// --- Validation of platform payloads ---------------------------------------

export function validMetricPayload(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Accept only known numeric fields and reject negative, non-finite or absurd
// values. An invalid response is treated as unreadable, not as zero.
export function sanitizeStoredMetrics(value: unknown): MetricSet {
  if (!validMetricPayload(value)) return {};
  const out: MetricSet = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isMetricKey(key)) continue;
    const count = toCount(raw);
    if (count !== null && count <= 1_000_000_000_000) out[key] = count;
  }
  return out;
}

export function metricLabel(key: MetricKey): string {
  return key;
}
