// M9 analytics domain types. Nothing in this module contains plaintext tokens,
// credentials or post bodies: analytics rows store numeric metrics, ids, safe
// URLs and availability metadata only.
//
// Three kinds of number are deliberately kept apart everywhere:
// - platform-reported metrics (returned by an official API),
// - Crewlink-calculated values (engagement totals/rates with a documented
//   formula), and
// - unavailable metrics (null, never zero).
import type { MetricKey } from './metricsKeys';

export const ANALYTICS_PLATFORM_IDS = [
  'linkedin',
  'x',
  'reddit',
  'bluesky',
  'mastodon',
  'discord',
  'telegram',
  'slack',
  'whatsapp',
] as const;

export type AnalyticsPlatformId = (typeof ANALYTICS_PLATFORM_IDS)[number];

export type AnalyticsSupportStatus =
  | 'supported'
  | 'partial'
  // The official API exists but the product needs an access grant.
  | 'needs_approval'
  // The official API exists but this connection was not granted the scope.
  | 'needs_permission'
  | 'unsupported';

export interface PlatformAnalyticsSupport {
  platformId: AnalyticsPlatformId;
  name: string;
  status: AnalyticsSupportStatus;
  postLevel: boolean;
  accountLevel: boolean;
  // Metrics the official API can return for this platform.
  metrics: MetricKey[];
  // Metrics the official API can return at account level.
  accountMetrics: MetricKey[];
  // The denominator used for a Crewlink-calculated engagement rate, if any.
  denominator: MetricKey | null;
  // Actions summed into the Crewlink engagement total.
  engagementActions: MetricKey[];
  // Scopes/permissions required for analytics (documentation, not a request).
  permissions: string[];
  docsUrl: string;
  // One honest sentence for the UI.
  reason: string;
  limitations: string[];
  // Live fetching is disabled by default for platforms awaiting approval.
  liveEnabledByDefault: boolean;
}

export interface EngagementFormula {
  platformId: AnalyticsPlatformId;
  denominator: MetricKey | null;
  actions: MetricKey[];
  // Human-readable formula for tooltips and reports.
  label: string;
}

export type MetricSet = Partial<Record<MetricKey, number>>;

export type AnalyticsPostStatus = 'active' | 'partial' | 'unsupported' | 'error' | 'pending';
export type AnalyticsAccountStatus = 'active' | 'partial' | 'unsupported' | 'error' | 'pending';

export type AnalyticsSyncStatus = 'running' | 'completed' | 'partial' | 'failed' | 'skipped';
export type AnalyticsSyncTrigger = 'manual' | 'scheduled' | 'publish';

export type AnalyticsInsightStatus = 'new' | 'accepted' | 'dismissed';
export type AnalyticsInsightScope = 'project' | 'campaign';

export type ContentType = 'text' | 'thread' | 'link' | 'message' | 'short' | 'manual';

export type TrendDirection = 'up' | 'down' | 'flat' | 'unknown';

// --- Stored rows -----------------------------------------------------------

