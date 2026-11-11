import crypto from 'node:crypto';
import type { AnalyticsPlatformId } from '../types';
import {
  AnalyticsClientError,
  type AccountMetricsResult,
  type AnalyticsClient,
  type AnalyticsFetchContext,
  type PostMetricsResult,
} from './types';
import type { Publication } from '../../types/index';

// Deterministic, network-free analytics client. It exists so every sync path,
// aggregation and report can be tested without platform credentials. Values are
// derived from the post/account id, never from the current time.
function pick(seed: string, key: string, min: number, max: number): number {
  const digest = crypto.createHash('sha256').update(`${seed}:${key}`).digest();
  const fraction = digest.readUInt32BE(0) / 0xffffffff;
  return min + Math.floor(fraction * (max - min + 1));
}

function specialFailure(seed: string): void {
  if (seed.includes('mock-rate-limit')) {
    throw new AnalyticsClientError('The platform rate-limited this request.', 'rate_limited', 30);
  }
  if (seed.includes('mock-revoked')) {
    throw new AnalyticsClientError('The connected account was revoked.', 'auth_revoked');
  }
  if (seed.includes('mock-expired')) {
    throw new AnalyticsClientError('The access token expired.', 'token_expired');
  }
  if (seed.includes('mock-permission')) {
    throw new AnalyticsClientError('The app is missing a permission.', 'permission_missing');
  }
  if (seed.includes('mock-not-found')) {
    throw new AnalyticsClientError('The post no longer exists.', 'not_found');
  }
  if (seed.includes('mock-error')) {
    throw new AnalyticsClientError('The platform returned an unexpected error.', 'platform_error');
  }
}

export class MockAnalyticsClient implements AnalyticsClient {
  readonly platform: AnalyticsPlatformId;

  constructor(platform: AnalyticsPlatformId) {
    this.platform = platform;
  }

  async fetchAccount(input: AnalyticsFetchContext): Promise<AccountMetricsResult> {
    const seed = input.connection.externalAccountId || input.connection.id;
    specialFailure(seed);
    if (seed.includes('mock-unsupported')) {
      throw new AnalyticsClientError('This platform has no analytics API.', 'unsupported');
    }
    const metrics = accountMetrics(this.platform, seed);
    return {
      metrics,
      externalAccountId: input.connection.externalAccountId,
      externalAccountName: input.connection.externalAccountName,
    };
  }

  async fetchPost(
    input: AnalyticsFetchContext & { publication: Publication }
  ): Promise<PostMetricsResult> {
    const seed = input.publication.externalId || input.publication.id;
    specialFailure(seed);
    if (seed.includes('mock-empty')) {
      return { metrics: {}, externalUrl: externalUrl(this.platform, input.publication) };
    }
    const metrics = postMetrics(this.platform, seed);
    if (seed.includes('mock-partial')) {
      delete metrics.impression_count;
      delete metrics.impressions;
      delete metrics.num_comments;
      delete metrics.replyCount;
    }
    return { metrics, externalUrl: externalUrl(this.platform, input.publication) };
  }
}

function accountMetrics(
  platformId: AnalyticsPlatformId,
  seed: string
): Record<string, unknown> {
  switch (platformId) {
    case 'x':
      return {
        followers_count: pick(seed, 'followers', 120, 4800),
        tweet_count: pick(seed, 'posts', 40, 900),
      };
    case 'linkedin':
      return { followerCount: pick(seed, 'followers', 200, 9000) };
    case 'bluesky':
      return {
        followersCount: pick(seed, 'followers', 80, 3200),
        postsCount: pick(seed, 'posts', 20, 700),
      };
    case 'mastodon':
      return {
        followers_count: pick(seed, 'followers', 50, 2500),
        statuses_count: pick(seed, 'posts', 15, 500),
      };
    case 'discord':
      return { approximate_member_count: pick(seed, 'members', 40, 8000) };
    case 'telegram':
      return { memberCount: pick(seed, 'members', 30, 12000) };
    default:
      return {};
  }
}

function postMetrics(platformId: AnalyticsPlatformId, seed: string): Record<string, unknown> {
  const impressions = pick(seed, 'impressions', 400, 12000);
  const likes = pick(seed, 'likes', 8, 320);
  const comments = pick(seed, 'comments', 1, 60);
  const reposts = pick(seed, 'reposts', 0, 45);
  const quotes = pick(seed, 'quotes', 0, 12);
  const saves = pick(seed, 'saves', 0, 80);
  const clicks = pick(seed, 'clicks', 0, 150);

  switch (platformId) {
    case 'x':
      return {
        impression_count: impressions,
        like_count: likes,
        reply_count: comments,
        retweet_count: reposts,
        quote_count: quotes,
        bookmark_count: saves,
        url_link_clicks: clicks,
      };
    case 'linkedin':
      return {
        impressions,
        uniqueImpressionsCount: Math.round(impressions * 0.62),
        likeCount: likes,
        commentCount: comments,
        shareCount: reposts,
        postSaveCount: saves,
        clickCount: clicks,
      };
    case 'reddit':
      return { score: likes, num_comments: comments };
    case 'bluesky':
      return {
        likeCount: likes,
        replyCount: comments,
        repostCount: reposts,
        quoteCount: quotes,
        bookmarkCount: saves,
      };
    case 'mastodon':
      return {
        favourites_count: likes,
        replies_count: comments,
        reblogs_count: reposts,
        quotes_count: quotes,
      };
    case 'discord':
      return { reactionCount: likes };
    case 'slack':
      return { reactionCount: likes, replyCount: comments };
    default:
      return {};
  }
}

function externalUrl(platformId: AnalyticsPlatformId, publication: Publication): string | undefined {
  if (publication.externalUrl) return publication.externalUrl;
  const id = publication.externalId;
  if (!id) return undefined;
  switch (platformId) {
    case 'x':
      return `https://x.com/i/web/status/${id}`;
    case 'reddit':
      return `https://www.reddit.com/comments/${id.replace(/^t3_/, '')}`;
    case 'bluesky':
      return id.startsWith('at://')
        ? `https://bsky.app/profile/${id.split('/')[2]}/post/${id.split('/').pop()}`
        : undefined;
    case 'linkedin':
      return id.startsWith('urn:li:')
        ? `https://www.linkedin.com/feed/update/${id}/`
        : undefined;
    case 'discord':
      return publication.targetName
        ? `https://discord.com/channels/${publication.targetName}/${id}`
        : undefined;
    case 'slack':
      return publication.targetName
        ? `https://slack.com/app_redirect?channel=${publication.targetName}&message_ts=${id}`
        : undefined;
    default:
      return undefined;
  }
}
