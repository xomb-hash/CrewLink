import { config } from '../../config/index';
import { request, retryAfterSeconds, asRecord } from '../../posting/adapters/http';
import {
  linkedInApiHeaders,
  resolveLinkedInApiVersion,
} from '../../posting/linkedin/config';
import type { AnalyticsPlatformId } from '../types';
import type { Publication, StoredPlatformConnection } from '../../types/index';
import {
  AnalyticsClientError,
  type AccountMetricsResult,
  type AnalyticsClient,
  type AnalyticsFetchContext,
  type LiveClientOptions,
  type PostMetricsResult,
} from './types';

// Read-only live clients. They use the same decrypted tokens as publishing, make
// no writes, never refresh tokens (the connection verifier does that before a
// sync) and never include a URL, token or response body in an error message.
//
// Every call is bounded: a short timeout, at most two retries for 429/5xx, and
// the platform's Retry-After is respected up to a cap.

const MAX_RETRY_DELAY_MS = 3000;

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  });
}

function errorForStatus(status: number, platform: string): AnalyticsClientError {
  if (status === 401) {
    return new AnalyticsClientError(
      `${platform} rejected the access token. Reconnect the account.`,
      'token_expired'
    );
  }
  if (status === 403) {
    return new AnalyticsClientError(
      `${platform} denied this read. The app may be missing a permission or API access.`,
      'permission_missing'
    );
  }
  if (status === 404) {
    return new AnalyticsClientError(`${platform} could not find that item.`, 'not_found');
  }
  if (status === 429) {
    return new AnalyticsClientError(
      `${platform} rate-limited the request. Try again later.`,
      'rate_limited'
    );
  }
  return new AnalyticsClientError(`${platform} returned an unexpected error.`, 'platform_error');
}

interface CallOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  form?: Record<string, string>;
  guard?: boolean;
  lookup?: LiveClientOptions['lookup'];
}

async function call(
  options: LiveClientOptions,
  platform: string,
  url: string,
  init: CallOptions = {}
): Promise<{ status: number; data: unknown; headers: Headers }> {
  const maxRetries = options.maxRetries ?? 2;
  const retryCap = options.retryDelayMs ?? MAX_RETRY_DELAY_MS;
  for (let attempt = 0; ; attempt += 1) {
    let response: { status: number; ok: boolean; data: unknown; headers: Headers };
    try {
      response = await request(url, {
        method: init.method || 'GET',
        headers: init.headers,
        body: init.form ? { form: init.form } : undefined,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs ?? 10_000,
        networkErrorCode: 'transport_error',
        ...(init.guard ? { guard: { lookup: init.lookup } } : {}),
      });
    } catch (err) {
      if (err instanceof AnalyticsClientError) throw err;
      // The shared request helper throws AdapterError; its message never contains
      // the URL, but normalize the code for analytics callers.
      throw new AnalyticsClientError(
        `${platform} could not be reached.`,
        'transport_error'
      );
    }

    if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
      const wait = retryAfterSeconds(response.headers) ?? 1;
      await delay(Math.min(wait * 1000, retryCap));
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      const error = errorForStatus(response.status, platform);
      if (response.status === 429) {
        const retry = retryAfterSeconds(response.headers);
        throw new AnalyticsClientError(error.message, error.code, retry);
      }
      throw error;
    }
    return { status: response.status, data: response.data, headers: response.headers };
  }
}

function dataRecord(value: unknown): Record<string, unknown> {
  return asRecord(value);
}

function accessToken(input: AnalyticsFetchContext, platform: string): string {
  const token = input.tokens?.accessToken;
  if (!token) {
    throw new AnalyticsClientError(`${platform} credentials are unavailable.`, 'auth_revoked');
  }
  return token;
}

// --- X ---------------------------------------------------------------------

export class XAnalyticsClient implements AnalyticsClient {
  readonly platform = 'x' as const;
  constructor(private readonly options: LiveClientOptions = {}) {}

