import crypto from 'node:crypto';
import { config } from '../../config/index';
import { graphemes } from '../checks';
import {
  AdapterError,
  type AdapterTokens,
  type BlueskyClientLike,
  type OAuthSession,
  type PostResult,
  type VerifiedAccount,
} from './types';
import {
  asRecord,
  request,
  retryAfterSeconds,
  type FetchLike,
} from './http';

export const BLUESKY_GRAPHEME_LIMIT = 300;
export const BLUESKY_BYTE_LIMIT = 3000;
const POST_COLLECTION = 'app.bsky.feed.post';
// A refreshed session is reused briefly for the same connection so two requests
// that loaded the same old refresh token cannot rotate it twice.
const REFRESH_REUSE_MS = 60_000;
const refreshInFlight = new Map<string, Promise<OAuthSession>>();
const recentRefreshes = new Map<string, { session: OAuthSession; expiresAt: number }>();

export function resetBlueskyRefreshStateForTests(): void {
  refreshInFlight.clear();
  recentRefreshes.clear();
}

function serviceBase(serviceUrl?: string): string {
  const value = String(serviceUrl || config.blueskyServiceUrl || 'https://bsky.social').trim();
  return value.replace(/\/+$/, '');
}

// Cache key must change when the refresh token changes: after a rotation or an
// account switch, a cached session from the old token must never be reused.
function refreshCacheKey(refreshKey: string | undefined, refreshToken: string): string {
  if (!refreshKey) return `token:${refreshToken}`;
  const fingerprint = crypto
    .createHash('sha256')
    .update(refreshToken)
    .digest('hex')
    .slice(0, 16);
  return `connection:${refreshKey}:${fingerprint}`;
}

// Access JWTs carry their expiry. It is read for proactive refresh only; the
// token is never decoded for identity or trusted as authorisation.
function jwtExpiry(token: string): string | undefined {
  const payload = String(token || '').split('.')[1];
  if (!payload) return undefined;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    const exp = Number(data.exp);
    return Number.isFinite(exp) ? new Date(exp * 1000).toISOString() : undefined;
  } catch {
    return undefined;
  }
}

function errorName(data: unknown): string {
  const record = asRecord(data);
  return String(record.error || record.message || '');
}

function mapError(
  status: number,
  data: unknown,
  headers: Headers,
  context: 'session' | 'read' | 'post'
): AdapterError {
  if (status === 429) {
    return new AdapterError(
      'Bluesky is rate limiting requests. Try again shortly.',
      'rate_limited',
      retryAfterSeconds(headers)
    );
  }

  const name = errorName(data);

  if (context === 'session') {
    if (status === 400 || status === 401) {
      return new AdapterError(
        'Bluesky rejected the handle or app password.',
        'auth_failed'
      );
    }
    return new AdapterError('Bluesky returned an unexpected error.', 'instance_error');
  }

  if (context === 'read') {
    if (status === 401 || status === 403) {
      return new AdapterError(
        'The Bluesky session is no longer valid. Reconnect the account.',
        'revoked'
      );
    }
    return new AdapterError('Bluesky returned an unexpected error.', 'instance_error');
  }

  if (status === 401 && /expired/i.test(name)) {
    return new AdapterError('The Bluesky session expired.', 'token_expired');
  }
  if (status === 401 || status === 403) {
    return new AdapterError(
      'The Bluesky session was revoked. Reconnect the account.',
      'revoked'
    );
  }
  if (status === 400 || status === 422) {
    return new AdapterError(
      'Bluesky rejected the post text. Edit the draft and approve it again.',
      'validation_error'
    );
  }
  return new AdapterError('Bluesky returned an unexpected error.', 'instance_error');
}

