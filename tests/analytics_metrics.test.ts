import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import {
  aggregateMetric,
  deriveContentType,
  engagementRate,
  engagementTotal,
  normalizeAccountMetrics,
  normalizePostMetrics,
  performanceBand,
  percentChange,
  sanitizeStoredMetrics,
  trendDirection,
  trendFromSnapshots,
} from '../src/analytics/metrics';
import {
  ANALYTICS_SUPPORT,
  analyticsPlatforms,
  engagementFormula,
  getAnalyticsSupport,
  isAnalyticsPlatform,
} from '../src/analytics/platforms';
import {
  previousAnalyticsRange,
  resolveAnalyticsRange,
  weekdayLabel,
  hourInZone,
  hourWindowLabel,
  inAnalyticsRange,
  zonedDateKey,
} from '../src/analytics/range';
import { AnalyticsRangeError } from '../src/analytics/range';

test('the support registry states what each official API actually exposes', () => {
  assert.equal(isAnalyticsPlatform('x'), true);
  assert.equal(isAnalyticsPlatform('myspace'), false);
  assert.equal(getAnalyticsSupport('myspace'), null);

  assert.equal(ANALYTICS_SUPPORT.whatsapp.status, 'unsupported');
  assert.equal(ANALYTICS_SUPPORT.whatsapp.postLevel, false);
  assert.equal(ANALYTICS_SUPPORT.telegram.postLevel, false);
  assert.equal(ANALYTICS_SUPPORT.telegram.accountLevel, true);
  assert.equal(ANALYTICS_SUPPORT.slack.status, 'needs_permission');
  assert.equal(ANALYTICS_SUPPORT.linkedin.status, 'needs_approval');
  assert.equal(ANALYTICS_SUPPORT.reddit.accountLevel, false);
  assert.deepEqual(ANALYTICS_SUPPORT.reddit.metrics, ['score', 'comments']);
  assert.equal(ANALYTICS_SUPPORT.x.denominator, 'impressions');
  assert.equal(ANALYTICS_SUPPORT.linkedin.denominator, 'impressions');
  assert.equal(ANALYTICS_SUPPORT.bluesky.denominator, null);
  assert.equal(analyticsPlatforms().length, 9);
});

test('engagement formulas are explicit and never assume a denominator', () => {
  const x = engagementFormula('x');
  assert.equal(x.denominator, 'impressions');
  assert.deepEqual(x.actions, ['likes', 'comments', 'reposts', 'quotes', 'saves']);
  assert.match(x.label, /÷ impressions/);

  const reddit = engagementFormula('reddit');
  assert.equal(reddit.denominator, null);
  assert.match(reddit.label, /no valid denominator/);

  assert.equal(engagementFormula('whatsapp').actions.length, 0);
});