  async fetchAccount(input: AnalyticsFetchContext): Promise<AccountMetricsResult> {
    const token = accessToken(input, 'X');
    const response = await call(
      this.options,
      'X',
      `${config.xApiBaseUrl}/2/users/me?user.fields=public_metrics`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    const data = dataRecord(dataRecord(response.data).data);
    const metrics = asRecord(data.public_metrics);
    return {
      metrics: {
        followers_count: metrics.followers_count,
        tweet_count: metrics.tweet_count,
      },
      externalAccountId: typeof data.id === 'string' ? data.id : undefined,
      externalAccountName: typeof data.username === 'string' ? data.username : undefined,
    };
  }

  async fetchPost(
    input: AnalyticsFetchContext & { publication: Publication }
  ): Promise<PostMetricsResult> {
    const token = accessToken(input, 'X');
    const id = input.publication.externalId;
    if (!id) throw new AnalyticsClientError('This post has no X id.', 'not_found');
    const response = await call(
      this.options,
      'X',
      `${config.xApiBaseUrl}/2/tweets/${encodeURIComponent(id)}?tweet.fields=public_metrics,non_public_metrics,organic_metrics`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    const data = dataRecord(dataRecord(response.data).data);
    // Organic/private metrics win when present (owner context); public metrics
    // fill the rest. Missing fields stay missing.
    const metrics = {
      ...asRecord(data.public_metrics),
      ...asRecord(data.non_public_metrics),
      ...asRecord(data.organic_metrics),
    };
    return {
      metrics,
      externalUrl: `https://x.com/i/web/status/${encodeURIComponent(id)}`,
    };
  }
}

// --- LinkedIn --------------------------------------------------------------

const LINKEDIN_MEMBER_SCOPES = ['r_member_postAnalytics'];

export class LinkedInAnalyticsClient implements AnalyticsClient {
  readonly platform = 'linkedin' as const;
  constructor(private readonly options: LiveClientOptions = {}) {}

  private headers(input: AnalyticsFetchContext): Record<string, string> {
    const token = accessToken(input, 'LinkedIn');
    let version: string;
    try {
      version = resolveLinkedInApiVersion();
    } catch {
      throw new AnalyticsClientError(
        'The LinkedIn API version is not supported. Update LINKEDIN_API_VERSION.',
        'platform_error'
      );
    }
    return {
      authorization: `Bearer ${token}`,
      ...linkedInApiHeaders(version),
    };
  }

  private assertApproved(input: AnalyticsFetchContext): void {
    if (!config.linkedinAnalyticsEnabled) {
      throw new AnalyticsClientError(
        'LinkedIn member analytics require Community Management API approval. Crewlink keeps this off until an approved app enables it.',
        'needs_approval'
      );
    }
    const scopes = input.connection.scopes || [];
    if (!LINKEDIN_MEMBER_SCOPES.every((scope) => scopes.includes(scope))) {
      throw new AnalyticsClientError(
        'The LinkedIn connection does not include the r_member_postAnalytics scope. Reconnect after approval.',
        'permission_missing'
      );
    }
  }

  async fetchAccount(input: AnalyticsFetchContext): Promise<AccountMetricsResult> {
    this.assertApproved(input);
    const response = await call(
      this.options,
      'LinkedIn',
      `${config.linkedinApiBaseUrl}/rest/memberFollowersCount?q=me`,
      { headers: this.headers(input) }
    );
    const elements = dataRecord(response.data).elements;
    const first = Array.isArray(elements) ? dataRecord(elements[0]) : {};
    const followers = asRecord(first.followerCounts);
    return {
      metrics: {
        followerCount:
          first.followerCount ??
          first.totalFollowerCount ??
          followers.organicFollowerCount ??
          followers.totalFollowerCount,
      },
      externalAccountId: input.connection.externalAccountId,
      externalAccountName: input.connection.externalAccountName,
    };
  }

  async fetchPost(
    input: AnalyticsFetchContext & { publication: Publication }
  ): Promise<PostMetricsResult> {
    this.assertApproved(input);
    const urn = input.publication.externalId;
    if (!urn) throw new AnalyticsClientError('This post has no LinkedIn id.', 'not_found');
    const headers = this.headers(input);
    const collected: Record<string, unknown> = {};
    const metricMap: Array<[string, string]> = [
      ['IMPRESSION', 'impressions'],
      ['MEMBERS_REACHED', 'uniqueImpressionsCount'],
      ['REACTION', 'likeCount'],
      ['COMMENT', 'commentCount'],
      ['RESHARE', 'shareCount'],
      ['POST_SAVE', 'postSaveCount'],
      ['LINK_CLICKS', 'clickCount'],
    ];
    const entity = urn.includes('ugcPost')
      ? `(ugc:${urn})`
      : `(share:${urn})`;
    const published = new Date(input.publication.createdAt || Date.now());
    const end = new Date();
    const dateRange = `(start:(day:${published.getUTCDate()},month:${
      published.getUTCMonth() + 1
    },year:${published.getUTCFullYear()}),end:(day:${end.getUTCDate()},month:${
      end.getUTCMonth() + 1
    },year:${end.getUTCFullYear()}))`;

    for (const [queryType, field] of metricMap) {
      const params = new URLSearchParams({
        q: 'entity',
        entity,
        queryType,
        aggregation: 'TOTAL',
        dateRange,
      });
      const response = await call(
        this.options,
        'LinkedIn',
        `${config.linkedinApiBaseUrl}/rest/memberCreatorPostAnalytics?${params.toString()}`,
        { headers }
      );
      const elements = dataRecord(response.data).elements;
      const first = Array.isArray(elements) ? dataRecord(elements[0]) : {};
      const value = first.count ?? first.value;
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        collected[field] = value;
      }
    }
    return {
      metrics: collected,
      externalUrl: urn.startsWith('urn:li:')
        ? `https://www.linkedin.com/feed/update/${urn}/`
        : undefined,
    };
  }
}

// --- Reddit ----------------------------------------------------------------

export class RedditAnalyticsClient implements AnalyticsClient {
  readonly platform = 'reddit' as const;
  constructor(private readonly options: LiveClientOptions = {}) {}