function toSession(data: unknown): OAuthSession {
  const record = asRecord(data);
  const accessToken = String(record.accessJwt || '');
  const refreshToken = String(record.refreshJwt || '');
  const did = String(record.did || '');
  const handle = String(record.handle || '').replace(/^@/, '');
  if (!accessToken || !did || !handle) {
    throw new AdapterError(
      'Bluesky accepted the sign-in but returned an incomplete session.',
      'instance_error'
    );
  }
  return {
    tokens: {
      accessToken,
      refreshToken: refreshToken || undefined,
      tokenExpiresAt: jwtExpiry(accessToken),
    },
    account: { externalAccountId: did, externalAccountName: handle },
  };
}

function validatePostText(text: string): string {
  const value = String(text || '');
  if (!value.trim()) {
    throw new AdapterError('The draft is empty.', 'validation_error');
  }
  if (graphemes(value) > BLUESKY_GRAPHEME_LIMIT) {
    throw new AdapterError(
      `Bluesky posts are limited to ${BLUESKY_GRAPHEME_LIMIT} grapheme clusters.`,
      'validation_error'
    );
  }
  if (Buffer.byteLength(value, 'utf8') > BLUESKY_BYTE_LIMIT) {
    throw new AdapterError(
      `Bluesky posts are limited to ${BLUESKY_BYTE_LIMIT} bytes.`,
      'validation_error'
    );
  }
  return value;
}

function isExpired(tokenExpiresAt?: string): boolean {
  if (!tokenExpiresAt) return false;
  const expiry = new Date(tokenExpiresAt).getTime();
  return Number.isFinite(expiry) && expiry - 30_000 <= Date.now();
}

export class BlueskyClient implements BlueskyClientLike {
  readonly platform = 'bluesky' as const;
  private base: string;
  private fetchImpl?: FetchLike;

  constructor(options: { fetchImpl?: FetchLike; serviceUrl?: string } = {}) {
    this.base = serviceBase(options.serviceUrl);
    this.fetchImpl = options.fetchImpl;
  }

  private async call(
    path: string,
    init: {
      method?: 'GET' | 'POST';
      accessToken?: string;
      body?: unknown;
      networkErrorCode?: 'transport_error' | 'uncertain';
    } = {}
  ) {
    return request(`${this.base}${path}`, {
      method: init.method,
      body: init.body === undefined ? undefined : { json: init.body },
      headers: init.accessToken ? { authorization: `Bearer ${init.accessToken}` } : {},
      fetchImpl: this.fetchImpl,
      networkErrorCode: init.networkErrorCode,
    });
  }