test('post metrics normalize only documented fields for each platform', async (t) => {
  await t.test('X public and owner-context metrics merge', () => {
    const result = normalizePostMetrics('x', {
      impression_count: 1000,
      like_count: 50,
      reply_count: 5,
      retweet_count: 8,
      quote_count: 2,
      bookmark_count: 3,
      url_link_clicks: 12,
    });
    assert.deepEqual(result.metrics, {
      impressions: 1000,
      likes: 50,
      comments: 5,
      reposts: 8,
      quotes: 2,
      saves: 3,
      clicks: 12,
    });
    assert.deepEqual(result.missing, []);
  });

  await t.test('LinkedIn member analytics map impressions, reach and actions', () => {
    const result = normalizePostMetrics('linkedin', {
      impressions: 2000,
      uniqueImpressionsCount: 900,
      likeCount: 80,
      commentCount: 10,
      shareCount: 6,
      postSaveCount: 4,
      clickCount: 20,
    });
    assert.equal(result.metrics.impressions, 2000);
    assert.equal(result.metrics.reach, 900);
    assert.equal(result.metrics.likes, 80);
    assert.equal(result.metrics.comments, 10);
    assert.equal(result.metrics.reposts, 6);
    assert.equal(result.metrics.saves, 4);
    assert.equal(result.metrics.clicks, 20);
  });

  await t.test('Reddit keeps score separate and ignores undocumented view_count', () => {
    const result = normalizePostMetrics('reddit', {
      score: 42,
      num_comments: 7,
      view_count: 999,
      upvote_ratio: 0.9,
    });
    assert.deepEqual(result.metrics, { score: 42, comments: 7 });
    assert.equal('impressions' in result.metrics, false);
    assert.deepEqual(result.missing, []);
  });

  await t.test('Bluesky public counts', () => {
    const result = normalizePostMetrics('bluesky', {
      likeCount: 12,
      replyCount: 3,
      repostCount: 4,
      quoteCount: 1,
      bookmarkCount: 2,
    });
    assert.deepEqual(result.metrics, {
      likes: 12,
      comments: 3,
      reposts: 4,
      quotes: 1,
      saves: 2,
    });
  });

  await t.test('Mastodon counts and instance-specific quotes', () => {
    const result = normalizePostMetrics('mastodon', {
      favourites_count: 9,
      replies_count: 2,
      reblogs_count: 3,
      quotes_count: 1,
    });
    assert.deepEqual(result.metrics, { likes: 9, comments: 2, reposts: 3, quotes: 1 });
  });

  await t.test('Discord and Slack expose reactions, not views', () => {
    assert.deepEqual(normalizePostMetrics('discord', { reactionCount: 7 }).metrics, { likes: 7 });
    assert.deepEqual(normalizePostMetrics('slack', { reactionCount: 7, replyCount: 2 }).metrics, {
      likes: 7,
      comments: 2,
    });
    assert.deepEqual(normalizePostMetrics('telegram', { views: 100 }).metrics, {});
    assert.deepEqual(normalizePostMetrics('whatsapp', { sent: 10 }).metrics, {});
  });

  await t.test('a returned zero is kept, a missing value is not zero', () => {
    const result = normalizePostMetrics('bluesky', { likeCount: 0 });
    assert.equal(result.metrics.likes, 0);
    assert.equal('comments' in result.metrics, false);
    assert.ok(result.missing.includes('comments'));
  });

  await t.test('invalid numeric values are rejected, never coerced', () => {
    const result = normalizePostMetrics('bluesky', {
      likeCount: -1,
      replyCount: '5',
      repostCount: true,
      quoteCount: Number.NaN,
      bookmarkCount: Number.POSITIVE_INFINITY,
    });
    assert.deepEqual(result.metrics, {});
    assert.equal(result.missing.length, 5);
  });
});

test('account metrics normalize followers/subscribers/posts only', () => {
  assert.deepEqual(normalizeAccountMetrics('x', { followers_count: 120, tweet_count: 40 }).metrics, {
    followers: 120,
    posts: 40,
  });
  assert.deepEqual(
    normalizeAccountMetrics('bluesky', { followersCount: 90, postsCount: 12 }).metrics,
    { followers: 90, posts: 12 }
  );
  assert.deepEqual(normalizeAccountMetrics('discord', { approximate_member_count: 500 }).metrics, {
    subscribers: 500,
  });
  assert.deepEqual(normalizeAccountMetrics('telegram', { memberCount: 800 }).metrics, {
    subscribers: 800,
  });
  assert.deepEqual(normalizeAccountMetrics('reddit', { link_karma: 100 }).metrics, {});
  assert.deepEqual(normalizeAccountMetrics('slack', { num_members: 20 }).metrics, {});
});