  private headers(input: AnalyticsFetchContext): Record<string, string> {
    return {
      authorization: `Bearer ${accessToken(input, 'Reddit')}`,
      'user-agent': config.redditUserAgent,
    };
  }

  async fetchAccount(input: AnalyticsFetchContext): Promise<AccountMetricsResult> {
    const response = await call(
      this.options,
      'Reddit',
      `${config.redditApiBaseUrl}/api/v1/me`,
      { headers: this.headers(input) }
    );
    const data = dataRecord(response.data);
    return {
      metrics: {},
      externalAccountId: typeof data.id === 'string' ? data.id : undefined,
      externalAccountName: typeof data.name === 'string' ? data.name : undefined,
    };
  }

  async fetchPost(
    input: AnalyticsFetchContext & { publication: Publication }
  ): Promise<PostMetricsResult> {
    const id = input.publication.externalId;
    if (!id) throw new AnalyticsClientError('This post has no Reddit id.', 'not_found');
    const fullname = id.startsWith('t3_') ? id : `t3_${id}`;
    const response = await call(
      this.options,
      'Reddit',
      `${config.redditApiBaseUrl}/api/info?id=${encodeURIComponent(fullname)}&raw_json=1`,
      { headers: this.headers(input) }
    );
    const listing = dataRecord(dataRecord(response.data).data);
    const children = listing.children;
    const child = Array.isArray(children) ? dataRecord(children[0]) : {};
    const post = dataRecord(child.data);
    if (!Object.keys(post).length) {
      throw new AnalyticsClientError('The Reddit submission was not found.', 'not_found');
    }
    return {
      metrics: {
        score: post.score,
        num_comments: post.num_comments,
      },
      externalUrl:
        typeof post.permalink === 'string' ? `https://www.reddit.com${post.permalink}` : undefined,
    };
  }
}

// --- Bluesky ---------------------------------------------------------------

export class BlueskyAnalyticsClient implements AnalyticsClient {
  readonly platform = 'bluesky' as const;
  constructor(private readonly options: LiveClientOptions = {}) {}

  private headers(input: AnalyticsFetchContext): Record<string, string> {
    return input.tokens?.accessToken
      ? { authorization: `Bearer ${input.tokens.accessToken}` }
      : {};
  }

  async fetchAccount(input: AnalyticsFetchContext): Promise<AccountMetricsResult> {
    const actor =
      input.connection.externalAccountId ||
      input.connection.externalAccountName ||
      '';
    if (!actor) throw new AnalyticsClientError('No Bluesky account is stored.', 'not_found');
    const response = await call(
      this.options,
      'Bluesky',
      `${config.blueskyServiceUrl}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`,
      { headers: this.headers(input) }
    );
    const data = dataRecord(response.data);
    return {
      metrics: {
        followersCount: data.followersCount,
        postsCount: data.postsCount,
      },
      externalAccountId: typeof data.did === 'string' ? data.did : undefined,
      externalAccountName: typeof data.handle === 'string' ? data.handle : undefined,
    };
  }

