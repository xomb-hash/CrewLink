import test from 'node:test';
import assert from 'node:assert/strict';
import {
  xTextMetrics,
  xThreadProblems,
  threadText,
  X_WEIGHTED_LIMIT,
  X_MAX_THREAD_PARTS,
} from '../src/posting/x/text';
import {
  X_PRICING,
  X_MANUAL_COST,
  estimateXThread,
  formatUsd,
  priceForPost,
} from '../src/posting/x/pricing';

test('X text uses the official weighted counting rules', async (t) => {
  await t.test('Latin text counts one per character', () => {
    assert.equal(xTextMetrics('a'.repeat(X_WEIGHTED_LIMIT)).weightedLength, X_WEIGHTED_LIMIT);
    assert.equal(xTextMetrics('a'.repeat(X_WEIGHTED_LIMIT)).valid, true);
    assert.equal(xTextMetrics('a'.repeat(X_WEIGHTED_LIMIT + 1)).valid, false);
  });

  await t.test('every URL counts as 23 characters regardless of length', () => {
    const short = xTextMetrics('https://x.co').weightedLength;
    const long = xTextMetrics(`https://example.com/${'a'.repeat(200)}`).weightedLength;
    assert.equal(short, 23);
    assert.equal(long, 23);
    assert.equal(xTextMetrics('see https://example.com/path').urlCount, 1);
  });

  await t.test('CJK characters count as two', () => {
    assert.equal(xTextMetrics('漢'.repeat(140)).weightedLength, 280);
    assert.equal(xTextMetrics('漢'.repeat(140)).valid, true);
    assert.equal(xTextMetrics('漢'.repeat(141)).valid, false);
  });

  await t.test('emoji count as two', () => {
    assert.equal(xTextMetrics('😀'.repeat(140)).weightedLength, 280);
    assert.equal(xTextMetrics('😀'.repeat(141)).valid, false);
  });
});

test('X threads are validated per post and bound the part count', async (t) => {
  await t.test('the canonical text joins parts with a blank line', () => {
    assert.equal(threadText(['first', 'second']), 'first\n\nsecond');
  });

  await t.test('empty, over-limit and too-long threads are rejected', () => {
    assert.deepEqual(xThreadProblems([]), ['Add at least one post.']);
    assert.ok(xThreadProblems(['ok', '']).some((problem) => problem.startsWith('Post 2')));
    assert.ok(
      xThreadProblems(['a'.repeat(X_WEIGHTED_LIMIT + 1)]).some((problem) =>
        problem.startsWith('Post 1')
      )
    );
    assert.equal(
      xThreadProblems(new Array(X_MAX_THREAD_PARTS + 1).fill('post'))[0],
      `A thread can contain at most ${X_MAX_THREAD_PARTS} posts.`
    );
    assert.deepEqual(
      xThreadProblems(new Array(X_MAX_THREAD_PARTS).fill('post')),
      []
    );
  });
});

test('X pricing comes from one versioned source and never fabricates a price', async (t) => {
  await t.test('a plain post and a link post use the published rates', () => {
    assert.equal(priceForPost('hello'), 15_000);
    assert.equal(priceForPost('hello https://example.com'), 200_000);
    assert.equal(X_PRICING.createRequestMicros, 15_000);
    assert.equal(X_PRICING.createRequestWithUrlMicros, 200_000);
    assert.match(X_PRICING.source, /^https:\/\/docs\.x\.com\//);
    assert.match(X_PRICING.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
  });

  await t.test('a thread estimate sums requests and link surcharges', () => {
    const estimate = estimateXThread(['first', 'second https://example.com', 'third']);
    assert.equal(estimate.requests, 3);
    assert.equal(estimate.costMicros, 15_000 + 200_000 + 15_000);
    assert.equal(estimate.costUsd, 0.23);
    assert.deepEqual(
      estimate.perPost.map((post) => post.hasUrl),
      [false, true, false]
    );
    assert.equal(formatUsd(estimate.costMicros), '$0.230');
    assert.equal(formatUsd(15_000), '$0.015');
  });

  await t.test('manual publishing is always free', () => {
    assert.equal(X_MANUAL_COST.costMicros, 0);
    assert.equal(X_MANUAL_COST.requests, 0);
    assert.match(X_MANUAL_COST.message, /free/i);
  });
});