export interface AnalyticsAccount {
  id: string;
  userId: string;
  projectId: string;
  connectionId: string;
  platformId: string;
  externalAccountId?: string;
  externalAccountName?: string;
  // Latest normalized account metrics (followers/subscribers/posts).
  metrics: MetricSet;
  availableMetrics: MetricKey[];
  unavailableMetrics: MetricKey[];
  status: AnalyticsAccountStatus;
  note?: string;
  lastSyncedAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnalyticsPost {
  id: string;
  userId: string;
  projectId: string;
  // One analytics row per publication.
  publicationId: string;
  draftId: string;
  campaignId?: string;
  platformId: string;
  externalId?: string;
  externalUrl?: string;
  publishedAt: string;
  contentType: ContentType;
  topic?: string;
  // Latest platform-reported metrics only.
  metrics: MetricSet;
  availableMetrics: MetricKey[];
  unavailableMetrics: MetricKey[];
  // Crewlink-calculated from `metrics` using the documented platform formula.
  engagement: number | null;
  engagementRate: number | null;
  engagementRateBasis?: string;
  status: AnalyticsPostStatus;
  note?: string;
  lastSyncedAt?: string;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export type AnalyticsSnapshotScope = 'post' | 'account';

export interface AnalyticsSnapshot {
  id: string;
  userId: string;
  projectId: string;
  platformId: string;
  scope: AnalyticsSnapshotScope;
  analyticsPostId?: string;
  analyticsAccountId?: string;
  // Unique per entity/content bucket, so a repeated sync cannot duplicate a
  // snapshot with the same metrics in the same window.
  dedupeKey: string;
  metrics: MetricSet;
  capturedAt: string;
  source: 'api';
  createdAt: string;
}

export interface AnalyticsSync {
  id: string;
  userId: string;
  projectId: string;
  platformId: string;
  trigger: AnalyticsSyncTrigger;
  status: AnalyticsSyncStatus;
  startedAt: string;
  finishedAt?: string;
  postsRequested: number;
  postsUpdated: number;
  snapshotsWritten: number;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
}

// --- AI analyst ------------------------------------------------------------

export type InsightConfidence = 'low' | 'medium' | 'high';
export type InsightPriority = 'low' | 'medium' | 'high';

// A deterministic numeric fact calculated by the backend. The AI may reference
// it by id and embed a {{fact:id}} placeholder; it may not author a number.
export type FactUnit = 'count' | 'percent' | 'rate' | 'text';
export type FactCompleteness = 'complete' | 'partial' | 'unavailable';

export interface AnalyticsFact {
  id: string;
  label: string;
  metric?: MetricKey;
  platformId?: string;
  postId?: string;
  campaignId?: string;
  // Only numeric or text facts with a real value are placed in the catalog.
  value: number | null;
  text?: string;
  formatted: string | null;
  unit: FactUnit;
  completeness: FactCompleteness;
  definition: string;
  sampleSize?: number;
}

export interface AnalyticsFinding {
  statement: string;
  // Rendered by the backend from validated {{fact:...}} placeholders.
  renderedStatement?: string;
  factIds: string[];
  // Derived by the backend from the referenced facts, never model-authored.
  // Human-readable metric names derived from the facts (engagement, impressions, …).
  basis: string[];
  sampleSize: number;
  confidence: InsightConfidence;
  caveat: string;
  renderedCaveat?: string;
  facts: AnalyticsFact[];
}

export interface AnalyticsRecommendation {
  action: string;
  renderedAction?: string;
  rationale: string;
  renderedRationale?: string;
  evidence?: string;
  renderedEvidence?: string;
  factIds: string[];
  platforms: string[];
  priority: InsightPriority;
  facts: AnalyticsFact[];
}

export interface AnalyticsComparison {
  metric: string;
  direction: 'up' | 'down' | 'flat' | 'unknown';
  note: string;
  renderedNote?: string;
  // Crewlink-calculated from the stored periods; never model-authored.
  factId: string;
  facts: AnalyticsFact[];
  current: number | null;
  previous: number | null;
  changePercent: number | null;
}

// A bounded audit digest of the facts given to the model. It contains no post
// bodies or credentials and is stored with the insight.
export interface AnalystFactsDigest {
  range: { from: string; to: string; days: number; timezone: string };
  sample: {
    publishedPosts: number;
    postsWithMetrics: number;
    platforms: number;
    campaigns: number;
  };
  totals: {
    metrics: MetricSet;
    engagement: number | null;
    engagementRate: number | null;
  };
  platforms: Array<{
    platformId: string;
    posts: number;
    metrics: MetricSet;
    unavailableMetrics: MetricKey[];
  }>;
  previousTotals: { engagement: number | null; impressions: number | null } | null;
  unavailable: string[];
}

export interface AnalyticsInsightPayload {
  summary: string;
  // Backend-rendered from validated fact placeholders.
  renderedSummary?: string;
  findings: AnalyticsFinding[];
  recommendations: AnalyticsRecommendation[];
  comparisons: AnalyticsComparison[];
  topFormats: string[];
  topTopics: string[];
  postingTime: {
    recommendation: string;
    renderedRecommendation?: string;
    factIds: string[];
    facts: AnalyticsFact[];
    sampleSize: number;
  } | null;
  dataQuality: string[];
  limitations: string[];
  insufficientData: boolean;
  // AI output is advisory and always carries this label.
  verificationStatus: 'unverified';
  facts: AnalystFactsDigest;
  // Every fact the AI cited, with backend values. The frontend renders these,
  // not digits parsed from the AI text.
  factCatalog: AnalyticsFact[];
  generatedAt: string;
}

export interface AnalyticsInsight {
  id: string;
  userId: string;
  projectId: string;
  campaignId?: string;
  scope: AnalyticsInsightScope;
  periodStart: string;
  periodEnd: string;
  provider: string;
  model: string;
  status: AnalyticsInsightStatus;
  sampleSize: number;
  promptTokens: number;
  completionTokens: number;
  payload: AnalyticsInsightPayload;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
}

// --- Dashboard views -------------------------------------------------------

export interface AnalyticsRange {
  from: string;
  to: string;
  days: number;
  timezone: string;
  label: string;
}

export interface MetricAggregate {
  // null means no platform returned this metric; it is never presented as zero.
  value: number | null;
  // false when some posts in the set have no value for this metric.
  complete: boolean;
  withMetric: number;
  missing: number;
}

export type MetricAggregates = Partial<Record<MetricKey, MetricAggregate>>;

export interface DataQualityItem {
  platformId: string;
  name: string;
  supportStatus: AnalyticsSupportStatus;
  status: AnalyticsAccountStatus | 'not_connected';
  reason: string;
  availableMetrics: MetricKey[];
  unavailableMetrics: MetricKey[];
  lastSyncedAt?: string;
  errorCode?: string;
}

export interface PlatformPerformance {
  platformId: string;
  name: string;
  supportStatus: AnalyticsSupportStatus;
  postLevel: boolean;
  accountLevel: boolean;
  posts: number;
  metrics: MetricAggregates;
  engagement: MetricAggregate;
  engagementRate: number | null;
  engagementRateLabel: string | null;
  averageEngagementPerPost: number | null;
  publishingFrequency: number;
  trend: TrendDirection;
  lastSyncedAt?: string;
  unavailableMetrics: MetricKey[];
  note: string;
}

export interface TrendPoint {
  date: string;
  posts: number;
  engagement: number | null;
  impressions: number | null;
}

export interface OverviewResult {
  range: AnalyticsRange;
  generatedAt: string;
  scope: 'project' | 'campaign';
  posts: { published: number; withMetrics: number; unsupported: number };
  totals: MetricAggregates;
  engagement: MetricAggregate;
  engagementRate: { value: number; label: string } | null;
  platforms: PlatformPerformance[];
  trend: TrendPoint[];
  previous: {
    from: string;
    to: string;
    engagement: number | null;
    impressions: number | null;
    posts: number;
  } | null;
  changes: {
    engagement: number | null;
    impressions: number | null;
    posts: number | null;
  };
  dataQuality: DataQualityItem[];
  lastSyncedAt?: string;
  engagementDefinitions: Array<{ platformId: string; label: string }>;
}

export interface AnalyticsPostRow {
  id: string;
  publicationId: string;
  draftId: string;
  campaignId?: string;
  campaignName?: string;
  platformId: string;
  platformName: string;
  contentType: ContentType;
  topic?: string;
  externalUrl?: string;
  publishedAt: string;
  // First 160 characters of the approved/published draft. Owner-only.
  preview: string;
  metrics: MetricSet;
  availableMetrics: MetricKey[];
  unavailableMetrics: MetricKey[];
  engagement: number | null;
  engagementComplete: boolean;
  engagementRate: number | null;
  trend: TrendDirection;
  status: AnalyticsPostStatus;
  note?: string;
}

export interface TopContentResult {
  byEngagement: AnalyticsPostRow[];
  byImpressions: AnalyticsPostRow[];
  formats: Array<{
    contentType: ContentType;
    posts: number;
    engagement: number | null;
    averageEngagement: number | null;
  }>;
  topics: Array<{
    topic: string;
    posts: number;
    engagement: number | null;
    averageEngagement: number | null;
  }>;
  // Posts whose latest snapshot differs sharply from their first one.
  movers: Array<{ post: AnalyticsPostRow; changePercent: number; direction: TrendDirection }>;
}

export interface AudiencePlatform {
  platformId: string;
  name: string;
  status: AnalyticsSupportStatus;
  available: boolean;
  followers: number | null;
  subscribers: number | null;
  posts: number | null;
  growth: number | null;
  changePercent: number | null;
  series: Array<{ date: string; value: number }>;
  note: string;
}

export interface AudienceResult {
  platforms: AudiencePlatform[];
  note: string;
}

export interface TimingBucket {
  key: string;
  label: string;
  posts: number;
  averageEngagement: number | null;
  averageImpressions: number | null;
}

export interface TimingResult {
  sufficientData: boolean;
  sampleSize: number;
  minimumSample: number;
  timezone: string;
  byWeekday: TimingBucket[];
  byHour: TimingBucket[];
  bestWeekday?: string;
  bestHourWindow?: string;
  note: string;
}

export interface CampaignPerformance {
  campaignId: string;
  name: string;
  status: string;
  platforms: string[];
  generated: number;
  approved: number;
  published: number;
  metrics: MetricAggregates;
  engagement: MetricAggregate;
  topPost: AnalyticsPostRow | null;
  weakestPost: AnalyticsPostRow | null;
  previous: {
    campaignId: string;
    name: string;
    engagement: number | null;
    posts: number;
  } | null;
  changes: { engagement: number | null; posts: number | null };
  insights: AnalyticsInsight[];
}

export interface AnalyticsReportData {
  project: { id: string; title: string; repoFullName: string };
  range: AnalyticsRange;
  generatedAt: string;
  overview: OverviewResult;
  posts: AnalyticsPostRow[];
  top: TopContentResult;
  audience: AudienceResult;
  timing: TimingResult;
  campaigns: CampaignPerformance[];
  insights: AnalyticsInsight[];
  limitations: string[];
}

export interface AnalystFacts {
  range: AnalyticsRange;
  scope: AnalyticsInsightScope;
  campaign: { id: string; name: string; objective: string } | null;
  sample: {
    publishedPosts: number;
    postsWithMetrics: number;
    platforms: number;
    campaigns: number;
    days: number;
  };
  totals: {
    metrics: MetricSet;
    engagement: number | null;
    engagementRate: number | null;
    engagementRateLabel: string | null;
    posts: number;
  };
  previous: {
    from: string;
    to: string;
    engagement: number | null;
    impressions: number | null;
    posts: number;
  } | null;
  platforms: Array<{
    platformId: string;
    name: string;
    posts: number;
    metrics: MetricSet;
    unavailableMetrics: MetricKey[];
    engagement: number | null;
    engagementRate: number | null;
    trend: TrendDirection;
    note: string;
  }>;
  posts: Array<{
    id: string;
    platformId: string;
    publishedAt: string;
    contentType: ContentType;
    topic?: string;
    metrics: MetricSet;
    engagement: number | null;
    band: 'top' | 'typical' | 'weak' | 'unknown';
  }>;
  formats: TopContentResult['formats'];
  topics: TopContentResult['topics'];
  timing: {
    sufficientData: boolean;
    sampleSize: number;
    byWeekday: TimingBucket[];
    byHour: TimingBucket[];
    bestWeekday?: string;
    bestHourWindow?: string;
  };
  campaigns: Array<{
    id: string;
    name: string;
    posts: number;
    engagement: number | null;
    impressions: number | null;
  }>;
  dataQuality: string[];
  calculations: string[];
  factCatalog: AnalyticsFact[];
}

export interface AnalyticsStatusResult {
  provider: { provider: string; model: string; configured: boolean };
  platforms: PlatformAnalyticsSupport[];
  syncs: AnalyticsSync[];
}

// A short-lived lease for one project/platform sync. It is database state, not
// an in-process mutex, so two application instances cannot sync the same
// platform at the same time.
export interface AnalyticsSyncLock {
  key: string;
  ownerToken: string;
  projectId: string;
  platformId: string;
  connectionId?: string;
  acquiredAt: string;
  expiresAt: string;
  updatedAt: string;
}