  async fetchPost(
    input: AnalyticsFetchContext & { publication: Publication }
  ): Promise<PostMetricsResult> {
    const uri = input.publication.externalId;
    if (!uri || !uri.startsWith('at://')) {
      throw new AnalyticsClientError('This post has no Bluesky record URI.', 'not_found');
    }
    const response = await call(
      this.options,
      'Bluesky',
      `${config.blueskyServiceUrl}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`,
      { headers: this.headers(input) }
    );
    const posts = dataRecord(response.data).posts;
    const post = Array.isArray(posts) ? dataRecord(posts[0]) : {};
    if (!Object.keys(post).length) {
      throw new AnalyticsClientError('The Bluesky post was not found.', 'not_found');
    }
    const parts = uri.split('/');
    const did = parts[2] || '';
    const rkey = parts[parts.length - 1] || '';
    return {
      metrics: {
        likeCount: post.likeCount,
        replyCount: post.replyCount,
        repostCount: post.repostCount,
        quoteCount: post.quoteCount,
        bookmarkCount: post.bookmarkCount,
      },
      externalUrl: `https://bsky.app/profile/${did}/post/${rkey}`,
    };
  }
}

// --- Mastodon --------------------------------------------------------------

export class MastodonAnalyticsClient implements AnalyticsClient {
  readonly platform = 'mastodon' as const;
  constructor(private readonly options: LiveClientOptions = {}) {}

  private base(input: AnalyticsFetchContext): string {
    const instanceUrl = input.connection.instanceUrl;
    if (!instanceUrl) throw new AnalyticsClientError('No Mastodon instance is stored.', 'not_found');
    return instanceUrl.replace(/\/+$/, '');
  }

  private headers(input: AnalyticsFetchContext): Record<string, string> {
    return { authorization: `Bearer ${accessToken(input, 'Mastodon')}` };
  }

  async fetchAccount(input: AnalyticsFetchContext): Promise<AccountMetricsResult> {
    const id = input.connection.externalAccountId;
    if (!id) throw new AnalyticsClientError('No Mastodon account id is stored.', 'not_found');
    const response = await call(
      this.options,
      'Mastodon',
      `${this.base(input)}/api/v1/accounts/${encodeURIComponent(id)}`,
      { headers: this.headers(input), guard: true, lookup: this.options.lookup }
    );
    const data = dataRecord(response.data);
    return {
      metrics: {
        followers_count: data.followers_count,
        statuses_count: data.statuses_count,
      },
      externalAccountId: typeof data.id === 'string' ? data.id : undefined,
      externalAccountName: typeof data.username === 'string' ? data.username : undefined,
    };
  }

  async fetchPost(
    input: AnalyticsFetchContext & { publication: Publication }
  ): Promise<PostMetricsResult> {
    const id = input.publication.externalId;
    if (!id) throw new AnalyticsClientError('This post has no Mastodon id.', 'not_found');
    const response = await call(
      this.options,
      'Mastodon',
      `${this.base(input)}/api/v1/statuses/${encodeURIComponent(id)}`,
      { headers: this.headers(input), guard: true, lookup: this.options.lookup }
    );
    const data = dataRecord(response.data);
    if (!Object.keys(data).length) {
      throw new AnalyticsClientError('The Mastodon status was not found.', 'not_found');
    }
    return {
      metrics: {
        favourites_count: data.favourites_count,
        replies_count: data.replies_count,
        reblogs_count: data.reblogs_count,
        quotes_count: data.quotes_count,
      },
      externalUrl: typeof data.url === 'string' ? data.url : undefined,
    };
  }
}

// --- Discord ---------------------------------------------------------------

export class DiscordAnalyticsClient implements AnalyticsClient {
  readonly platform = 'discord' as const;
  constructor(private readonly options: LiveClientOptions = {}) {}

  private headers(input: AnalyticsFetchContext): Record<string, string> {
    if (!input.botToken) {
      throw new AnalyticsClientError('The Discord bot is not configured.', 'permission_missing');
    }
    return { authorization: `Bot ${input.botToken}` };
  }

  async fetchAccount(input: AnalyticsFetchContext): Promise<AccountMetricsResult> {
    const guildId = input.connection.serverId;
    if (!guildId) throw new AnalyticsClientError('No Discord server is stored.', 'not_found');
    const response = await call(
      this.options,
      'Discord',
      `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}?with_counts=true`,
      { headers: this.headers(input) }
    );
    const data = dataRecord(response.data);
    return {
      metrics: { approximate_member_count: data.approximate_member_count },
      externalAccountId: typeof data.id === 'string' ? data.id : undefined,
      externalAccountName: typeof data.name === 'string' ? data.name : undefined,
    };
  }

