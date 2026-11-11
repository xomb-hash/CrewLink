import type {
  AnalyticsPlatformId,
  EngagementFormula,
  PlatformAnalyticsSupport,
} from './types';
import type { MetricKey } from './metricsKeys';

// Single source of truth for what Crewlink may claim about each platform's
// analytics. Every entry is based on official documentation (see
// docs/M9-ANALYTICS.md) and states what is NOT available as well as what is.
//
// A platform marked `unsupported` has no analytics path at all. `partial` means
// some metrics exist but impressions/reach or account data do not. `needs_*`
// means the documented API exists but this product's current access does not.
export const ANALYTICS_SUPPORT: Record<AnalyticsPlatformId, PlatformAnalyticsSupport> = {
  x: {
    platformId: 'x',
    name: 'X',
    status: 'partial',
    postLevel: true,
    accountLevel: true,
    metrics: ['impressions', 'likes', 'comments', 'reposts', 'quotes', 'saves', 'clicks'],
    accountMetrics: ['followers', 'posts'],
    denominator: 'impressions',
    engagementActions: ['likes', 'comments', 'reposts', 'quotes', 'saves'],
    permissions: ['tweet.read', 'users.read', 'owned posts (user context)'],
    docsUrl: 'https://docs.x.com/x-api/fundamentals/metrics',
    reason:
      'Owned-post metrics are available with user context on the paid API. Impressions are owner-only and there is no unique reach. Private metrics are documented for posts from the last 30 days.',
    limitations: [
      'Only posts owned by the connected account are readable.',
      'No unique reach metric exists; impressions are not unique people.',
      'Private/organic metric history is limited to a 30-day window.',
      'API reads are billed per usage; check the current X pricing before enabling live sync.',
    ],
    liveEnabledByDefault: true,
  },
  linkedin: {
    platformId: 'linkedin',
    name: 'LinkedIn',
    status: 'needs_approval',
    postLevel: true,
    accountLevel: true,
    metrics: ['impressions', 'reach', 'likes', 'comments', 'reposts', 'saves', 'clicks'],
    accountMetrics: ['followers'],
    denominator: 'impressions',
    engagementActions: ['likes', 'comments', 'reposts', 'saves'],
    permissions: ['r_member_postAnalytics', 'r_member_profileAnalytics', 'Community Management API'],
    docsUrl:
      'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics',
    reason:
      'Member post analytics exist through the Community Management API but require LinkedIn approval and the r_member_postAnalytics scope. Crewlink does not request it by default.',
    limitations: [
      'Member analytics are not self-serve; the app must be approved for the Community Management API.',
      'Daily impressions are not supported for a single post and member daily reach is unavailable.',
      'Organization analytics need separate organization scopes and page-admin access and are not implemented.',
      'LinkedIn describes member metrics as best-effort accurate, not billing data.',
    ],
    liveEnabledByDefault: false,
  },
  reddit: {
    platformId: 'reddit',
    name: 'Reddit',
    status: 'partial',
    postLevel: true,
    accountLevel: false,
    metrics: ['score', 'comments'],
    accountMetrics: [],
    denominator: null,
    engagementActions: ['score', 'comments'],
    permissions: ['read'],
    docsUrl: 'https://www.reddit.com/dev/api/',
    reason:
      'The official API returns a submission net score and comment count. It does not expose impressions or reach; view_count is undocumented and usually null, so Crewlink does not use it.',
    limitations: [
      'No impressions, reach or click data.',
      'Score is net upvotes, not a like count, and is fuzzed by Reddit.',
      'No follower count for a user account.',
      'Commercial/high-volume API access requires a separate Reddit agreement.',
    ],
    liveEnabledByDefault: true,
  },
  bluesky: {
    platformId: 'bluesky',
    name: 'Bluesky',
    status: 'supported',
    postLevel: true,
    accountLevel: true,
    metrics: ['likes', 'comments', 'reposts', 'quotes', 'saves'],
    accountMetrics: ['followers', 'posts'],
    denominator: null,
    engagementActions: ['likes', 'comments', 'reposts', 'quotes', 'saves'],
    permissions: ['public AppView reads (no extra scope)'],
    docsUrl: 'https://github.com/bluesky-social/bsky/blob/main/lexicons/app/bsky/feed/defs.json',
    reason:
      'Public post and profile reads expose likes, replies, reposts, quotes, bookmarks, followers and post count. There are no impressions or reach.',
    limitations: [
      'No impressions, reach or click data.',
      'Blocked or deleted posts may no longer resolve.',
      'Rate limits apply per PDS/AppView; sync is manual and bounded.',
    ],
    liveEnabledByDefault: true,
  },
  mastodon: {
    platformId: 'mastodon',
    name: 'Mastodon',
    status: 'supported',
    postLevel: true,
    accountLevel: true,
    metrics: ['likes', 'comments', 'reposts', 'quotes'],
    accountMetrics: ['followers', 'posts'],
    denominator: null,
    engagementActions: ['likes', 'comments', 'reposts', 'quotes'],
    permissions: ['read:statuses', 'read:accounts', 'instance admin support'],
    docsUrl: 'https://docs.joinmastodon.org/entities/Status/',
    reason:
      'Status and account endpoints expose favourites, replies, reblogs, quotes, followers and status count. There are no impressions or reach.',
    limitations: [
      'No impressions, reach or click data.',
      'Feature availability varies by instance and Mastodon version (quotes need 4.5+).',
      'Instances with authorized fetch may reject unauthenticated reads; the sync uses the connection token.',
      'Private statuses need read:statuses, which this connection may not have.',
    ],
    liveEnabledByDefault: true,
  },
  discord: {
    platformId: 'discord',
    name: 'Discord',
    status: 'partial',
    postLevel: true,
    accountLevel: true,
    metrics: ['likes'],
    accountMetrics: ['subscribers'],
    denominator: null,
    engagementActions: ['likes'],
    permissions: ['View Channel', 'Read Message History'],
    docsUrl: 'https://docs.discord.com/developers/resources/message.md',
    reason:
      'The Bot API can read reaction counts on a published message and approximate guild member counts. It does not expose message views, impressions, reach or clicks.',
    limitations: [
      'Reading a published message requires the Read Message History permission.',
      'No views/impressions; Discord does not expose them through the Bot API.',
      'Guild member counts are approximate.',
      'A deleted message cannot be measured.',
    ],
    liveEnabledByDefault: true,
  },
  telegram: {
    platformId: 'telegram',
    name: 'Telegram',
    status: 'partial',
    postLevel: false,
    accountLevel: true,
    metrics: [],
    accountMetrics: ['subscribers'],
    denominator: null,
    engagementActions: [],
    permissions: ['bot administrator in the channel'],
    docsUrl: 'https://core.telegram.org/bots/api',
    reason:
      'The Bot API can return the channel subscriber count. It has no method to read a sent message, and message views are not exposed, so post-level analytics are unavailable.',
    limitations: [
      'No post-level metrics, views or impressions.',
      'Reaction updates are only delivered as updates while the bot is running; no history is exposed.',
      'Subscriber count is a point-in-time number.',
    ],
    liveEnabledByDefault: true,
  },
  slack: {
    platformId: 'slack',
    name: 'Slack',
    status: 'needs_permission',
    postLevel: true,
    accountLevel: false,
    metrics: ['likes', 'comments'],
    accountMetrics: [],
    denominator: null,
    engagementActions: ['likes', 'comments'],
    permissions: ['channels:history', 'groups:history', 'reactions:read'],
    docsUrl: 'https://docs.slack.dev/reference/methods/conversations.history/',
    reason:
      'Message reactions and thread reply counts are readable with the Slack Web API, but the current Crewlink app install has only chat:write, channels:read and groups:read. Adding history/reaction scopes requires a reinstall.',
    limitations: [
      'Requires new scopes and a Slack app reinstall; until then analytics is reported as needs_permission.',
      'No impressions, reach, clicks or delivery data.',
      'Free workspaces limit how far back conversations history is available.',
      'Enterprise analytics files (admin.analytics) are a separate, higher-plan API and are not used.',
    ],
    liveEnabledByDefault: false,
  },
  whatsapp: {
    platformId: 'whatsapp',
    name: 'WhatsApp',
    status: 'unsupported',
    postLevel: false,
    accountLevel: false,
    metrics: [],
    accountMetrics: [],
    denominator: null,
    engagementActions: [],
    permissions: [],
    docsUrl: 'https://faq.whatsapp.com/5913398998672934',
    reason:
      'Crewlink shares WhatsApp messages manually through wa.me. That flow has no API, token or delivery receipt, so no analytics can be retrieved.',
    limitations: [
      'No official analytics path for manual wa.me sharing.',
      'Crewlink never claims sent, delivered or read status for WhatsApp.',
      'WhatsApp Business API is not implemented.',
    ],
    liveEnabledByDefault: false,
  },
};

