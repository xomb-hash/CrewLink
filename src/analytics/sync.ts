import crypto from 'node:crypto';
import { config } from '../config/index';
import storage from '../lib/storage';
import { logger } from '../lib/logger';
import { decryptConnectionTokens, verifyConnection } from '../posting/connections';
import { loadBotToken } from '../posting/bots/index';
import { BotError } from '../posting/bots/types';
import { ConnectionError } from '../posting/connections';
import type { Project, User, Publication, StoredPlatformConnection } from '../types/index';
import type { AnalyticsPlatformId, AnalyticsSyncStatus, MetricSet } from './types';
import type { MetricKey } from './metricsKeys';
import { getAnalyticsClient } from './clients/index';
import { AnalyticsClientError, type AnalyticsFetchContext } from './clients/types';
import {
  deriveContentType,
  engagementRate,
  engagementTotal,
  isAnalyticsPlatformId,
  normalizeAccountMetrics,
  normalizePostMetrics,
} from './metrics';
import { getAnalyticsSupport } from './platforms';

export type AnalyticsErrorCode =
  | 'invalid_input'
  | 'sync_in_progress'
  | 'unsupported_platform'
  | 'connection_missing'
  | 'auth_revoked'
  | 'rate_limited'
  | 'permission_missing'
  | 'needs_approval'
  | 'platform_error'
  | 'transport_error'
  | 'not_found';

export class AnalyticsError extends Error {
  constructor(
    message: string,
    readonly code: AnalyticsErrorCode,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'AnalyticsError';
  }
}

export interface SyncAnalyticsInput {
  user: User;
  project: Project;
  platformIds?: string[];
  trigger?: 'manual' | 'scheduled' | 'publish';
  now?: Date;
}

export interface PlatformSyncResult {
  platformId: string;
  status: AnalyticsSyncStatus;
  postsRequested: number;
  postsUpdated: number;
  snapshotsWritten: number;
  errorCode?: string;
  errorMessage?: string;
  note: string;
}

export interface SyncAnalyticsResult {
  projectId: string;
  startedAt: string;
  finishedAt: string;
  results: PlatformSyncResult[];
}

function hashMetrics(metrics: MetricSet): string {
  const stable = Object.entries(metrics)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 16);
}

function snapshotBucket(now: Date): string {
  const bucketMs = 15 * 60 * 1000;
  return String(Math.floor(now.getTime() / bucketMs));
}

function sameMetrics(a: MetricSet, b: MetricSet): boolean {
  return hashMetrics(a) === hashMetrics(b);
}

function safeMessage(error: unknown): string {
  if (
    error instanceof AnalyticsClientError ||
    error instanceof AnalyticsError ||
    error instanceof ConnectionError ||
    error instanceof BotError
  ) {
    return String(error.message || 'The sync failed.').replace(/\s+/g, ' ').slice(0, 300);
  }
  // Unexpected errors may contain transport details; never store them raw.
  return 'An unexpected analytics error occurred.';
}

function mapErrorCode(error: unknown): string {
  if (error instanceof AnalyticsClientError) return error.code;
  if (error instanceof AnalyticsError) return error.code;
  if (error instanceof BotError) {
    return error.code === 'bot_token_missing' ? 'permission_missing' : 'bot_error';
  }
  if (error instanceof ConnectionError) {
    if (error.code === 'invalid_credentials') return 'auth_revoked';
    if (error.code === 'platform_rate_limited') return 'rate_limited';
    if (error.code === 'connection_inactive') return 'connection_missing';
    return 'platform_error';
  }
  return 'platform_error';
}

function retryAfter(error: unknown): number | undefined {
  return error instanceof AnalyticsClientError || error instanceof AnalyticsError
    ? error.retryAfterSeconds
    : undefined;
}

