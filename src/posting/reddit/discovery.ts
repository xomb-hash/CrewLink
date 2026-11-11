import { config } from '../../config/index';
import { storage } from '../../lib/storage';
import { logger } from '../../lib/logger';
import {
  ConnectionError,
  decryptConnectionTokens,
  persistConnectionTokens,
} from '../connections';
import { getRedditClient } from '../adapters/index';
import { AdapterError } from '../adapters/types';
import type {
  AdapterTokens,
  RedditClientLike,
  RedditPostRequirements,
  RedditRule,
  RedditSubreddit,
} from '../adapters/types';
import type { Draft, StoredPlatformConnection } from '../../types/index';
import {
  draftAsRedditInput,
  redditLiveChecks,
  type RedditValidation,
} from './validate';

const ABOUT_TTL_MS = 5 * 60 * 1000;
const SEARCH_TTL_MS = 5 * 60 * 1000;
// Requirements are account- and community-specific and are never cached for the
// authoritative pre-publish check below.
const REQUIREMENTS_TTL_MS = 60 * 1000;

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function resetRedditCacheForTests(): void {
  cache.clear();
}

function cacheGet<T>(key: string, ttlMs: number): CacheEntry<T> | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function cacheSet<T>(key: string, value: T): CacheEntry<T> {
  const entry = { value, cachedAt: Date.now() };
  cache.set(key, entry);
  return entry;
}

async function loadRedditSession(
  userId: string,
  projectId: string
): Promise<{ connection: StoredPlatformConnection; tokens: AdapterTokens }> {
  const connection = await storage.findPlatformConnection(userId, projectId, 'reddit');
  if (!connection) {
    throw new ConnectionError(
      'Connect a Reddit account for this project first.',
      'connection_not_found'
    );
  }
  if (connection.status !== 'active' || !connection.externalAccountId) {
    throw new ConnectionError(
      'The Reddit connection is not active. Reconnect the account.',
      'connection_inactive'
    );
  }

  const tokens = await decryptConnectionTokens(connection);
  // Refresh a token that is about to expire before the first request.
  if (
    tokens.refreshToken &&
    tokens.tokenExpiresAt &&
    Date.parse(tokens.tokenExpiresAt) - Date.now() <= 60_000 &&
    config.redditClientId &&
    config.redditClientSecret
  ) {
    const refreshed = await getRedditClient().refreshSession({
      clientId: config.redditClientId,
      clientSecret: config.redditClientSecret,
      refreshToken: tokens.refreshToken,
    });
    const saved = await persistConnectionTokens(connection, refreshed);
    return { connection: saved, tokens: refreshed };
  }
  return { connection, tokens };
}

// Runs one discovery request and retries once after refreshing an expired token.
// Discovery never mutates approvals or publications.
async function withRedditSession<T>(
  userId: string,
  projectId: string,
  fn: (client: RedditClientLike, tokens: AdapterTokens) => Promise<T>
): Promise<T> {
  const client = getRedditClient();
  let { connection, tokens } = await loadRedditSession(userId, projectId);
  try {
    return await fn(client, tokens);
  } catch (err) {
    if (
      err instanceof AdapterError &&
      err.code === 'token_expired' &&
      tokens.refreshToken &&
      config.redditClientId &&
      config.redditClientSecret
    ) {
      tokens = await client.refreshSession({
        clientId: config.redditClientId,
        clientSecret: config.redditClientSecret,
        refreshToken: tokens.refreshToken,
      });
      try {
        await persistConnectionTokens(connection, tokens);
      } catch (saveError) {
        logger.warn('Refreshed Reddit tokens could not be saved', {
          connectionId: connection.id,
          error: saveError instanceof Error ? saveError.name : 'unknown',
        });
      }
      return fn(client, tokens);
    }
    throw err;
  }
}

export interface RedditSearchResult {
  subreddits: RedditSubreddit[];
  cachedAt: string;
}