export function isAnalyticsPlatform(value: unknown): value is AnalyticsPlatformId {
  return typeof value === 'string' && value in ANALYTICS_SUPPORT;
}

export function getAnalyticsSupport(platformId: string): PlatformAnalyticsSupport | null {
  return isAnalyticsPlatform(platformId) ? ANALYTICS_SUPPORT[platformId] : null;
}

export function analyticsPlatforms(): PlatformAnalyticsSupport[] {
  return Object.values(ANALYTICS_SUPPORT);
}

// The engagement definition is intentionally explicit. Crewlink never compares
// an X impression with a Reddit score as if they were the same measurement.
export function engagementFormula(platformId: AnalyticsPlatformId): EngagementFormula {
  const support = ANALYTICS_SUPPORT[platformId];
  const actionLabels: Record<string, string> = {
    likes: 'likes',
    comments: 'comments',
    reposts: 'reposts',
    quotes: 'quotes',
    saves: 'saves',
    score: 'score',
  };
  const actions = support.engagementActions.map((action) => actionLabels[action] || action);
  const sum = actions.length ? actions.join(' + ') : 'no engagement actions';
  return {
    platformId,
    denominator: support.denominator,
    actions: [...support.engagementActions],
    label: support.denominator
      ? `(${sum}) ÷ ${support.denominator} × 100`
      : `${sum} (Crewlink-calculated sum; no valid denominator, so no rate)`,
  };
}

export function platformName(platformId: string): string {
  return getAnalyticsSupport(platformId)?.name || platformId;
}

export function analyticsMetricsFor(platformId: string): MetricKey[] {
  return getAnalyticsSupport(platformId)?.metrics || [];
}
