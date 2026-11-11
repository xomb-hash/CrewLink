import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import {
  BlueskyAnalyticsClient,
  DiscordAnalyticsClient,
  LinkedInAnalyticsClient,
  MastodonAnalyticsClient,
  RedditAnalyticsClient,
  SlackAnalyticsClient,
  TelegramAnalyticsClient,
  XAnalyticsClient,
} from '../src/analytics/clients/live';
import {
  AnalyticsClientError,
  type FetchLike,
} from '../src/analytics/clients/types';
import { MockAnalyticsClient } from '../src/analytics/clients/mock';
import { config } from '../src/config/index';
import type { Publication, StoredPlatformConnection } from '../src/types/index';

function connection(overrides: Partial<StoredPlatformConnection> = {}): StoredPlatformConnection {
  return {
    id: 'pcn_test',
    userId: 'user-1',
    projectId: 'project-1',
    platformId: 'x',
    status: 'active',
    scopes: [],
    accessTokenCiphertext: 'ciphertext',
    credentialProvider: 'local',
    keyRef: 'local:v1',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  } as StoredPlatformConnection;
}

function publication(overrides: Partial<Publication> = {}): Publication {
  return {
    id: 'pub_test',
    userId: 'user-1',
    projectId: 'project-1',
    draftId: 'draft-1',
    platformId: 'x',
    status: 'published',
    mode: 'api',
    contentHash: 'hash',
    externalIds: [],
    externalId: '123',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  } as Publication;
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function fakeFetch(handler: (url: string, init?: RequestInit) => Response): {
  fetchImpl: FetchLike;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
  };
}

test('X analytics client reads owned post metrics and maps failures safely', async (t) => {
  const tokens = { accessToken: 'x-secret-token' };

  await t.test('account and post metrics', async () => {
    const fake = fakeFetch((url) => {
      if (url.includes('/2/users/me')) {
        return json({
          data: { id: 'u1', username: 'rocket', public_metrics: { followers_count: 120, tweet_count: 40 } },
        });
      }
      return json({
        data: {
          public_metrics: { like_count: 5, reply_count: 2, retweet_count: 1, quote_count: 1, bookmark_count: 3 },
          non_public_metrics: { impression_count: 1000, url_link_clicks: 4 },
          organic_metrics: { impression_count: 1100 },
        },
      });
    });
    const client = new XAnalyticsClient({ fetchImpl: fake.fetchImpl, retryDelayMs: 0 });
    const account = await client.fetchAccount({ connection: connection(), tokens });
    assert.equal(account.metrics.followers_count, 120);
    assert.equal(account.externalAccountName, 'rocket');
    const post = await client.fetchPost({
      connection: connection(),
      tokens,
      publication: publication(),
    });
    assert.equal(post.metrics.impression_count, 1100);
    assert.equal(post.metrics.like_count, 5);
    assert.equal(post.metrics.url_link_clicks, 4);
    assert.match(post.externalUrl || '', /status\/123/);
    const header = (fake.calls[0].init?.headers as Record<string, string>).authorization;
    assert.match(header, /Bearer x-secret-token/);
  });

  await t.test('401, 404 and network failures map to typed errors', async () => {
    const unauthorized = new XAnalyticsClient({
      fetchImpl: fakeFetch(() => json({}, 401)).fetchImpl,
      retryDelayMs: 0,
    });
    await assert.rejects(
      () => unauthorized.fetchAccount({ connection: connection(), tokens }),
      (error) => error instanceof AnalyticsClientError && error.code === 'token_expired'
    );
    const missing = new XAnalyticsClient({
      fetchImpl: fakeFetch(() => json({}, 404)).fetchImpl,
      retryDelayMs: 0,
    });
    await assert.rejects(
      () => missing.fetchPost({ connection: connection(), tokens, publication: publication() }),
      (error) => error instanceof AnalyticsClientError && error.code === 'not_found'
    );
    const network = new XAnalyticsClient({
      fetchImpl: async () => {
        throw new Error('network down');
      },
      retryDelayMs: 0,
    });
    await assert.rejects(
      () => network.fetchAccount({ connection: connection(), tokens }),
      (error) =>
        error instanceof AnalyticsClientError &&
        error.code === 'transport_error' &&
        !error.message.includes('x-secret-token')
    );
  });

  await t.test('429 respects Retry-After and retries a bounded number of times', async () => {
    let calls = 0;
    const client = new XAnalyticsClient({
      fetchImpl: async () => {
        calls += 1;
        return json({}, 429, { 'retry-after': '0' });
      },
      retryDelayMs: 0,
      maxRetries: 2,
    });
    await assert.rejects(
      () => client.fetchAccount({ connection: connection(), tokens }),
      (error) =>
        error instanceof AnalyticsClientError &&
        error.code === 'rate_limited' &&
        error.retryAfterSeconds === 1
    );
    assert.equal(calls, 3);
  });
});