export async function searchRedditSubreddits(
  userId: string,
  projectId: string,
  query: string
): Promise<RedditSearchResult> {
  const value = String(query || '').trim().slice(0, 100);
  if (!value) return { subreddits: [], cachedAt: new Date().toISOString() };
  const key = `search:${userId}:${projectId}:${value.toLowerCase()}`;
  const cached = cacheGet<RedditSubreddit[]>(key, SEARCH_TTL_MS);
  if (cached) {
    return {
      subreddits: cached.value,
      cachedAt: new Date(cached.cachedAt).toISOString(),
    };
  }
  const subreddits = await withRedditSession(userId, projectId, (client, tokens) =>
    client.searchSubreddits(tokens.accessToken, value)
  );
  const entry = cacheSet(key, subreddits);
  return { subreddits, cachedAt: new Date(entry.cachedAt).toISOString() };
}

export interface RedditSubredditDetails {
  subreddit: RedditSubreddit;
  rules: RedditRule[];
  requirements: RedditPostRequirements;
  cachedAt: string;
}

export async function getRedditSubredditDetails(
  userId: string,
  projectId: string,
  name: string
): Promise<RedditSubredditDetails> {
  // The project is part of the key so one project's account cannot answer a
  // request made for another project.
  const key = `about:${userId}:${projectId}:${String(name || '').toLowerCase()}`;
  const cachedRules = cacheGet<RedditRule[]>(`rules:${key}`, ABOUT_TTL_MS);
  const cachedAbout = cacheGet<RedditSubreddit>(key, ABOUT_TTL_MS);
  const cachedRequirements = cacheGet<RedditPostRequirements>(
    `requirements:${key}`,
    REQUIREMENTS_TTL_MS
  );

  if (cachedAbout && cachedRules && cachedRequirements) {
    return {
      subreddit: cachedAbout.value,
      rules: cachedRules.value,
      requirements: cachedRequirements.value,
      cachedAt: new Date(cachedAbout.cachedAt).toISOString(),
    };
  }

  const [subreddit, rules, requirements] = await withRedditSession(
    userId,
    projectId,
    async (client, tokens) => {
      const about = await client.getSubreddit(tokens.accessToken, name);
      const rulesValue = await client.getRules(tokens.accessToken, about.name);
      const requirementsValue = await client.getPostRequirements(
        tokens.accessToken,
        about.name
      );
      return [about, rulesValue, requirementsValue] as const;
    }
  );

  const about = cacheSet(key, subreddit);
  cacheSet(`rules:${key}`, rules);
  cacheSet(`requirements:${key}`, requirements);
  return {
    subreddit,
    rules,
    requirements,
    cachedAt: new Date(about.cachedAt).toISOString(),
  };
}

// Authoritative check immediately before a submission. It deliberately bypasses
// the cache and re-reads the subreddit, its rules and its requirements.
export async function validateRedditSubmissionLive(input: {
  userId: string;
  projectId: string;
  draft: Draft;
}): Promise<{
  validation: RedditValidation;
  subreddit: RedditSubreddit;
  requirements: RedditPostRequirements;
}> {
  const subredditName = String(input.draft.subreddit || '');
  const result = await withRedditSession(
    input.userId,
    input.projectId,
    async (client, tokens) => {
      const subreddit = await client.getSubreddit(tokens.accessToken, subredditName);
      const [rules, requirements] = await Promise.all([
        client.getRules(tokens.accessToken, subreddit.name),
        client.getPostRequirements(tokens.accessToken, subreddit.name),
      ]);
      return { subreddit, rules, requirements };
    }
  );

  const validation = redditLiveChecks({
    draft: draftAsRedditInput(input.draft),
    subreddit: result.subreddit,
    requirements: result.requirements,
    rules: result.rules,
  });
  return { validation, subreddit: result.subreddit, requirements: result.requirements };
}

export default {
  searchRedditSubreddits,
  getRedditSubredditDetails,
  validateRedditSubmissionLive,
  resetRedditCacheForTests,
};