  async fetchPost(
    input: AnalyticsFetchContext & { publication: Publication }
  ): Promise<PostMetricsResult> {
    const channelId = input.connection.channelId;
    const messageId = input.publication.externalId;
    if (!channelId) throw new AnalyticsClientError('No Discord channel is stored.', 'not_found');
    if (!messageId) throw new AnalyticsClientError('This post has no Discord id.', 'not_found');
    const response = await call(
      this.options,
      'Discord',
      `https://discord.com/api/v10/channels/${encodeURIComponent(
        channelId
      )}/messages/${encodeURIComponent(messageId)}`,
      { headers: this.headers(input) }
    );
    const data = dataRecord(response.data);
    const reactions = Array.isArray(data.reactions) ? data.reactions : [];
    const reactionCount = reactions.reduce((sum, reaction) => {
      const count = asRecord(reaction).count;
      return sum + (typeof count === 'number' && Number.isFinite(count) ? count : 0);
    }, 0);
    return {
      metrics: { reactionCount },
      externalUrl: input.connection.serverId
        ? `https://discord.com/channels/${input.connection.serverId}/${channelId}/${messageId}`
        : undefined,
    };
  }
}

// --- Telegram --------------------------------------------------------------

export class TelegramAnalyticsClient implements AnalyticsClient {
  readonly platform = 'telegram' as const;
  constructor(private readonly options: LiveClientOptions = {}) {}

  async fetchAccount(input: AnalyticsFetchContext): Promise<AccountMetricsResult> {
    if (!input.botToken) {
      throw new AnalyticsClientError('The Telegram bot is not configured.', 'permission_missing');
    }
    const chatId = input.connection.channelId;
    if (!chatId) throw new AnalyticsClientError('No Telegram channel is stored.', 'not_found');
    // The bot token is part of the URL path. The shared client never echoes a URL
    // in an error message, and this method never returns or logs the token.
    const response = await call(
      this.options,
      'Telegram',
      `https://api.telegram.org/bot${input.botToken}/getChatMemberCount?chat_id=${encodeURIComponent(
        chatId
      )}`,
      {}
    );
    const data = dataRecord(response.data);
    return {
      metrics: { memberCount: data.result },
      externalAccountId: input.connection.serverId || chatId,
      externalAccountName: input.connection.channelName,
    };
  }

  async fetchPost(
    _input: AnalyticsFetchContext & { publication: Publication }
  ): Promise<PostMetricsResult> {
    // The Bot API has no method to read a sent message or its views.
    throw new AnalyticsClientError(
      'Telegram does not expose post-level analytics through the Bot API.',
      'unsupported'
    );
  }
}

// --- Slack -----------------------------------------------------------------

const SLACK_HISTORY_SCOPES = ['channels:history', 'groups:history'];

function slackHasAnalyticsScopes(connection: StoredPlatformConnection): boolean {
  const scopes = connection.scopes || [];
  return (
    scopes.includes('reactions:read') &&
    SLACK_HISTORY_SCOPES.some((scope) => scopes.includes(scope))
  );
}

function slackError(error: string, retryAfter?: number): AnalyticsClientError {
  if (error === 'invalid_auth' || error === 'token_revoked' || error === 'not_authed') {
    return new AnalyticsClientError('Slack rejected the bot token. Reinstall the app.', 'auth_revoked');
  }
  if (error === 'missing_scope') {
    return new AnalyticsClientError(
      'The Slack app is missing a history or reaction scope. Reinstall it with the documented scopes.',
      'permission_missing'
    );
  }
  if (error === 'ratelimited') {
    return new AnalyticsClientError('Slack rate-limited the request.', 'rate_limited', retryAfter);
  }
  if (error === 'channel_not_found' || error === 'not_in_channel' || error === 'is_archived') {
    return new AnalyticsClientError('The Slack channel or message is unavailable.', 'not_found');
  }
  return new AnalyticsClientError('Slack returned an unexpected error.', 'platform_error');
}

export class SlackAnalyticsClient implements AnalyticsClient {
  readonly platform = 'slack' as const;
  constructor(private readonly options: LiveClientOptions = {}) {}

  private headers(input: AnalyticsFetchContext): Record<string, string> {
    return { authorization: `Bearer ${accessToken(input, 'Slack')}` };
  }