test('Reddit, Bluesky and Mastodon clients normalize documented fields', async (t) => {
  await t.test('Reddit submission score and comments', async () => {
    const fake = fakeFetch((url) => {
      if (url.includes('/api/v1/me')) return json({ id: 'r1', name: 'rocket' });
      return json({
        data: { children: [{ data: { score: 42, num_comments: 7, permalink: '/r/test/comments/abc' } }] },
      });
    });
    const client = new RedditAnalyticsClient({ fetchImpl: fake.fetchImpl, retryDelayMs: 0 });
    const context = { connection: connection({ platformId: 'reddit' }), tokens: { accessToken: 'reddit-token' } };
    const account = await client.fetchAccount(context);
    assert.equal(account.externalAccountName, 'rocket');
    const post = await client.fetchPost({ ...context, publication: publication({ platformId: 'reddit' }) });
    assert.equal(post.metrics.score, 42);
    assert.equal(post.metrics.num_comments, 7);
    assert.match(post.externalUrl || '', /reddit\.com\/r\/test/);
    assert.match(fake.calls[1].url, /api\/info\?id=t3_123/);
    const headers = fake.calls[1].init?.headers as Record<string, string>;
    assert.ok(headers['user-agent']);
  });

  await t.test('Reddit empty listings are not found', async () => {
    const client = new RedditAnalyticsClient({
      fetchImpl: fakeFetch(() => json({ data: { children: [] } })).fetchImpl,
      retryDelayMs: 0,
    });
    await assert.rejects(
      () =>
        client.fetchPost({
          connection: connection({ platformId: 'reddit' }),
          tokens: { accessToken: 'reddit-token' },
          publication: publication({ platformId: 'reddit' }),
        }),
      (error) => error instanceof AnalyticsClientError && error.code === 'not_found'
    );
  });

  await t.test('Bluesky profile and post counts', async () => {
    const fake = fakeFetch((url) => {
      if (url.includes('getProfile')) {
        return json({ did: 'did:plc:abc', handle: 'rocket.bsky.social', followersCount: 88, postsCount: 12 });
      }
      return json({
        posts: [
          {
            likeCount: 4,
            replyCount: 2,
            repostCount: 1,
            quoteCount: 1,
            bookmarkCount: 3,
          },
        ],
      });
    });
    const client = new BlueskyAnalyticsClient({ fetchImpl: fake.fetchImpl, retryDelayMs: 0 });
    const context = {
      connection: connection({ platformId: 'bluesky', externalAccountId: 'did:plc:abc' }),
      tokens: { accessToken: 'bsky-token' },
    };
    const account = await client.fetchAccount(context);
    assert.equal(account.metrics.followersCount, 88);
    const post = await client.fetchPost({
      ...context,
      publication: publication({
        platformId: 'bluesky',
        externalId: 'at://did:plc:abc/app.bsky.feed.post/rkey1',
      }),
    });
    assert.equal(post.metrics.likeCount, 4);
    assert.match(post.externalUrl || '', /bsky\.app\/profile\/did:plc:abc\/post\/rkey1/);
  });

  await t.test('Mastodon status and account counts go through the SSRF guard', async () => {
    const lookups: string[] = [];
    const fake = fakeFetch((url) => {
      if (url.includes('/api/v1/statuses/')) {
        return json({
          favourites_count: 9,
          replies_count: 2,
          reblogs_count: 3,
          quotes_count: 1,
          url: 'https://mastodon.test/@rocket/1',
        });
      }
      return json({ id: 'acc-1', username: 'rocket', followers_count: 70, statuses_count: 5 });
    });
    const client = new MastodonAnalyticsClient({
      fetchImpl: fake.fetchImpl,
      retryDelayMs: 0,
      lookup: async (hostname) => {
        lookups.push(hostname);
        return [{ address: '93.184.216.34', family: 4 }];
      },
    });
    const context = {
      connection: connection({
        platformId: 'mastodon',
        instanceUrl: 'https://mastodon.test',
        externalAccountId: 'acc-1',
      }),
      tokens: { accessToken: 'mastodon-token' },
    };
    const account = await client.fetchAccount(context);
    assert.equal(account.metrics.followers_count, 70);
    const post = await client.fetchPost({
      ...context,
      publication: publication({ platformId: 'mastodon', externalId: 'status-1' }),
    });
    assert.equal(post.metrics.favourites_count, 9);
    assert.equal(post.externalUrl, 'https://mastodon.test/@rocket/1');
    assert.ok(lookups.includes('mastodon.test'));
  });
});