// A snapshot is written only when the metric values changed. The dedupe key also
// makes two concurrent identical writes idempotent inside the 15-minute bucket.
export async function writeAnalyticsSnapshot(input: {
  userId: string;
  projectId: string;
  platformId: string;
  scope: 'post' | 'account';
  analyticsPostId?: string;
  analyticsAccountId?: string;
  metrics: MetricSet;
  now: Date;
}): Promise<number> {
  const latest = await storage.listAnalyticsSnapshots({
    ...(input.scope === 'post'
      ? { analyticsPostId: input.analyticsPostId }
      : { analyticsAccountId: input.analyticsAccountId }),
    limit: 1,
    order: 'desc',
  });
  const last = latest[0];
  if (last && sameMetrics(last.metrics, input.metrics)) return 0;

  const entityId = input.analyticsPostId || input.analyticsAccountId || 'unknown';
  const dedupeKey = `${input.scope}:${entityId}:${hashMetrics(input.metrics)}:${snapshotBucket(
    input.now
  )}`;
  const capturedAt = input.now.toISOString();
  const result = await storage.createAnalyticsSnapshotIfAbsent({
    id: `asnap_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    userId: input.userId,
    projectId: input.projectId,
    platformId: input.platformId,
    scope: input.scope,
    analyticsPostId: input.analyticsPostId,
    analyticsAccountId: input.analyticsAccountId,
    dedupeKey,
    metrics: input.metrics,
    capturedAt,
    source: 'api',
    createdAt: capturedAt,
  });
  return result.created ? 1 : 0;
}

function accountStatus(
  available: number,
  missing: number
): 'active' | 'partial' | 'unsupported' {
  if (available === 0) return 'unsupported';
  return missing > 0 ? 'partial' : 'active';
}

export async function syncProjectAnalytics(
  input: SyncAnalyticsInput
): Promise<SyncAnalyticsResult> {
  const now = input.now || new Date();
  const startedAt = now.toISOString();
  const userId = String(input.user.id);

  const requested = input.platformIds?.length
    ? Array.from(new Set(input.platformIds))
    : Array.from(
        new Set(
          (await storage.listPlatformConnections(userId, input.project.id)).map(
            (connection) => connection.platformId
          )
        )
      );

  // Acquire one database lease per project/platform before doing any work. The
  // unique key is the mutex; the token makes release safe after a lease expires.
  // No transaction is held while a platform API is called.
  const lockToken = crypto.randomUUID();
  const heldLocks: string[] = [];
  try {
    for (const platformId of requested) {
      const connection = await storage.findPlatformConnection(
        userId,
        input.project.id,
        platformId
      );
      const key = `analytics:${input.project.id}:${platformId}`;
      const acquired = await storage.acquireAnalyticsSyncLock({
        key,
        ownerToken: lockToken,
        projectId: input.project.id,
        platformId,
        connectionId: connection?.id,
        now: new Date(),
        leaseMs: config.analyticsSyncLeaseMs,
      });
      if (!acquired.acquired) {
        throw new AnalyticsError(
          `An analytics sync is already running for ${platformId}. Try again when it finishes.`,
          'sync_in_progress'
        );
      }
      heldLocks.push(key);
    }

    const results: PlatformSyncResult[] = [];
    for (const platformId of requested) {
      results.push(
        await syncPlatform({
          userId,
          project: input.project,
          platformId,
          trigger: input.trigger || 'manual',
          now,
        })
      );
    }

    return {
      projectId: input.project.id,
      startedAt,
      finishedAt: new Date().toISOString(),
      results,
    };
  } finally {
    for (const key of heldLocks) {
      try {
        await storage.releaseAnalyticsSyncLock(key, lockToken);
      } catch (error) {
        // A lock that cannot be released expires naturally; never mask the sync
        // result with a cleanup error.
        logger.warn('Analytics sync lock release failed', {
          key,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
  }
}

async function syncPlatform(input: {
  userId: string;
  project: Project;
  platformId: string;
  trigger: 'manual' | 'scheduled' | 'publish';
  now: Date;
}): Promise<PlatformSyncResult> {
  const { userId, project, platformId, now } = input;
  const startedAt = now.toISOString();

  if (!isAnalyticsPlatformId(platformId)) {
    return {
      platformId,
      status: 'skipped',
      postsRequested: 0,
      postsUpdated: 0,
      snapshotsWritten: 0,
      errorCode: 'unsupported_platform',
      note: 'This platform is not supported for analytics.',
    };
  }

  const support = getAnalyticsSupport(platformId);
  if (!support) {
    return {
      platformId,
      status: 'skipped',
      postsRequested: 0,
      postsUpdated: 0,
      snapshotsWritten: 0,
      errorCode: 'unsupported_platform',
      note: 'This platform is not supported for analytics.',
    };
  }

  const sync = await storage.createAnalyticsSync({
    userId,
    projectId: project.id,
    platformId,
    trigger: input.trigger,
    status: 'running',
    startedAt,
  });

  if (support.status === 'unsupported') {
    const message = support.reason;
    await storage.updateAnalyticsSync(sync.id, {
      status: 'skipped',
      finishedAt: new Date().toISOString(),
      errorCode: 'unsupported_platform',
      errorMessage: message,
    });
    await storage.upsertAnalyticsAccount({
      userId,
      projectId: project.id,
      connectionId: `unsupported:${project.id}:${platformId}`,
      platformId,
      metrics: {},
      availableMetrics: [],
      unavailableMetrics: support.metrics,
      status: 'unsupported',
      note: message,
    });
    return {
      platformId,
      status: 'skipped',
      postsRequested: 0,
      postsUpdated: 0,
      snapshotsWritten: 0,
      errorCode: 'unsupported_platform',
      note: message,
    };
  }

  const connection = await storage.findPlatformConnection(userId, project.id, platformId);
  if (!connection || connection.status !== 'active') {
    const message = 'Connect an active account or channel before syncing analytics.';
    await storage.updateAnalyticsSync(sync.id, {
      status: 'skipped',
      finishedAt: new Date().toISOString(),
      errorCode: 'connection_missing',
      errorMessage: message,
    });
    return {
      platformId,
      status: 'skipped',
      postsRequested: 0,
      postsUpdated: 0,
      snapshotsWritten: 0,
      errorCode: 'connection_missing',
      note: message,
    };
  }

  // Account platforms are verified first so an expired token is refreshed by the
  // existing M3–M7 verifier instead of duplicating refresh logic here.
  let verified: StoredPlatformConnection = connection;
  if (platformId !== 'discord' && platformId !== 'telegram') {
    try {
      await verifyConnection(userId, connection.id);
      const refreshed = await storage.getPlatformConnectionById(connection.id);
      if (refreshed) verified = refreshed;
    } catch (error) {
      const code = mapErrorCode(error);
      const message = safeMessage(error);
      await storage.upsertAnalyticsAccount({
        userId,
        projectId: project.id,
        connectionId: connection.id,
        platformId,
        externalAccountId: connection.externalAccountId,
        externalAccountName: connection.externalAccountName,
        metrics: {},
        availableMetrics: [],
        unavailableMetrics: support.accountMetrics,
        status: 'error',
        note: 'The connection could not be verified for analytics.',
        lastSyncedAt: new Date().toISOString(),
        lastErrorCode: code,
        lastErrorMessage: message,
      });
      await storage.updateAnalyticsSync(sync.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        errorCode: code,
        errorMessage: message,
      });
      return {
        platformId,
        status: 'failed',
        postsRequested: 0,
        postsUpdated: 0,
        snapshotsWritten: 0,
        errorCode: code,
        note: message,
      };
    }
  }

  let context: AnalyticsFetchContext;
  try {
    context =
      platformId === 'discord' || platformId === 'telegram'
        ? { connection: verified, botToken: await loadBotToken(platformId) }
        : { connection: verified, tokens: await decryptConnectionTokens(verified) };
  } catch (error) {
    const code = mapErrorCode(error);
    const message = safeMessage(error);
    await storage.updateAnalyticsSync(sync.id, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      errorCode: code,
      errorMessage: message,
    });
    return {
      platformId,
      status: 'failed',
      postsRequested: 0,
      postsUpdated: 0,
      snapshotsWritten: 0,
      errorCode: code,
      note: message,
    };
  }

  const client = getAnalyticsClient(platformId);
  let postsUpdated = 0;
  let snapshotsWritten = 0;
  let failures = 0;
  let lastErrorCode: string | undefined;
  let lastErrorMessage: string | undefined;
  let timedOut = false;
  let stopPosts = false;
  // The deadline is wall-clock: an injected `now` is for snapshot timestamps
  // only, not for measuring how long this sync may run.
  const deadline = Date.now() + config.analyticsSyncTimeoutMs;

  // --- Account metrics ---
  if (support.accountLevel) {
    try {
      const result = await client.fetchAccount(context);
      const normalized = normalizeAccountMetrics(platformId, result.metrics);
      const status = accountStatus(normalized.available.length, normalized.missing.length);
      const account = await storage.upsertAnalyticsAccount({
        userId,
        projectId: project.id,
        connectionId: connection.id,
        platformId,
        externalAccountId: result.externalAccountId || connection.externalAccountId,
        externalAccountName: result.externalAccountName || connection.externalAccountName,
        metrics: normalized.metrics,
        availableMetrics: normalized.available,
        unavailableMetrics: normalized.missing,
        status,
        note: normalized.available.length
          ? undefined
          : 'The platform returned no supported account metrics.',
        lastSyncedAt: new Date().toISOString(),
      });
      if (Object.keys(normalized.metrics).length) {
        snapshotsWritten += await writeAnalyticsSnapshot({
          userId,
          projectId: project.id,
          platformId,
          scope: 'account',
          analyticsAccountId: account.id,
          metrics: normalized.metrics,
          now,
        });
      }
      await pruneEntitySnapshots('account', account.id, now);
    } catch (error) {
      failures += 1;
      lastErrorCode = mapErrorCode(error);
      lastErrorMessage = safeMessage(error);
      stopPosts = lastErrorCode === 'auth_revoked' || lastErrorCode === 'rate_limited';
      await storage.upsertAnalyticsAccount({
        userId,
        projectId: project.id,
        connectionId: connection.id,
        platformId,
        externalAccountId: connection.externalAccountId,
        externalAccountName: connection.externalAccountName,
        metrics: {},
        availableMetrics: [],
        unavailableMetrics: support.accountMetrics,
        status: 'error',
        note: 'Account metrics could not be read.',
        lastSyncedAt: new Date().toISOString(),
        lastErrorCode: lastErrorCode,
        lastErrorMessage: lastErrorMessage,
      });
    }
  }

  // --- Post metrics ---
  const publications = (await storage.listPublicationsByProject(project.id, platformId)).filter(
    (publication) => publication.status === 'published'
  );
  const limited = stopPosts ? [] : publications.slice(0, config.analyticsMaxPostsPerSync);

  for (const publication of limited) {
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
    const outcome = await syncPost({
      userId,
      project,
      platformId,
      supportPostLevel: support.postLevel,
      supportMetrics: support.metrics,
      client,
      context,
      publication,
      now,
    });
    if (outcome.updated) postsUpdated += 1;
    snapshotsWritten += outcome.snapshotsWritten;
    if (outcome.errorCode) {
      failures += 1;
      lastErrorCode = outcome.errorCode;
      lastErrorMessage = outcome.errorMessage;
      // A revoked token or a rate limit stops the sweep instead of hammering the
      // platform for every remaining post.
      if (outcome.errorCode === 'auth_revoked' || outcome.errorCode === 'rate_limited') break;
    }
  }

  const status: AnalyticsSyncStatus =
    failures === 0 && !timedOut
      ? 'completed'
      : postsUpdated === 0 && !support.postLevel
        ? 'partial'
        : postsUpdated === 0
          ? 'failed'
          : 'partial';
  const errorCode = timedOut ? 'sync_timeout' : lastErrorCode;
  const errorMessage = timedOut
    ? 'The sync reached its time limit before checking every post.'
    : lastErrorMessage;

  await storage.updateAnalyticsSync(sync.id, {
    status,
    finishedAt: new Date().toISOString(),
    postsRequested: limited.length,
    postsUpdated,
    snapshotsWritten,
    ...(errorCode ? { errorCode } : {}),
    ...(errorMessage ? { errorMessage } : {}),
  });

  return {
    platformId,
    status,
    postsRequested: limited.length,
    postsUpdated,
    snapshotsWritten,
    errorCode,
    note:
      status === 'completed'
        ? `Checked ${limited.length} published post(s).`
        : errorMessage || 'The sync completed with limitations.',
  };
}

async function syncPost(input: {
  userId: string;
  project: Project;
  platformId: AnalyticsPlatformId;
  supportPostLevel: boolean;
  supportMetrics: MetricKey[];
  client: ReturnType<typeof getAnalyticsClient>;
  context: AnalyticsFetchContext;
  publication: Publication;
  now: Date;
}): Promise<{ updated: boolean; snapshotsWritten: number; errorCode?: string; errorMessage?: string }> {
  const { userId, project, platformId, publication, now } = input;
  const draft = await storage.getDraftById(publication.draftId);
  const idea = draft?.contentIdeaId
    ? await storage.getContentIdeaById(draft.contentIdeaId)
    : null;
  const contentType = deriveContentType({
    platformId,
    threadParts: draft?.threadParts,
    submissionType: draft?.submissionType,
    mode: publication.mode,
  });
  const publishedAt = publication.confirmedAt || publication.createdAt;

  const base = {
    userId,
    projectId: project.id,
    publicationId: publication.id,
    draftId: publication.draftId,
    campaignId: draft?.campaignId,
    platformId,
    externalId: publication.externalId,
    externalUrl: publication.externalUrl,
    publishedAt,
    contentType,
    topic: idea?.topic,
    lastSyncedAt: new Date().toISOString(),
  } as const;

  if (!input.supportPostLevel) {
    await storage.upsertAnalyticsPost({
      ...base,
      metrics: {},
      availableMetrics: [],
      unavailableMetrics: [],
      engagement: null,
      engagementRate: null,
      status: 'unsupported',
      note: 'This platform does not expose post-level analytics through its official API.',
    });
    return { updated: false, snapshotsWritten: 0 };
  }

  if (publication.mode === 'manual' || !publication.externalId) {
    await storage.upsertAnalyticsPost({
      ...base,
      metrics: {},
      availableMetrics: [],
      unavailableMetrics: input.supportMetrics,
      engagement: null,
      engagementRate: null,
      status: 'unsupported',
      note:
        publication.mode === 'manual'
          ? 'This post was shared manually, so there is no platform metric to read.'
          : 'This post has no platform id, so Crewlink cannot read its metrics.',
    });
    return { updated: false, snapshotsWritten: 0 };
  }

  try {
    const result = await input.client.fetchPost({
      ...input.context,
      publication,
    });
    const normalized = normalizePostMetrics(platformId, result.metrics);
    const total = engagementTotal(platformId, normalized.metrics);
    const rate = engagementRate(platformId, normalized.metrics);
    const post = await storage.upsertAnalyticsPost({
      ...base,
      externalUrl: result.externalUrl || publication.externalUrl,
      metrics: normalized.metrics,
      availableMetrics: normalized.available,
      unavailableMetrics: normalized.missing,
      engagement: total.value,
      engagementRate: rate.value,
      engagementRateBasis: rate.basis ?? undefined,
      status: normalized.available.length
        ? normalized.missing.length
          ? 'partial'
          : 'active'
        : 'partial',
      note: normalized.available.length
        ? undefined
        : 'The platform returned no metric Crewlink supports. Nothing is shown as zero.',
    });
    let snapshots = 0;
    if (normalized.available.length) {
      snapshots = await writeAnalyticsSnapshot({
        userId,
        projectId: project.id,
        platformId,
        scope: 'post',
        analyticsPostId: post.id,
        metrics: normalized.metrics,
        now,
      });
    }
    await pruneEntitySnapshots('post', post.id, now);
    return { updated: true, snapshotsWritten: snapshots };
  } catch (error) {
    const code = mapErrorCode(error);
    const message = safeMessage(error);
    await storage.upsertAnalyticsPost({
      ...base,
      metrics: {},
      availableMetrics: [],
      unavailableMetrics: input.supportMetrics,
      engagement: null,
      engagementRate: null,
      status: 'error',
      note: 'Metrics could not be read for this post.',
      lastErrorCode: code,
    });
    return { updated: false, snapshotsWritten: 0, errorCode: code, errorMessage: message };
  }
}

async function pruneEntitySnapshots(
  scope: 'post' | 'account',
  id: string,
  now: Date
): Promise<void> {
  const olderThan = new Date(
    now.getTime() - config.analyticsSnapshotRetentionDays * 86_400_000
  ).toISOString();
  try {
    await storage.pruneAnalyticsSnapshots({
      scope,
      id,
      keep: config.analyticsSnapshotMaxPerEntity,
      olderThan,
    });
  } catch (error) {
    logger.warn('Analytics snapshot pruning failed', {
      scope,
      id,
      error: safeMessage(error),
    });
  }
}

export function resetAnalyticsSyncStateForTests(): void {
  // Kept for test compatibility. Lock state now lives in storage and is cleared
  // by storage.reset(); there is no process-global lock to reset.
}
