import crypto from 'node:crypto';
import { config } from '../config/index';
import { storage } from '../lib/storage';
import { logger } from '../lib/logger';
import { getBotClient, loadBotToken } from './bots/index';
import { BotError } from './bots/types';
import {
  ConnectionError,
  decryptConnectionTokens,
  persistConnectionTokens,
} from './connections';
import {
  AdapterError,
  getBlueskyClient,
  getLinkedInClient,
  getMastodonClient,
  getRedditClient,
  getSlackClient,
  getXClient,
  isLinkedInConfigured,
  LinkedInConfigError,
  resolveLinkedInApiVersion,
  SlackError,
} from './adapters/index';
import { STALE_SENDING_MS } from './publicationState';
import { estimateXThread, type XCostEstimate } from './x/pricing';
import { getXBudgetSummary, reserveXUsage, settleXUsage, type XBudgetSummary } from './x/usage';
import { xThreadProblems } from './x/text';
import {
  redditApprovalHash,
  redditComposerChecks,
} from './reddit/validate';
import { validateRedditSubmissionLive } from './reddit/discovery';
import type { BotPlatform } from './bots/types';
import type { OAuthPlatform } from './adapters/types';
import type { PlatformConnection, Publication } from '../types/index';

type PublishPlatform = BotPlatform | OAuthPlatform;

export type PublishErrorCode =
  | 'invalid_input'
  | 'draft_not_found'
  | 'project_not_found'
  | 'forbidden'
  | 'unsupported_platform'
  | 'draft_not_approved'
  | 'draft_changed'
  | 'connection_not_found'
  | 'connection_inactive'
  | 'in_progress'
  | 'already_published'
  | 'uncertain'
  | 'bot_token_missing'
  | 'send_failed'
  | 'auth_revoked'
  | 'rate_limited'
  | 'invalid_post'
  | 'platform_error'
  | 'cost_confirmation_required'
  | 'cost_limit_exceeded'
  | 'budget_exhausted'
  | 'x_not_configured'
  | 'reddit_not_configured'
  | 'linkedin_not_configured'
  | 'partial_thread';