test('Discord, Telegram and Slack clients respect their real API limits', async (t) => {
  await t.test('Discord sums reactions and reads member counts', async () => {
    const fake = fakeFetch((url) => {
      if (url.includes('/guilds/')) {
        return json({ id: 'guild-1', name: 'Rocket', approximate_member_count: 250 });
      }
      return json({
        id: 'msg-1',
        reactions: [{ count: 5 }, { count: 7, count_details: { normal: 7, burst: 0 } }],
      });
    });
    const client = new DiscordAnalyticsClient({ fetchImpl: fake.fetchImpl, retryDelayMs: 0 });
    const context = {
      connection: connection({ platformId: 'discord', serverId: 'guild-1', channelId: 'chan-1' }),
      botToken: 'discord-bot-token',
    };
    const account = await client.fetchAccount(context);
    assert.equal(account.metrics.approximate_member_count, 250);
    const post = await client.fetchPost({
      ...context,
      publication: publication({ platformId: 'discord', externalId: 'msg-1' }),
    });
    assert.equal(post.metrics.reactionCount, 12);
    assert.match(String((fake.calls[1].init?.headers as Record<string, string>).authorization), /^Bot /);
  });

  await t.test('Telegram reads subscriber count but has no post metrics', async () => {
    const fake = fakeFetch(() => json({ ok: true, result: 900 }));
    const client = new TelegramAnalyticsClient({ fetchImpl: fake.fetchImpl, retryDelayMs: 0 });
    const context = {
      connection: connection({ platformId: 'telegram', channelId: '@rocket' }),
      botToken: 'telegram-secret-token',
    };
    const account = await client.fetchAccount(context);
    assert.equal(account.metrics.memberCount, 900);
    await assert.rejects(
      () => client.fetchPost({ ...context, publication: publication({ platformId: 'telegram' }) }),
      (error) => error instanceof AnalyticsClientError && error.code === 'unsupported'
    );
    const unauthorized = new TelegramAnalyticsClient({
      fetchImpl: fakeFetch(() => json({ ok: false }, 401)).fetchImpl,
      retryDelayMs: 0,
    });
    await assert.rejects(
      () => unauthorized.fetchAccount(context),
      (error) =>
        error instanceof AnalyticsClientError &&
        error.code === 'token_expired' &&
        !error.message.includes('telegram-secret-token')
    );
  });

  await t.test('Slack requires the history and reaction scopes', async () => {
    let calls = 0;
    const client = new SlackAnalyticsClient({
      fetchImpl: async () => {
        calls += 1;
        return json({ ok: true });
      },
    });
    await assert.rejects(
      () =>
        client.fetchPost({
          connection: connection({ platformId: 'slack', channelId: 'C1' }),
          tokens: { accessToken: 'slack-token' },
          publication: publication({ platformId: 'slack', externalId: '123.456' }),
        }),
      (error) => error instanceof AnalyticsClientError && error.code === 'permission_missing'
    );
    assert.equal(calls, 0);
  });

  await t.test('Slack reads reactions and reply_count', async () => {
    const fake = fakeFetch(() =>
      json({
        ok: true,
        messages: [
          {
            ts: '123.456',
            reactions: [{ count: 4 }, { count: 2 }],
            reply_count: 3,
          },
        ],
      })
    );
    const client = new SlackAnalyticsClient({ fetchImpl: fake.fetchImpl, retryDelayMs: 0 });
    const post = await client.fetchPost({
      connection: connection({
        platformId: 'slack',
        channelId: 'C1',
        scopes: ['channels:history', 'reactions:read'],
      }),
      tokens: { accessToken: 'slack-token' },
      publication: publication({ platformId: 'slack', externalId: '123.456' }),
    });
    assert.equal(post.metrics.reactionCount, 6);
    assert.equal(post.metrics.replyCount, 3);
  });

  await t.test('Slack paginates thread replies when reply_count is absent', async () => {
    let repliesCalls = 0;
    const fake = fakeFetch((url) => {
      if (url.endsWith('/conversations.history')) {
        return json({ ok: true, messages: [{ ts: '123.456', reactions: [{ count: 1 }] }] });
      }
      repliesCalls += 1;
      if (repliesCalls === 1) {
        return json({
          ok: true,
          messages: [{ ts: '123.456' }, { ts: '1' }, { ts: '2' }],
          response_metadata: { next_cursor: 'next-page' },
        });
      }
      return json({ ok: true, messages: [{ ts: '123.456' }, { ts: '3' }, { ts: '4' }, { ts: '5' }] });
    });
    const client = new SlackAnalyticsClient({ fetchImpl: fake.fetchImpl, retryDelayMs: 0 });
    const post = await client.fetchPost({
      connection: connection({
        platformId: 'slack',
        channelId: 'C1',
        scopes: ['groups:history', 'reactions:read'],
      }),
      tokens: { accessToken: 'slack-token' },
      publication: publication({ platformId: 'slack', externalId: '123.456' }),
    });
    assert.equal(repliesCalls, 2);
    assert.equal(post.metrics.replyCount, 5);
  });

  await t.test('Slack HTTP 200 with ok:false is a typed error', async () => {
    const client = new SlackAnalyticsClient({
      fetchImpl: fakeFetch(() => json({ ok: false, error: 'missing_scope' })).fetchImpl,
      retryDelayMs: 0,
    });
    await assert.rejects(
      () =>
        client.fetchPost({
          connection: connection({
            platformId: 'slack',
            channelId: 'C1',
            scopes: ['channels:history', 'reactions:read'],
          }),
          tokens: { accessToken: 'slack-token' },
          publication: publication({ platformId: 'slack', externalId: '123.456' }),
        }),
      (error) => error instanceof AnalyticsClientError && error.code === 'permission_missing'
    );
  });
});