  async createSession(identifier: string, appPassword: string): Promise<OAuthSession> {
    const handle = String(identifier || '').trim();
    const password = String(appPassword || '').trim();
    if (!handle || !password) {
      throw new AdapterError('Enter your Bluesky handle and app password.', 'invalid_input');
    }
    const response = await this.call('/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      body: { identifier: handle, password },
    });
    if (!response.ok) {
      throw mapError(response.status, response.data, response.headers, 'session');
    }
    return toSession(response.data);
  }

  async getSession(accessToken: string): Promise<VerifiedAccount> {
    const response = await this.call('/xrpc/com.atproto.server.getSession', {
      accessToken,
    });
    if (!response.ok) {
      throw mapError(response.status, response.data, response.headers, 'read');
    }
    const record = asRecord(response.data);
    const did = String(record.did || '');
    const handle = String(record.handle || '').replace(/^@/, '');
    if (!did || !handle) {
      throw new AdapterError('Bluesky returned an incomplete session.', 'instance_error');
    }
    return { externalAccountId: did, externalAccountName: handle };
  }

  // Concurrent callers for the same connection share one refresh request, and
  // the result is reused briefly. Without the key (direct adapter use) only
  // in-flight refreshes are shared.
  async refreshSession(refreshToken: string, refreshKey?: string): Promise<OAuthSession> {
    const key = refreshCacheKey(refreshKey, refreshToken);
    const cached = recentRefreshes.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.session;

    const inFlight = refreshInFlight.get(key);
    if (inFlight) return inFlight;

    const promise = this.requestRefresh(refreshToken)
      .then((session) => {
        if (refreshKey) {
          for (const [entry, value] of recentRefreshes) {
            if (value.expiresAt <= Date.now()) recentRefreshes.delete(entry);
          }
          recentRefreshes.set(key, { session, expiresAt: Date.now() + REFRESH_REUSE_MS });
        }
        return session;
      })
      .finally(() => {
        refreshInFlight.delete(key);
      });
    refreshInFlight.set(key, promise);
    return promise;
  }

  private async requestRefresh(refreshToken: string): Promise<OAuthSession> {
    const response = await this.call('/xrpc/com.atproto.server.refreshSession', {
      method: 'POST',
      accessToken: refreshToken,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AdapterError(
          'The Bluesky session was revoked. Reconnect the account.',
          'revoked'
        );
      }
      throw mapError(response.status, response.data, response.headers, 'read');
    }
    return toSession(response.data);
  }

  async sendPost(input: {
    tokens: AdapterTokens;
    account: VerifiedAccount;
    text: string;
    refreshKey?: string;
  }): Promise<PostResult> {
    const text = validatePostText(input.text);
    const repo = String(input.account.externalAccountId || '');
    if (!repo.startsWith('did:')) {
      throw new AdapterError('The connected Bluesky account is incomplete.', 'invalid_input');
    }

    let tokens = input.tokens;
    let refreshed = false;

    const refresh = async () => {
      if (!tokens.refreshToken) {
        throw new AdapterError(
          'The Bluesky session expired. Reconnect the account.',
          'token_expired'
        );
      }
      tokens = (await this.refreshSession(tokens.refreshToken, input.refreshKey)).tokens;
      refreshed = true;
    };

    if (isExpired(tokens.tokenExpiresAt)) await refresh();

    const createRecord = async () => {
      const response = await this.call('/xrpc/com.atproto.repo.createRecord', {
        method: 'POST',
        accessToken: tokens.accessToken,
        networkErrorCode: 'uncertain',
        body: {
          repo,
          collection: POST_COLLECTION,
          record: {
            $type: POST_COLLECTION,
            text,
            createdAt: new Date().toISOString(),
          },
        },
      });
      if (!response.ok) {
        const mapped = mapError(response.status, response.data, response.headers, 'post');
        throw new AdapterError(
          mapped.message,
          mapped.code,
          mapped.retryAfterSeconds,
          refreshed ? tokens : undefined
        );
      }
      return response;
    };

    let response: Awaited<ReturnType<typeof createRecord>>;
    try {
      response = await createRecord();
    } catch (err) {
      if (err instanceof AdapterError && err.code === 'token_expired' && tokens.refreshToken) {
        await refresh();
        try {
          response = await createRecord();
        } catch (retryErr) {
          if (retryErr instanceof AdapterError) {
            throw new AdapterError(
              retryErr.message,
              retryErr.code,
              retryErr.retryAfterSeconds,
              refreshed ? tokens : undefined
            );
          }
          throw retryErr;
        }
      } else {
        // A refreshed session must survive an ambiguous send: the old refresh
        // token was already rotated, so dropping the new one would strand the
        // connection even though the post may not exist.
        if (err instanceof AdapterError && refreshed && !err.tokens) {
          throw new AdapterError(
            err.message,
            err.code,
            err.retryAfterSeconds,
            tokens
          );
        }
        throw err;
      }
    }

    const uri = String(asRecord(response.data).uri || '');
    if (!uri.startsWith('at://')) {
      throw new AdapterError(
        'Bluesky accepted the post but returned no URI. Check the account before retrying.',
        'uncertain',
        undefined,
        refreshed ? tokens : undefined
      );
    }
    const rkey = uri.split('/').filter(Boolean).pop() || '';
    const handle = input.account.externalAccountName;

    return {
      externalId: uri,
      externalUrl: handle && rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : undefined,
      tokens: refreshed ? tokens : undefined,
    };
  }
}