export class PublishError extends Error {
  constructor(
    message: string,
    readonly code: PublishErrorCode,
    readonly retryAfterSeconds?: number,
    // Cost and budget details are safe to show the owner; they contain no tokens.
    readonly estimate?: XCostEstimate,
    readonly budget?: XBudgetSummary
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

export interface PublishInput {
  userId: string;
  draftId: string;
  // X charges per request, so automatic publishing needs an explicit owner
  // confirmation of the estimate. Other platforms ignore these fields.
  confirmCost?: boolean;
  maxCostUsd?: number;
}

export interface PublishResult {
  publication: Publication;
  connection: Pick<PlatformConnection, 'id' | 'platformId' | 'serverName' | 'channelName'>;
  estimate?: XCostEstimate;
}

const hashText = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

// A `sending` row older than STALE_SENDING_MS almost certainly means the process
// stopped mid-send. It is never retried automatically; the owner must check the channel.
function sendingConflict(existing: Publication): PublishError {
  const stale = Date.now() - new Date(existing.updatedAt).getTime() > STALE_SENDING_MS;
  return stale
    ? new PublishError(
        'A previous attempt did not finish. Check the channel; Crewlink will not resend automatically.',
        'uncertain'
      )
    : new PublishError('This draft is already being published.', 'in_progress');
}

const BOT_PLATFORMS = new Set<PublishPlatform>(['discord', 'telegram']);
const ACCOUNT_PLATFORMS = new Set<PublishPlatform>([
  'bluesky',
  'mastodon',
  'x',
  'reddit',
  'linkedin',
  'slack',
]);

// A thread draft keeps its parts; `text` is the canonical joined value. Every
// other platform has exactly one part.
function draftParts(draft: { text: string; threadParts?: string[] }): string[] {
  return draft.threadParts && draft.threadParts.length ? draft.threadParts : [draft.text];
}

function publishPlatformFor(platformId: string): PublishPlatform {
  if (BOT_PLATFORMS.has(platformId as PublishPlatform)) return platformId as BotPlatform;
  if (ACCOUNT_PLATFORMS.has(platformId as PublishPlatform)) {
    return platformId as OAuthPlatform;
  }
  throw new PublishError(
    'This platform is not supported for publishing yet.',
    'unsupported_platform'
  );
}

// Definitive platform failures become a `failed` row, which the owner may retry
// by hand. Ambiguous sends are handled separately and never reach this map.
function adapterFailure(err: AdapterError): {
  errorCode: string;
  publishCode: PublishErrorCode;
} {
  switch (err.code) {
    case 'revoked':
    case 'token_expired':
    case 'auth_failed':
      return { errorCode: 'auth_revoked', publishCode: 'auth_revoked' };
    case 'rate_limited':
      return { errorCode: 'rate_limited', publishCode: 'rate_limited' };
    case 'validation_error':
    case 'invalid_input':
      return { errorCode: 'validation_error', publishCode: 'invalid_post' };
    default:
      return { errorCode: 'instance_error', publishCode: 'platform_error' };
  }
}

// Slack hides most API failures behind HTTP 200, so the publication row keeps the
// specific Slack error. A membership or channel problem must not be mistaken for
// a bad token, and a missing scope must not disconnect a working installation.
function slackAdapterFailure(err: SlackError): {
  errorCode: string;
  publishCode: PublishErrorCode;
} {
  switch (err.slackError) {
    case 'not_in_channel':
      return { errorCode: 'slack_not_in_channel', publishCode: 'send_failed' };
    case 'channel_not_found':
      return { errorCode: 'slack_channel_not_found', publishCode: 'send_failed' };
    case 'is_archived':
      return { errorCode: 'slack_channel_archived', publishCode: 'send_failed' };
    case 'restricted_action':
      return { errorCode: 'slack_restricted_action', publishCode: 'send_failed' };
    case 'missing_scope':
    case 'not_allowed_token_type':
      return { errorCode: 'slack_missing_scope', publishCode: 'auth_revoked' };
    case 'msg_too_long':
    case 'no_text':
    case 'invalid_arguments':
    case 'invalid_blocks':
      return { errorCode: 'validation_error', publishCode: 'invalid_post' };
    default:
      return adapterFailure(err);
  }
}

// --- Publish exactly one approved draft to exactly one bot platform ---
// Discord and Telegram share no state: each call reads its own draft, connection
// and bot client, so one platform failing can never block the other.
export async function publishDraft(input: PublishInput): Promise<PublishResult> {
  const draftId = String(input.draftId || '').trim();
  if (!draftId) throw new PublishError('Choose a draft to publish.', 'invalid_input');

  const draft = await storage.getDraftById(draftId);
  if (!draft) throw new PublishError('Draft not found.', 'draft_not_found');

  const project = await storage.getProjectById(draft.projectId);
  if (!project) throw new PublishError('Project not found.', 'project_not_found');
  if (project.ownerId !== input.userId) {
    throw new PublishError('Only the project owner can publish this draft.', 'forbidden');
  }

  const platform = publishPlatformFor(draft.platformId);
  const isBot = BOT_PLATFORMS.has(platform);

  // Approval is a hash of the exact submission, so an edited draft needs a new
  // approval. Reddit approves the title, subreddit, type and link as well.
  // A Reddit link post has no body, so an empty approvedText still counts as
  // approved; the hash comparison below covers the rest of the submission.
  const missingApprovalText =
    platform === 'reddit' ? draft.approvedText === undefined : !draft.approvedText;
  if (draft.status !== 'approved' || missingApprovalText || !draft.approvedAt) {
    throw new PublishError('Approve this draft before publishing it.', 'draft_not_approved');
  }
  const contentHash =
    platform === 'reddit'
      ? redditApprovalHash({
          title: draft.title,
          subreddit: draft.subreddit,
          submissionType: draft.submissionType,
          text: draft.text,
          linkUrl: draft.linkUrl,
        })
      : hashText(draft.text);
  if (draft.approvedText !== draft.text || draft.approvedHash !== contentHash) {
    throw new PublishError('The draft changed after approval. Approve it again.', 'draft_changed');
  }

  // Thread parts are checked again here, not only in the composer: approval is a
  // client-visible step and the limit must hold at send time.
  const parts = draftParts(draft);
  if (platform === 'x') {
    const problems = xThreadProblems(parts);
    if (problems.length) {
      throw new PublishError(problems[0], 'invalid_post');
    }
  }
  if (platform === 'reddit') {
    const problems = redditComposerChecks({
      title: draft.title,
      subreddit: draft.subreddit,
      submissionType: draft.submissionType,
      text: draft.text,
      linkUrl: draft.linkUrl,
    }).filter((check) => check.level === 'error');
    if (problems.length) throw new PublishError(problems[0].message, 'invalid_post');
  }

  const connection = await storage.findPlatformConnection(
    input.userId,
    project.id,
    platform
  );
  if (!connection) {
    throw new PublishError(
      isBot ? 'Connect a channel for this platform first.' : 'Connect an account for this platform first.',
      'connection_not_found'
    );
  }
  const destinationReady = isBot
    ? Boolean(connection.channelId)
    : Boolean(connection.externalAccountId) &&
      (platform !== 'mastodon' || Boolean(connection.instanceUrl)) &&
      // Slack posts to a selected channel, not just the installed workspace.
      (platform !== 'slack' || Boolean(connection.channelId));
  if (connection.status !== 'active' || !destinationReady) {
    throw new PublishError(
      isBot
        ? 'This connection is not active. Verify the channel again.'
        : 'This account connection is not active. Reconnect the account.',
      'connection_inactive'
    );
  }

  const existing = await storage.getPublication(draft.id, platform);
  if (existing?.status === 'sending') {
    throw sendingConflict(existing);
  }
  if (existing && (existing.status === 'published' || existing.externalId)) {
    throw new PublishError('This draft has already been published.', 'already_published');
  }
  // Once any part of a thread exists on X, restarting would duplicate posts.
  if (existing && existing.externalIds?.length) {
    throw new PublishError(
      'Part of this thread was already posted. Finish it by hand; Crewlink will not restart it.',
      'partial_thread'
    );
  }

  // Reddit rules are community-specific and can change. They are re-read here,
  // immediately before anything is claimed or sent, and are never taken from the
  // discovery cache.
  let redditSubreddit = String(draft.subreddit || '');
  if (platform === 'reddit') {
    if (!config.redditClientId || !config.redditClientSecret) {
      throw new PublishError(
        'Automatic Reddit publishing is not configured on this server.',
        'reddit_not_configured'
      );
    }
    try {
      const live = await validateRedditSubmissionLive({
        userId: input.userId,
        projectId: project.id,
        draft,
      });
      const errors = live.validation.checks.filter((check) => check.level === 'error');
      if (errors.length) {
        throw new PublishError(errors[0].message, 'invalid_post');
      }
      redditSubreddit = live.subreddit.name;
    } catch (err) {
      if (err instanceof PublishError) throw err;
      if (err instanceof ConnectionError) {
        throw new PublishError(err.message, 'connection_inactive');
      }
      if (err instanceof AdapterError) {
        if (err.code === 'rate_limited') {
          throw new PublishError(err.message, 'rate_limited', err.retryAfterSeconds);
        }
        if (err.code === 'token_expired' || err.code === 'revoked') {
          await storage.disconnectPlatformConnection(connection.id);
          throw new PublishError(
            'The Reddit connection is no longer valid. Reconnect the account.',
            'auth_revoked'
          );
        }
        if (err.code === 'invalid_input' || err.code === 'validation_error') {
          throw new PublishError(err.message, 'invalid_post');
        }
        throw new PublishError(
          'Crewlink could not verify this subreddit\'s rules, so nothing was sent.',
          'platform_error'
        );
      }
      throw err;
    }
  }

  // LinkedIn's API version is validated before anything is claimed, so a
  // malformed or too-old LINKEDIN_API_VERSION fails closed with a configuration
  // error instead of a failed publication.
  if (platform === 'linkedin') {
    if (!isLinkedInConfigured()) {
      throw new PublishError(
        'Automatic LinkedIn publishing is not configured on this server.',
        'linkedin_not_configured'
      );
    }
    try {
      resolveLinkedInApiVersion();
    } catch (err) {
      if (err instanceof LinkedInConfigError) {
        throw new PublishError(err.message, 'linkedin_not_configured');
      }
      throw err;
    }
  }

  // X has no free automatic path. The exact request count and price are shown
  // before anything is claimed or sent, and the budget is checked server-side.
  let xEstimate: XCostEstimate | undefined;
  if (platform === 'x') {
    if (!config.xClientId) {
      throw new PublishError(
        'Automatic X publishing is not configured on this server. Manual publishing is still free.',
        'x_not_configured'
      );
    }
    xEstimate = estimateXThread(parts);
    if (!input.confirmCost) {
      throw new PublishError(
        `This will cost about $${xEstimate.costUsd.toFixed(3)}. Confirm the estimated cost before automatic publishing.`,
        'cost_confirmation_required',
        undefined,
        xEstimate
      );
    }
    if (input.maxCostUsd !== undefined) {
      if (!Number.isFinite(input.maxCostUsd) || input.maxCostUsd < 0) {
        throw new PublishError('The confirmed cost limit is not valid.', 'invalid_input');
      }
      if (xEstimate.costUsd > input.maxCostUsd) {
        throw new PublishError(
          `The estimated $${xEstimate.costUsd.toFixed(3)} exceeds the confirmed limit of $${input.maxCostUsd.toFixed(3)}.`,
          'cost_limit_exceeded',
          undefined,
          xEstimate
        );
      }
    }
    const budget = await getXBudgetSummary();
    if (xEstimate.costMicros > budget.remainingMicros) {
      throw new PublishError(
        'The Crewlink X budget is exhausted for this month. Manual publishing is still free.',
        'budget_exhausted',
        undefined,
        xEstimate,
        budget
      );
    }
  }

  let publication: Publication;
  if (existing) {
    // A failed attempt with no external id may be retried manually. The claim is
    // conditional, so two concurrent retries can never both send.
    const retried = await storage.claimFailedPublication(existing.id);
    if (!retried) {
      const latest = await storage.getPublication(draft.id, platform);
      if (latest && (latest.status === 'published' || latest.externalId)) {
        throw new PublishError('This draft has already been published.', 'already_published');
      }
      if (latest?.status === 'sending') throw sendingConflict(latest);
      throw new PublishError('The publication record could not be updated.', 'send_failed');
    }
    publication = retried;
  } else {
    const claim = await storage.createPublicationIfAbsent({
      id: `pub_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      userId: input.userId,
      projectId: project.id,
      draftId: draft.id,
      connectionId: connection.id,
      platformId: platform,
      status: 'sending',
      mode: 'api',
      contentHash,
      externalIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (!claim.created) {
      const alreadyPublished = claim.publication.status === 'published';
      throw new PublishError(
        alreadyPublished
          ? 'This draft has already been published.'
          : 'This draft is already being published.',
        alreadyPublished ? 'already_published' : 'in_progress'
      );
    }
    publication = claim.publication;
  }

  const connectionSummary = {
    id: connection.id,
    platformId: connection.platformId,
    serverName: connection.serverName,
    channelName: connection.channelName,
  };

  // Reserve budget before the first request. A definitive failure below releases
  // it; a success or an uncertain outcome keeps it counted.
  let xLedgerId: string | undefined;
  if (platform === 'x' && xEstimate) {
    try {
      const entry = await reserveXUsage({
        userId: input.userId,
        projectId: project.id,
        draftId: draft.id,
        publicationId: publication.id,
        mode: 'api',
        requestCount: xEstimate.requests,
        costMicros: xEstimate.costMicros,
      });
      xLedgerId = entry.id;
    } catch (err) {
      logger.error('X cost reservation failed', err, { publicationId: publication.id });
      await storage.updatePublication(publication.id, {
        status: 'failed',
        errorCode: 'cost_ledger_error',
      });
      throw new PublishError(
        'The X cost record could not be written, so nothing was sent.',
        'send_failed'
      );
    }
  }

  let externalId: string;
  let externalUrl: string | undefined;
  const externalIds: string[] = [];
  try {
    if (isBot) {
      const botToken = await loadBotToken(platform as BotPlatform);
      const sent = await getBotClient(platform as BotPlatform).sendMessage(
        botToken,
        connection.channelId!,
        draft.text
      );
      externalId = sent.externalId;
      externalIds.push(externalId);
    } else {
      let tokens = await decryptConnectionTokens(connection);
      if (platform === 'bluesky') {
        const sent = await getBlueskyClient().sendPost({
          tokens,
          account: {
            externalAccountId: connection.externalAccountId!,
            externalAccountName:
              connection.externalAccountName || connection.externalAccountId!,
          },
          text: draft.text,
          refreshKey: connection.id,
        });
        externalId = sent.externalId;
        externalIds.push(externalId);
        if (sent.tokens) {
          // The post is already live; a token-save failure must not turn it
          // into a failed or uncertain publication.
          try {
            await persistConnectionTokens(connection, sent.tokens);
          } catch {
            logger.warn('Refreshed account tokens could not be saved', {
              publicationId: publication.id,
              platformId: platform,
            });
          }
        }
      } else if (platform === 'mastodon') {
        const sent = await getMastodonClient().sendStatus({
          instanceUrl: connection.instanceUrl!,
          accessToken: tokens.accessToken,
          text: draft.text,
          // Mastodon deduplicates a repeated key, so a manual retry after a
          // definitive failure cannot create a second status.
          idempotencyKey: publication.id,
        });
        externalId = sent.externalId;
        externalIds.push(externalId);
      } else if (platform === 'reddit') {
        // One submission per publication row. Reddit has no idempotency key, so
        // an ambiguous outcome must stay uncertain rather than be retried.
        const client = getRedditClient();
        const refreshReddit = async () => {
          if (!tokens.refreshToken) {
            throw new AdapterError('Reddit needs a new sign-in.', 'revoked');
          }
          tokens = await client.refreshSession({
            clientId: config.redditClientId,
            clientSecret: config.redditClientSecret,
            refreshToken: tokens.refreshToken,
          });
          try {
            await persistConnectionTokens(connection, tokens);
          } catch {
            logger.warn('Refreshed Reddit tokens could not be saved', {
              publicationId: publication.id,
              platformId: 'reddit',
            });
          }
        };

        if (
          tokens.refreshToken &&
          tokens.tokenExpiresAt &&
          Date.parse(tokens.tokenExpiresAt) - Date.now() <= 60_000
        ) {
          await refreshReddit();
        }

        const kind = draft.submissionType === 'link' ? 'link' : 'self';
        const title = String(draft.title || '').trim();
        if (!title || !redditSubreddit) {
          throw new AdapterError('This Reddit draft is incomplete.', 'invalid_input');
        }
        const send = () =>
          client.submit({
            tokens,
            subreddit: redditSubreddit,
            kind,
            title,
            body: kind === 'self' ? draft.text : undefined,
            url: kind === 'link' ? draft.linkUrl : undefined,
          });
        let sent;
        try {
          sent = await send();
        } catch (err) {
          if (err instanceof AdapterError && err.code === 'token_expired') {
            await refreshReddit();
            sent = await send();
          } else {
            throw err;
          }
        }
        externalId = sent.externalId;
        externalUrl = sent.externalUrl;
        externalIds.push(externalId);
      } else if (platform === 'slack') {
        // The channel and bot token both come from the stored connection; the
        // browser never supplies either. Slack returns HTTP 200 on failure, so
        // the adapter checks `ok` before reporting the message as sent.
        const channelId = connection.channelId;
        if (!channelId) {
          throw new AdapterError('Choose a Slack channel first.', 'invalid_input');
        }
        const sent = await getSlackClient().sendMessage({
          tokens,
          channelId,
          text: draft.text,
        });
        externalId = sent.externalId;
        externalIds.push(externalId);
      } else if (platform === 'linkedin') {
        // The author URN comes from the verified connection, never from the
        // draft or request body. LinkedIn has no idempotency key, so an
        // ambiguous outcome must stay uncertain rather than be retried.
        const client = getLinkedInClient();
        const refreshLinkedIn = async () => {
          if (!tokens.refreshToken) {
            throw new AdapterError('LinkedIn needs a new sign-in.', 'revoked');
          }
          tokens = await client.refreshSession({
            clientId: config.linkedinClientId,
            clientSecret: config.linkedinClientSecret,
            refreshToken: tokens.refreshToken,
          });
          try {
            await persistConnectionTokens(connection, tokens);
          } catch {
            logger.warn('Refreshed LinkedIn tokens could not be saved', {
              publicationId: publication.id,
              platformId: 'linkedin',
            });
          }
        };

        // Most LinkedIn apps receive no refresh token, so this only runs for
        // connections where LinkedIn actually issued one.
        if (
          tokens.refreshToken &&
          tokens.tokenExpiresAt &&
          Date.parse(tokens.tokenExpiresAt) - Date.now() <= 60_000
        ) {
          await refreshLinkedIn();
        }

        const authorId = connection.externalAccountId!;
        const send = () =>
          client.sendPost({ tokens, authorId, text: draft.text });
        let sent;
        try {
          sent = await send();
        } catch (err) {
          if (err instanceof AdapterError && err.code === 'token_expired') {
            await refreshLinkedIn();
            sent = await send();
          } else {
            throw err;
          }
        }
        externalId = sent.externalId;
        externalUrl = sent.externalUrl;
        externalIds.push(externalId);
      } else {
        // X posts a thread sequentially so every reply targets the id returned
        // by the previous request. A refresh is attempted once for an expired
        // token; the post that failed with 401 was never created.
        const client = getXClient();
        const refresh = async () => {
          if (!tokens.refreshToken) throw new AdapterError('X needs a new sign-in.', 'revoked');
          tokens = await client.refreshSession({
            clientId: config.xClientId,
            clientSecret: config.xClientSecret || undefined,
            refreshToken: tokens.refreshToken,
          });
          try {
            await persistConnectionTokens(connection, tokens);
          } catch {
            logger.warn('Refreshed X tokens could not be saved', {
              publicationId: publication.id,
              platformId: 'x',
            });
          }
        };

        // Refresh proactively when the access token is about to expire.
        if (
          tokens.refreshToken &&
          tokens.tokenExpiresAt &&
          Date.parse(tokens.tokenExpiresAt) - Date.now() <= 60_000
        ) {
          await refresh();
        }

        for (let index = 0; index < parts.length; index += 1) {
          const send = () =>
            client.sendPost({
              tokens,
              text: parts[index],
              replyToId: index > 0 ? externalIds[index - 1] : undefined,
            });
          let sent;
          try {
            sent = await send();
          } catch (err) {
            if (err instanceof AdapterError && err.code === 'token_expired') {
              await refresh();
              sent = await send();
            } else {
              throw err;
            }
          }
          externalIds.push(sent.externalId);
        }
        externalId = externalIds[0];
      }
    }
  } catch (err) {
    if (err instanceof AdapterError) {
      // Tokens refreshed before the failure are still worth keeping.
      if (err.tokens) {
        try {
          await persistConnectionTokens(connection, err.tokens);
        } catch {
          logger.warn('Refreshed account tokens could not be saved', {
            publicationId: publication.id,
            platformId: platform,
          });
        }
      }

      if (err.code === 'uncertain') {
        // Leave the row `sending`. A stale sending row is surfaced as uncertain
        // and is never retried automatically or manually. Any ids returned by
        // earlier thread parts are kept so the owner can finish by hand.
        if (platform === 'x' && externalIds.length > 0) {
          await storage.updatePublication(publication.id, { externalIds: [...externalIds] });
        }
        if (xLedgerId) await settleXUsage(xLedgerId, 'committed');
        logger.warn('Publication outcome is uncertain', {
          publicationId: publication.id,
          platformId: platform,
        });
        throw new PublishError(
          'The result is uncertain. Check the account; Crewlink will not resend this automatically.',
          'uncertain'
        );
      }

      // A thread that already posted at least one part must never restart from
      // the beginning, so it becomes a non-retryable partial failure.
      if (platform === 'x' && externalIds.length > 0) {
        await storage.updatePublication(publication.id, {
          status: 'failed',
          errorCode: 'partial_thread',
          externalIds: [...externalIds],
        });
        if (xLedgerId) await settleXUsage(xLedgerId, 'committed');
        logger.warn('X thread stopped after a partial success', {
          publicationId: publication.id,
          posted: externalIds.length,
        });
        throw new PublishError(
          'Part of this thread was published. Crewlink will not restart it; check X and finish the remaining posts by hand.',
          'partial_thread'
        );
      }

      const mapped =
        err instanceof SlackError ? slackAdapterFailure(err) : adapterFailure(err);
      await storage.updatePublication(publication.id, {
        status: 'failed',
        errorCode: mapped.errorCode,
      });
      if (xLedgerId) await settleXUsage(xLedgerId, 'released');
      if (mapped.errorCode === 'auth_revoked') {
        // Revoked credentials must not leave an active connection behind.
        await storage.disconnectPlatformConnection(connection.id);
      }
      logger.warn('Draft publication failed', {
        publicationId: publication.id,
        platformId: platform,
        errorCode: mapped.errorCode,
      });
      throw new PublishError(
        err.message,
        mapped.publishCode,
        err.retryAfterSeconds
      );
    }

    if (xLedgerId) await settleXUsage(xLedgerId, 'released');

    if (err instanceof ConnectionError) {
      await storage.updatePublication(publication.id, {
        status: 'failed',
        errorCode: 'auth_revoked',
      });
      logger.warn('Connected account could not be used', {
        publicationId: publication.id,
        platformId: platform,
        errorCode: err.code,
      });
      throw new PublishError(err.message, 'connection_inactive');
    }

    if (err instanceof BotError) {
      await storage.updatePublication(publication.id, {
        status: 'failed',
        errorCode: err.code,
      });
      logger.warn('Draft publication failed', {
        publicationId: publication.id,
        platformId: platform,
        errorCode: err.code,
      });
      if (err.code === 'bot_token_missing') {
        throw new PublishError('The Crewlink bot is not configured for this platform.', err.code);
      }
      throw new PublishError(err.message, 'send_failed', err.retryAfterSeconds);
    }

    await storage.updatePublication(publication.id, {
      status: 'failed',
      errorCode: 'transport_error',
    });
    logger.error('Draft publication failed unexpectedly', err, {
      publicationId: publication.id,
      platformId: platform,
    });
    throw new PublishError('The platform could not be reached.', 'send_failed');
  }

  let published: Publication | null;
  try {
    published = await storage.updatePublication(publication.id, {
      status: 'published',
      mode: 'api',
      externalId,
      externalIds: [...externalIds],
      ...(platform === 'reddit'
        ? { targetName: redditSubreddit, externalUrl }
        : platform === 'linkedin'
          ? { externalUrl }
          : platform === 'slack'
            // The channel id is the destination that actually received the
            // message, kept even if the connection is later re-pointed.
            ? { targetName: connection.channelId }
            : {}),
      confirmedAt: new Date().toISOString(),
    });
  } catch (err) {
    // The message may already be live. Leaving the row as `sending` makes the
    // state uncertain and blocks any automatic or manual resend.
    logger.error('Publication sent but could not be recorded', err, {
      publicationId: publication.id,
      platformId: platform,
    });
    throw new PublishError(
      'The message may have been posted, but Crewlink could not record it. Check the account before retrying.',
      'uncertain'
    );
  }
  if (!published) {
    throw new PublishError(
      'The message may have been posted, but Crewlink could not record it. Check the channel before retrying.',
      'uncertain'
    );
  }
  if (xLedgerId) await settleXUsage(xLedgerId, 'committed');

  logger.info('Draft published', {
    publicationId: published.id,
    platformId: platform,
    platformMessageId: externalId,
  });

  return { publication: published, connection: connectionSummary, estimate: xEstimate };
}

// --- Manual X publishing ---
// This path never contacts X. It records the owner's statement that they posted
// by hand, with mode `manual`, and never claims that Crewlink verified it.
export async function markPublishedManually(input: {
  userId: string;
  draftId: string;
}): Promise<{ publication: Publication; verified: false }> {
  const draftId = String(input.draftId || '').trim();
  if (!draftId) throw new PublishError('Choose a draft to mark.', 'invalid_input');

  const draft = await storage.getDraftById(draftId);
  if (!draft) throw new PublishError('Draft not found.', 'draft_not_found');
  if (draft.platformId !== 'x') {
    throw new PublishError('Manual publishing here is only for X.', 'unsupported_platform');
  }

  const project = await storage.getProjectById(draft.projectId);
  if (!project) throw new PublishError('Project not found.', 'project_not_found');
  if (project.ownerId !== input.userId) {
    throw new PublishError('Only the project owner can mark this draft as published.', 'forbidden');
  }

  if (draft.status !== 'approved' || !draft.approvedText || !draft.approvedAt) {
    throw new PublishError('Approve this draft before marking it published.', 'draft_not_approved');
  }
  const contentHash = hashText(draft.text);
  if (draft.approvedText !== draft.text || draft.approvedHash !== contentHash) {
    throw new PublishError('The draft changed after approval. Approve it again.', 'draft_changed');
  }
  const problems = xThreadProblems(draftParts(draft));
  if (problems.length) throw new PublishError(problems[0], 'invalid_post');

  const existing = await storage.getPublication(draft.id, 'x');
  if (existing?.status === 'sending') throw sendingConflict(existing);
  if (existing && (existing.status === 'published' || existing.externalId)) {
    throw new PublishError('This draft has already been published.', 'already_published');
  }
  if (existing?.externalIds.length) {
    throw new PublishError(
      'Part of this thread was already posted. Finish it on X instead of marking it manually.',
      'partial_thread'
    );
  }

  const now = new Date().toISOString();
  if (existing) {
    const claimed = await storage.claimFailedPublication(existing.id);
    if (!claimed) {
      const latest = await storage.getPublication(draft.id, 'x');
      if (latest?.status === 'sending') throw sendingConflict(latest);
      throw new PublishError('The publication record could not be updated.', 'send_failed');
    }
    const updated = await storage.updatePublication(claimed.id, {
      status: 'published',
      mode: 'manual',
      externalIds: [],
      confirmedAt: now,
    });
    if (!updated) throw new PublishError('Failed to record the draft.', 'send_failed');
    return { publication: updated, verified: false };
  }

  const claim = await storage.createPublicationIfAbsent({
    id: `pub_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    userId: input.userId,
    projectId: project.id,
    draftId: draft.id,
    connectionId: undefined,
    platformId: 'x',
    status: 'published',
    mode: 'manual',
    contentHash,
    externalIds: [],
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  if (!claim.created) {
    const already = claim.publication.status === 'published';
    throw new PublishError(
      already
        ? 'This draft has already been published.'
        : 'This draft is already being published.',
      already ? 'already_published' : 'in_progress'
    );
  }
  return { publication: claim.publication, verified: false };
}

export default { publishDraft, markPublishedManually };