test('LinkedIn analytics are gated behind approval and the member scope', async (t) => {
  const original = config.linkedinAnalyticsEnabled;
  const context = {
    connection: connection({ platformId: 'linkedin', scopes: ['w_member_social'] }),
    tokens: { accessToken: 'linkedin-token' },
  };

  await t.test('disabled by default', async () => {
    config.linkedinAnalyticsEnabled = false;
    const client = new LinkedInAnalyticsClient({ retryDelayMs: 0 });
    await assert.rejects(
      () => client.fetchAccount(context),
      (error) => error instanceof AnalyticsClientError && error.code === 'needs_approval'
    );
  });

  await t.test('enabled but missing the member analytics scope', async () => {
    config.linkedinAnalyticsEnabled = true;
    try {
      const client = new LinkedInAnalyticsClient({ retryDelayMs: 0 });
      await assert.rejects(
        () => client.fetchAccount(context),
        (error) => error instanceof AnalyticsClientError && error.code === 'permission_missing'
      );
    } finally {
      config.linkedinAnalyticsEnabled = original;
    }
  });

  await t.test('approved connection parses documented counters', async () => {
    config.linkedinAnalyticsEnabled = true;
    try {
      const fake = fakeFetch((url) => {
        if (url.includes('memberFollowersCount')) {
          return json({ elements: [{ followerCounts: { organicFollowerCount: 321 } }] });
        }
        const query = new URL(url).searchParams.get('queryType');
        const counts: Record<string, number> = {
          IMPRESSION: 2000,
          MEMBERS_REACHED: 900,
          REACTION: 50,
          COMMENT: 8,
          RESHARE: 4,
          POST_SAVE: 2,
          LINK_CLICKS: 11,
        };
        return json({ elements: [{ count: counts[query || ''] ?? 0 }] });
      });
      const client = new LinkedInAnalyticsClient({ fetchImpl: fake.fetchImpl, retryDelayMs: 0 });
      const account = await client.fetchAccount({
        connection: connection({
          platformId: 'linkedin',
          scopes: ['w_member_social', 'r_member_postAnalytics'],
        }),
        tokens: { accessToken: 'linkedin-token' },
      });
      assert.equal(account.metrics.followerCount, 321);
      const post = await client.fetchPost({
        connection: connection({
          platformId: 'linkedin',
          scopes: ['w_member_social', 'r_member_postAnalytics'],
        }),
        tokens: { accessToken: 'linkedin-token' },
        publication: publication({
          platformId: 'linkedin',
          externalId: 'urn:li:share:123',
        }),
      });
      assert.equal(post.metrics.impressions, 2000);
      assert.equal(post.metrics.likeCount, 50);
      assert.equal(post.metrics.commentCount, 8);
      assert.equal(post.metrics.shareCount, 4);
      const headers = fake.calls[0].init?.headers as Record<string, string>;
      assert.ok(headers['linkedin-version']);
      assert.equal(headers['x-restli-protocol-version'], '2.0.0');
    } finally {
      config.linkedinAnalyticsEnabled = original;
    }
  });
});

test('the deterministic mock client covers success and every failure path', async () => {
  const client = new MockAnalyticsClient('x');
  const context = {
    connection: connection(),
    tokens: { accessToken: 'mock-token' },
  };
  const account = await client.fetchAccount({ ...context, connection: connection({ externalAccountId: 'acct-1' }) });
  assert.equal(typeof account.metrics.followers_count, 'number');
  const post = await client.fetchPost({
    ...context,
    publication: publication({ externalId: 'tweet-1' }),
  });
  assert.equal(typeof post.metrics.like_count, 'number');

  for (const [externalId, code] of [
    ['mock-rate-limit', 'rate_limited'],
    ['mock-revoked', 'auth_revoked'],
    ['mock-expired', 'token_expired'],
    ['mock-permission', 'permission_missing'],
    ['mock-not-found', 'not_found'],
    ['mock-error', 'platform_error'],
  ] as const) {
    await assert.rejects(
      () => client.fetchPost({ ...context, publication: publication({ externalId }) }),
      (error) => error instanceof AnalyticsClientError && error.code === code
    );
  }

  const empty = await client.fetchPost({
    ...context,
    publication: publication({ externalId: 'mock-empty' }),
  });
  assert.deepEqual(empty.metrics, {});
});