// Deterministic fake used unless PUBLISHING_TRANSPORT=live, matching the Discord
// and Telegram mock pattern. It never contacts Bluesky.
let mockCounter = 0;

export function resetMockBlueskyState(): void {
  mockCounter = 0;
}

const MOCK_ACCESS_PREFIX = 'mock-bsky-access.';
const MOCK_REFRESH_PREFIX = 'mock-bsky-refresh.';

function mockHandle(value: string, prefix: string): string | null {
  if (!value.startsWith(prefix)) return null;
  try {
    return Buffer.from(value.slice(prefix.length), 'base64url').toString('utf8') || null;
  } catch {
    return null;
  }
}

function mockAccount(handle: string): VerifiedAccount {
  const slug = handle.toLowerCase().replace(/[^a-z0-9]/g, '') || 'mock';
  return { externalAccountId: `did:plc:${slug}`, externalAccountName: handle };
}

export class MockBlueskyClient implements BlueskyClientLike {
  readonly platform = 'bluesky' as const;

  async createSession(identifier: string, appPassword: string): Promise<OAuthSession> {
    const handle = String(identifier || '').trim().replace(/^@/, '');
    const password = String(appPassword || '').trim();
    if (!handle || !password || password === 'wrong-password') {
      throw new AdapterError('Bluesky rejected the handle or app password.', 'auth_failed');
    }
    const encoded = Buffer.from(handle, 'utf8').toString('base64url');
    return {
      tokens: {
        accessToken: `${MOCK_ACCESS_PREFIX}${encoded}`,
        refreshToken: `${MOCK_REFRESH_PREFIX}${encoded}`,
        tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      },
      account: mockAccount(handle),
    };
  }

  async getSession(accessToken: string): Promise<VerifiedAccount> {
    if (String(accessToken).includes('revoked')) {
      throw new AdapterError(
        'The Bluesky session is no longer valid. Reconnect the account.',
        'revoked'
      );
    }
    const handle = mockHandle(String(accessToken), MOCK_ACCESS_PREFIX);
    if (!handle) {
      throw new AdapterError('Bluesky returned an incomplete session.', 'instance_error');
    }
    return mockAccount(handle);
  }

  async refreshSession(refreshToken: string): Promise<OAuthSession> {
    if (!refreshToken || String(refreshToken).includes('revoked')) {
      throw new AdapterError(
        'The Bluesky session was revoked. Reconnect the account.',
        'revoked'
      );
    }
    const handle = mockHandle(String(refreshToken), MOCK_REFRESH_PREFIX);
    if (!handle) {
      throw new AdapterError('Bluesky returned an incomplete session.', 'instance_error');
    }
    const encoded = Buffer.from(handle, 'utf8').toString('base64url');
    return {
      tokens: {
        accessToken: `${MOCK_ACCESS_PREFIX}${encoded}`,
        refreshToken: `${MOCK_REFRESH_PREFIX}${encoded}`,
        tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      },
      account: mockAccount(handle),
    };
  }

  async sendPost(input: {
    tokens: AdapterTokens;
    account: VerifiedAccount;
    text: string;
  }): Promise<PostResult> {
    const text = validatePostText(input.text);
    if (text.includes('[mock-uncertain]')) {
      throw new AdapterError(
        'The platform could not confirm the post. Check the account before retrying.',
        'uncertain'
      );
    }
    if (text.includes('[mock-rate-limit]')) {
      throw new AdapterError('Bluesky is rate limiting requests.', 'rate_limited', 5);
    }
    if (text.includes('[mock-fail]')) {
      throw new AdapterError('Bluesky returned an unexpected error.', 'instance_error');
    }
    mockCounter += 1;
    const rkey = `mock${mockCounter}`;
    return {
      externalId: `at://${input.account.externalAccountId}/${POST_COLLECTION}/${rkey}`,
      externalUrl: `https://bsky.app/profile/${input.account.externalAccountName}/post/${rkey}`,
    };
  }
}

export default { BlueskyClient, MockBlueskyClient, resetMockBlueskyState };
