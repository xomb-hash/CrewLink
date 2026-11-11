import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicationStateFor,
  STALE_SENDING_MS,
} from '../src/posting/publicationState';
import type { Draft, Publication } from '../src/types/index';

const APPROVED_AT = '2026-11-10T10:00:00.000Z';
const NOW = new Date(APPROVED_AT).getTime();

const draft = (
  overrides: Partial<Pick<Draft, 'status' | 'approvedText' | 'approvedAt'>> = {}
): Pick<Draft, 'status' | 'approvedText' | 'approvedAt'> => ({
  status: 'approved',
  approvedText: 'Crewlink launch text',
  approvedAt: APPROVED_AT,
  ...overrides,
});

const publication = (overrides: Partial<Publication> = {}): Publication => ({
  id: 'pub_1',
  userId: 'user_1',
  projectId: 'proj_1',
  draftId: 'draft_1',
  connectionId: 'conn_1',
  platformId: 'discord',
  status: 'sending',
  mode: 'api',
  contentHash: 'a'.repeat(64),
  externalIds: [],
  createdAt: APPROVED_AT,
  updatedAt: APPROVED_AT,
  ...overrides,
});

test('publication state is fail-safe for uncertain sends', async (t) => {
  await t.test('unapproved draft without a publication needs approval', () => {
    const state = publicationStateFor(
      draft({ status: 'edited', approvedText: undefined, approvedAt: undefined }),
      null,
      NOW
    );
    assert.equal(state.kind, 'needs_approval');
    assert.equal(state.canPublish, false);
    assert.equal(state.canRetry, false);
  });

  await t.test('approved draft without a publication is ready', () => {
    const state = publicationStateFor(draft(), null, NOW);
    assert.equal(state.kind, 'ready');
    assert.equal(state.canPublish, true);
    assert.equal(state.canRetry, false);
  });

  await t.test('published draft cannot be published or retried again', () => {
    const state = publicationStateFor(
      draft(),
      publication({ status: 'published', externalId: 'msg_1' }),
      NOW
    );
    assert.equal(state.kind, 'published');
    assert.equal(state.canPublish, false);
    assert.equal(state.canRetry, false);
  });

  await t.test('an external id alone marks the draft as published', () => {
    const state = publicationStateFor(draft(), publication({ status: 'failed', externalId: 'msg_1' }), NOW);
    assert.equal(state.kind, 'published');
    assert.equal(state.canPublish, false);
  });

  await t.test('failed publication with a current approval allows one manual retry', () => {
    const state = publicationStateFor(
      draft(),
      publication({ status: 'failed', errorCode: 'rate_limited' }),
      NOW
    );
    assert.equal(state.kind, 'failed');
    assert.equal(state.canPublish, true);
    assert.equal(state.canRetry, true);
    assert.match(String(state.detail), /rate-limited/i);
  });

  await t.test('failed publication with a stale approval requires a new approval', () => {
    const state = publicationStateFor(
      draft({ status: 'edited', approvedText: undefined, approvedAt: undefined }),
      publication({ status: 'failed' }),
      NOW
    );
    assert.equal(state.kind, 'needs_approval');
    assert.equal(state.canPublish, false);
    assert.equal(state.canRetry, false);
  });

  await t.test('recent sending publication is in progress with no actions', () => {
    const state = publicationStateFor(
      draft(),
      publication({ updatedAt: new Date(NOW - 60_000).toISOString() }),
      NOW
    );
    assert.equal(state.kind, 'sending');
    assert.equal(state.canPublish, false);
    assert.equal(state.canRetry, false);
  });

  await t.test('stale sending publication is uncertain and never retryable', () => {
    const state = publicationStateFor(
      draft(),
      publication({
        updatedAt: new Date(NOW - STALE_SENDING_MS - 1).toISOString(),
      }),
      NOW
    );
    assert.equal(state.kind, 'uncertain');
    assert.equal(state.canPublish, false);
    assert.equal(state.canRetry, false);
    assert.match(String(state.detail), /will not resend/i);
  });

  await t.test('an unreadable timestamp stays in progress rather than becoming retryable', () => {
    const state = publicationStateFor(draft(), publication({ updatedAt: 'not-a-date' }), NOW);
    assert.equal(state.kind, 'sending');
    assert.equal(state.canPublish, false);
    assert.equal(state.canRetry, false);
  });
});