test('engagement totals and rates use only returned values and a real denominator', async (t) => {
  await t.test('X total and rate', () => {
    const total = engagementTotal('x', {
      likes: 50,
      comments: 5,
      reposts: 8,
      quotes: 2,
      saves: 3,
      impressions: 1000,
    });
    assert.equal(total.value, 68);
    assert.equal(total.complete, true);
    const rate = engagementRate('x', {
      likes: 50,
      comments: 5,
      reposts: 8,
      quotes: 2,
      saves: 3,
      impressions: 1000,
    });
    assert.equal(rate.value, 6.8);
    assert.match(rate.basis || '', /impressions/);
  });

  await t.test('a missing action makes the total partial, not zero-filled', () => {
    const total = engagementTotal('x', {
      likes: 10,
      comments: 1,
      reposts: 2,
      quotes: 0,
      impressions: 500,
    });
    assert.equal(total.value, 13);
    assert.equal(total.complete, false);
    assert.deepEqual(total.missing, ['saves']);
  });

  await t.test('no denominator means no engagement rate', () => {
    const rate = engagementRate('reddit', { score: 40, comments: 5 });
    assert.equal(rate.value, null);
    assert.match(rate.reason || '', /denominator/);
    assert.equal(engagementTotal('reddit', { score: 40, comments: 5 }).value, 45);
  });

  await t.test('zero or missing impressions never divides by zero', () => {
    const zero = engagementRate('x', { likes: 5, impressions: 0 });
    assert.equal(zero.value, null);
    const missing = engagementRate('x', { likes: 5 });
    assert.equal(missing.value, null);
    const noActions = engagementRate('x', { impressions: 100 });
    assert.equal(noActions.value, null);
  });

  await t.test('unsupported platforms have no engagement', () => {
    assert.equal(engagementTotal('whatsapp', { likes: 5 }).value, null);
    assert.equal(engagementRate('whatsapp', { impressions: 100 }).value, null);
  });
});

test('aggregation distinguishes unavailable from zero', () => {
  const none = aggregateMetric([]);
  assert.equal(none.value, null);
  assert.equal(none.complete, false);

  const zero = aggregateMetric([0, 0]);
  assert.equal(zero.value, 0);
  assert.equal(zero.complete, true);

  const partial = aggregateMetric([10, null]);
  assert.equal(partial.value, 10);
  assert.equal(partial.complete, false);
  assert.equal(partial.withMetric, 1);
  assert.equal(partial.missing, 1);
});

test('trends and percent changes never invent a direction', () => {
  assert.equal(trendDirection(120, 100), 'up');
  assert.equal(trendDirection(80, 100), 'down');
  assert.equal(trendDirection(101, 100), 'flat');
  assert.equal(trendDirection(10, null), 'unknown');
  assert.equal(trendDirection(0, 0), 'flat');
  assert.equal(percentChange(120, 100), 20);
  assert.equal(percentChange(80, 100), -20);
  assert.equal(percentChange(10, 0), null);
  assert.equal(percentChange(null, 10), null);

  const trend = trendFromSnapshots(
    [
      { capturedAt: '2026-11-01T00:00:00.000Z', metrics: { likes: 10 } },
      { capturedAt: '2026-11-02T00:00:00.000Z', metrics: { likes: 30 } },
    ],
    'likes'
  );
  assert.equal(trend, 'up');
  assert.equal(
    trendFromSnapshots([{ capturedAt: '2026-11-01T00:00:00.000Z', metrics: { likes: 10 } }], 'likes'),
    'unknown'
  );
});

test('content types are derived from the publication, not guessed from text', () => {
  assert.equal(deriveContentType({ platformId: 'x', threadParts: ['a', 'b'] }), 'thread');
  assert.equal(deriveContentType({ platformId: 'x', threadParts: ['a'] }), 'text');
  assert.equal(deriveContentType({ platformId: 'reddit', submissionType: 'link' }), 'link');
  assert.equal(deriveContentType({ platformId: 'reddit', submissionType: 'self' }), 'text');
  assert.equal(deriveContentType({ platformId: 'slack' }), 'message');
  assert.equal(deriveContentType({ platformId: 'bluesky' }), 'short');
  assert.equal(deriveContentType({ platformId: 'x', mode: 'manual' }), 'manual');
});

test('performance bands require a meaningful sample', () => {
  assert.equal(performanceBand(100, [10, 20, 30]), 'unknown');
  assert.equal(performanceBand(100, [10, 20, 30, 40, 50]), 'top');
  assert.equal(performanceBand(15, [10, 20, 30, 40, 50]), 'weak');
  assert.equal(performanceBand(35, [10, 20, 30, 40, 50]), 'typical');
  assert.equal(performanceBand(null, [10, 20, 30, 40]), 'unknown');
});