  private assertScopes(input: AnalyticsFetchContext): void {
    if (!slackHasAnalyticsScopes(input.connection)) {
      throw new AnalyticsClientError(
        'The Slack install does not have the history and reaction scopes needed for analytics. Reinstall the app with channels:history (or groups:history) and reactions:read.',
        'permission_missing'
      );
    }
  }

  async fetchAccount(_input?: AnalyticsFetchContext): Promise<AccountMetricsResult> {
    // Slack Web API does not expose account-level marketing analytics for this
    // install. Channel member count is not a follower metric.
    return { metrics: {} };
  }

  async fetchPost(
    input: AnalyticsFetchContext & { publication: Publication }
  ): Promise<PostMetricsResult> {
    this.assertScopes(input);
    const channel = input.connection.channelId;
    const ts = input.publication.externalId;
    if (!channel) throw new AnalyticsClientError('No Slack channel is stored.', 'not_found');
    if (!ts) throw new AnalyticsClientError('This post has no Slack timestamp.', 'not_found');
    const headers = this.headers(input);

    const history = await call(this.options, 'Slack', `${config.slackApiBaseUrl}/conversations.history`, {
      method: 'POST',
      headers,
      form: { channel, latest: ts, oldest: ts, inclusive: 'true', limit: '1' },
    });
    const historyData = dataRecord(history.data);
    if (historyData.ok !== true) {
      throw slackError(
        typeof historyData.error === 'string' ? historyData.error : 'unknown_error',
        retryAfterSeconds(history.headers)
      );
    }
    const messages = Array.isArray(historyData.messages) ? historyData.messages : [];
    const message = asRecord(messages[0]);
    if (!Object.keys(message).length) {
      throw new AnalyticsClientError('The Slack message was not found.', 'not_found');
    }
    const reactions = Array.isArray(message.reactions) ? message.reactions : [];
    const reactionCount = reactions.reduce((sum, reaction) => {
      const count = asRecord(reaction).count;
      return sum + (typeof count === 'number' && Number.isFinite(count) ? count : 0);
    }, 0);

    let replyCount =
      typeof message.reply_count === 'number' && Number.isFinite(message.reply_count)
        ? message.reply_count
        : null;
    if (replyCount === null) {
      // Older Slack payloads omit reply_count; page through the thread instead.
      let cursor = '';
      let counted = 0;
      for (let page = 0; page < 5; page += 1) {
        const replies = await call(
          this.options,
          'Slack',
          `${config.slackApiBaseUrl}/conversations.replies`,
          {
            method: 'POST',
            headers,
            form: { channel, ts, limit: '200', ...(cursor ? { cursor } : {}) },
          }
        );
        const data = dataRecord(replies.data);
        if (data.ok !== true) {
          throw slackError(
            typeof data.error === 'string' ? data.error : 'unknown_error',
            retryAfterSeconds(replies.headers)
          );
        }
        const rows = Array.isArray(data.messages) ? data.messages : [];
        // Slack repeats the parent message on every replies page; count only
        // the replies after it.
        const first = rows.length ? asRecord(rows[0]) : {};
        const includesParent = String(first.ts || '') === String(ts);
        counted += Math.max(0, rows.length - (includesParent ? 1 : 0));
        const metadata = asRecord(data.response_metadata);
        cursor = typeof metadata.next_cursor === 'string' ? metadata.next_cursor : '';
        if (!cursor || rows.length === 0) break;
      }
      replyCount = counted;
    }

    return {
      metrics: { reactionCount, replyCount },
      externalUrl: `https://slack.com/app_redirect?channel=${encodeURIComponent(channel)}&message_ts=${encodeURIComponent(ts)}`,
    };
  }
}

// --- Unsupported -----------------------------------------------------------

export class UnsupportedAnalyticsClient implements AnalyticsClient {
  constructor(readonly platform: AnalyticsPlatformId) {}

  async fetchAccount(_input?: AnalyticsFetchContext): Promise<AccountMetricsResult> {
    throw new AnalyticsClientError(
      'This platform has no analytics API available to Crewlink.',
      'unsupported'
    );
  }

  async fetchPost(
    _input?: AnalyticsFetchContext & { publication: Publication }
  ): Promise<PostMetricsResult> {
    throw new AnalyticsClientError(
      'This platform has no post analytics API available to Crewlink.',
      'unsupported'
    );
  }
}
