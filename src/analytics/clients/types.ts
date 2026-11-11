import type { Publication, StoredPlatformConnection } from '../../types/index';
import type { AdapterTokens } from '../../posting/adapters/types';
import type { LookupFn } from '../../posting/adapters/ssrf';
import type { AnalyticsPlatformId } from '../types';

// Analytics clients are read-only. They receive decrypted tokens in memory for
// the duration of one sync call and never persist, log or return them.
export interface AnalyticsFetchContext {
  connection: StoredPlatformConnection;
  tokens?: AdapterTokens;
  // Application-level bot token for Discord/Telegram. Never a user token.
  botToken?: string;
}

export interface AccountMetricsResult {
  // Raw platform fields; normalization happens in metrics.ts.
  metrics: Record<string, unknown>;
  externalAccountId?: string;
  externalAccountName?: string;
}

export interface PostMetricsResult {
  metrics: Record<string, unknown>;
  externalUrl?: string;
}

export interface AnalyticsClient {
  readonly platform: AnalyticsPlatformId;
  fetchAccount(input: AnalyticsFetchContext): Promise<AccountMetricsResult>;
  fetchPost(
    input: AnalyticsFetchContext & { publication: Publication }
  ): Promise<PostMetricsResult>;
}

export type AnalyticsClientErrorCode =
  | 'rate_limited'
  | 'auth_revoked'
  | 'token_expired'
  | 'permission_missing'
  | 'needs_approval'
  | 'unsupported'
  | 'not_found'
  | 'platform_error'
  | 'transport_error';

export class AnalyticsClientError extends Error {
  constructor(
    message: string,
    readonly code: AnalyticsClientErrorCode,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'AnalyticsClientError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface LiveClientOptions {
  fetchImpl?: FetchLike;
  // Tests set this to 0 so a bounded retry does not slow the suite.
  retryDelayMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  // Mastodon instance URLs are resolved and pinned; tests inject a lookup.
  lookup?: LookupFn;
}