test('stored metrics reject unknown keys and invalid values', () => {
  const metrics = sanitizeStoredMetrics({
    likes: 5,
    impressions: 0,
    comments: -1,
    bogus: 9,
    saves: '2',
  });
  assert.deepEqual(metrics, { likes: 5, impressions: 0 });
  assert.deepEqual(sanitizeStoredMetrics(null), {});
  assert.deepEqual(sanitizeStoredMetrics([1, 2]), {});
});

test('date ranges are validated and previous periods are contiguous', async (t) => {
  await t.test('presets', () => {
    const now = new Date('2026-11-11T12:00:00.000Z');
    const week = resolveAnalyticsRange({ days: 7 }, now);
    assert.equal(week.from, '2026-11-05');
    assert.equal(week.to, '2026-11-11');
    assert.equal(week.days, 7);
    const fallback = resolveAnalyticsRange({ days: 13 }, now);
    assert.equal(fallback.days, 30);
  });

  await t.test('custom ranges and validation', () => {
    const range = resolveAnalyticsRange({ from: '2026-10-01', to: '2026-10-31' });
    assert.equal(range.days, 31);
    assert.equal(range.label, 'Custom range');
    assert.throws(() => resolveAnalyticsRange({ from: '2026-10-31', to: '2026-10-01' }), AnalyticsRangeError);
    assert.throws(() => resolveAnalyticsRange({ from: 'bad', to: '2026-10-01' }), AnalyticsRangeError);
    assert.throws(
      () => resolveAnalyticsRange({ from: '2025-01-01', to: '2026-11-11' }),
      AnalyticsRangeError
    );
    assert.throws(() => resolveAnalyticsRange({ from: '2026-01-01' }), AnalyticsRangeError);
  });

  await t.test('timezone fallback and previous period', () => {
    const range = resolveAnalyticsRange({ days: 7, timezone: 'Not/AZone' });
    assert.equal(range.timezone, 'UTC');
    const previous = previousAnalyticsRange(range);
    assert.equal(previous.to, '2026-11-04');
    assert.equal(previous.from, '2026-10-29');
    assert.equal(previous.days, 7);
  });

  await t.test('range membership and local time helpers', () => {
    assert.equal(inAnalyticsRange('2026-11-05T23:00:00.000Z', { from: '2026-11-05', to: '2026-11-11' }), true);
    assert.equal(inAnalyticsRange('2026-11-12T00:00:00.000Z', { from: '2026-11-05', to: '2026-11-11' }), false);
    assert.equal(weekdayLabel('2026-11-10T12:00:00.000Z', 'UTC'), 'Tue');
    assert.equal(hourInZone('2026-11-10T12:00:00.000Z', 'UTC'), 12);
    assert.equal(hourWindowLabel(14), '12:00–15:00');
  });

  await t.test('DST transitions keep local dates, weekdays and hours coherent', () => {
    // 2026-03-08 02:00 America/New_York jumps to 03:00 EDT.
    assert.equal(weekdayLabel('2026-03-08T07:00:00.000Z', 'America/New_York'), 'Sun');
    assert.equal(hourInZone('2026-03-08T07:00:00.000Z', 'America/New_York'), 3);
    assert.equal(zonedDateKey('2026-03-09T03:30:00.000Z', 'America/New_York'), '2026-03-08');
    // 2026-11-01 02:00 EDT falls back to 01:00 EST; both map to the same date.
    assert.equal(weekdayLabel('2026-11-01T05:30:00.000Z', 'America/New_York'), 'Sun');
    assert.equal(weekdayLabel('2026-11-01T06:30:00.000Z', 'America/New_York'), 'Sun');
    assert.equal(zonedDateKey('2026-11-01T06:30:00.000Z', 'America/New_York'), '2026-11-01');
    assert.equal(zonedDateKey('2026-11-02T04:30:00.000Z', 'America/New_York'), '2026-11-01');
  });
});
