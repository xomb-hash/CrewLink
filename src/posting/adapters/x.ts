import { config } from '../../config/index';
import { AdapterError, type AdapterTokens, type OAuthSession, type PostResult, type VerifiedAccount, type XClientLike } from './types';
import { asRecord, request, retryAfterSeconds, type FetchLike } from './http';

// The minimum scopes for publishing: read the account, create posts, and stay
// connected with a refresh token. Nothing broader is requested.
export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] as const;
export const X_SCOPE_STRING = X_SCOPES.join(' ');
export const X_DEFAULT_TIMEOUT_MS = 15_000;

export interface XClientOptions {
  apiBaseUrl?: string;
  authorizeUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

type Operation = 'post' | 'verify' | 'token';

function apiDetail(data: unknown): string {
  const record = asRecord(data);
  const detail = record.detail || record.title || record.error_description || record.error;
  return typeof detail === 'string' ? detail.slice(0, 300) : '';
}

// X uses 401 for an unusable access token, 403 for an action it refuses (which
// includes duplicate text), and 429 for rate limits. A 403 during verification
// means the account no longer authorises us; during a post it is a rejection,
// not necessarily a revoked connection.
function fromResponse(
  status: number,
  data: unknown,
  headers: Headers,
  operation: Operation
): AdapterError {
  const detail = apiDetail(data);
  if (status === 401 || (operation === 'token' && status === 400 && /invalid_grant/i.test(detail))) {
    return new AdapterError(
      'X rejected the access token. Reconnect the account.',
      operation === 'token' ? 'revoked' : 'token_expired'
    );
  }
  if (status === 403) {
    if (operation === 'post' && /duplicate/i.test(detail)) {
      return new AdapterError('X reports this post as duplicate content.', 'validation_error');
    }
    return new AdapterError(
      operation === 'verify'
        ? 'The X account no longer authorises Crewlink. Reconnect it.'
        : detail || 'X refused the request.',
      operation === 'verify' ? 'revoked' : 'validation_error'
    );
  }
  if (status === 429) {
    return new AdapterError(
      'X rate-limited the request. Try again later.',
      'rate_limited',
      retryAfterSeconds(headers)
    );
  }
  if (status === 400 || status === 422) {
    return new AdapterError(detail || 'X rejected the request.', 'validation_error');
  }
  return new AdapterError(detail || 'X returned an unexpected error.', 'instance_error');
}

function tokensFromPayload(
  data: unknown,
  fallbackRefresh?: string
): AdapterTokens {
  const record = asRecord(data);
  const accessToken = typeof record.access_token === 'string' ? record.access_token : '';
  if (!accessToken) {
    throw new AdapterError('X did not return an access token.', 'instance_error');
  }
  const refreshToken =
    typeof record.refresh_token === 'string' && record.refresh_token
      ? record.refresh_token
      : fallbackRefresh;
  const expiresIn = Number(record.expires_in);
  return {
    accessToken,
    refreshToken,
    tokenExpiresAt: Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : undefined,
  };
}

function clientAuth(
  clientId: string,
  clientSecret?: string
): Record<string, string> {
  if (!clientSecret) return {};
  return {
    authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`,
  };
}

export class XClient implements XClientLike {
  readonly platform = 'x' as const;
  private readonly apiBaseUrl: string;
  private readonly authorizeUrl: string;
  private readonly fetchImpl?: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: XClientOptions = {}) {
    this.apiBaseUrl = (options.apiBaseUrl || config.xApiBaseUrl).replace(/\/+$/, '');
    this.authorizeUrl = options.authorizeUrl || config.xAuthorizeUrl;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? X_DEFAULT_TIMEOUT_MS;
  }

  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string {
    const url = new URL(this.authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', X_SCOPE_STRING);
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  private async post(
    path: string,
    options: {
      headers?: Record<string, string>;
      json?: unknown;
      form?: Record<string, string>;
      operation: Operation;
      networkErrorCode?: 'transport_error' | 'uncertain';
    }
  ) {
    return request(`${this.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: options.headers,
      body: options.json !== undefined ? { json: options.json } : { form: options.form },
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      networkErrorCode: options.networkErrorCode,
    });
  }

  async exchangeCode(input: {
    clientId: string;
    clientSecret?: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<OAuthSession> {
    const form: Record<string, string> = {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
      client_id: input.clientId,
    };
    const response = await this.post('/2/oauth2/token', {
      headers: clientAuth(input.clientId, input.clientSecret),
      form,
      operation: 'token',
    });
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'token');
    }
    const tokens = tokensFromPayload(response.data);
    const account = await this.verifyAccount(tokens.accessToken);
    return { tokens, account };
  }

  async refreshSession(input: {
    clientId: string;
    clientSecret?: string;
    refreshToken: string;
  }): Promise<AdapterTokens> {
    const response = await this.post('/2/oauth2/token', {
      headers: clientAuth(input.clientId, input.clientSecret),
      form: {
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
        client_id: input.clientId,
      },
      operation: 'token',
    });
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'token');
    }
    return tokensFromPayload(response.data, input.refreshToken);
  }

  async verifyAccount(accessToken: string): Promise<VerifiedAccount> {
    const response = await request(
      `${this.apiBaseUrl}/2/users/me?user.fields=username,name`,
      {
        headers: { authorization: `Bearer ${accessToken}` },
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
      }
    );
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'verify');
    }
    const data = asRecord(asRecord(response.data).data);
    const id = typeof data.id === 'string' ? data.id : '';
    const username = typeof data.username === 'string' ? data.username : '';
    if (!id) {
      throw new AdapterError('X did not return the connected account.', 'instance_error');
    }
    const name = typeof data.name === 'string' && data.name ? data.name : username;
    return {
      externalAccountId: id,
      externalAccountName: username || name,
    };
  }

  async revoke(input: {
    clientId: string;
    clientSecret?: string;
    accessToken: string;
  }): Promise<void> {
    const response = await this.post('/2/oauth2/revoke', {
      headers: clientAuth(input.clientId, input.clientSecret),
      form: {
        token: input.accessToken,
        token_type_hint: 'access_token',
        client_id: input.clientId,
      },
      operation: 'token',
    });
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'token');
    }
  }

  async sendPost(input: {
    tokens: AdapterTokens;
    text: string;
    replyToId?: string;
  }): Promise<PostResult> {
    const payload: Record<string, unknown> = { text: input.text };
    if (input.replyToId) {
      payload.reply = { in_reply_to_tweet_id: input.replyToId };
    }
    // A network failure here may still have created the post, so it must be
    // reported as uncertain and never retried automatically.
    const response = await this.post('/2/tweets', {
      headers: { authorization: `Bearer ${input.tokens.accessToken}` },
      json: payload,
      operation: 'post',
      networkErrorCode: 'uncertain',
    });
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'post');
    }
    const id = asRecord(asRecord(response.data).data).id;
    if (typeof id !== 'string' || !id) {
      // The request succeeded but we cannot prove which post it created.
      throw new AdapterError('X accepted the request but returned no post id.', 'uncertain');
    }
    return { externalId: id, externalUrl: `https://x.com/i/web/status/${id}` };
  }
}

// --- Mock used by tests and by the default non-live transport ---
export class MockXClient implements XClientLike {
  readonly platform = 'x' as const;
  sends: Array<{ text: string; replyToId?: string }> = [];
  private counter = 0;
  private refreshCounter = 0;
  // Tests can make one call fail or become uncertain at a chosen position.
  failAtCall: number | null = null;
  failCode: 'rate_limited' | 'validation_error' | 'revoked' | 'token_expired' | 'instance_error' =
    'instance_error';
  uncertainAtCall: number | null = null;
  // A one-shot 401 so the publish engine's refresh-and-send-once path is testable.
  tokenExpiredAtCall: number | null = null;
  verifyCalls = 0;
  refreshCalls = 0;
  revokeCalls = 0;

  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string {
    const url = new URL('https://x.com/i/oauth2/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', X_SCOPE_STRING);
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeCode(): Promise<OAuthSession> {
    return {
      tokens: {
        accessToken: 'mock-x-access',
        refreshToken: 'mock-x-refresh-0',
        tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      },
      account: await this.verifyAccount(),
    };
  }

  async refreshSession(): Promise<AdapterTokens> {
    this.refreshCalls += 1;
    this.refreshCounter += 1;
    return {
      accessToken: `mock-x-access-${this.refreshCounter}`,
      refreshToken: `mock-x-refresh-${this.refreshCounter}`,
      tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    };
  }

  async verifyAccount(): Promise<VerifiedAccount> {
    this.verifyCalls += 1;
    return { externalAccountId: 'mock-x-user', externalAccountName: 'mock_x_user' };
  }

  async revoke(): Promise<void> {
    this.revokeCalls += 1;
  }

  async sendPost(input: {
    tokens: AdapterTokens;
    text: string;
    replyToId?: string;
  }): Promise<PostResult> {
    const call = this.sends.length + 1;
    if (this.tokenExpiredAtCall === call) {
      this.tokenExpiredAtCall = null;
      throw new AdapterError('Mock X access token expired.', 'token_expired');
    }
    if (this.failAtCall === call) {
      throw new AdapterError('Mock X failure.', this.failCode);
    }
    if (this.uncertainAtCall === call) {
      throw new AdapterError('Mock X outcome is uncertain.', 'uncertain');
    }
    this.sends.push({ text: input.text, replyToId: input.replyToId });
    this.counter += 1;
    return { externalId: `mock-x-post-${this.counter}` };
  }

  reset(): void {
    this.sends = [];
    this.counter = 0;
    this.refreshCounter = 0;
    this.failAtCall = null;
    this.uncertainAtCall = null;
    this.tokenExpiredAtCall = null;
    this.verifyCalls = 0;
    this.refreshCalls = 0;
    this.revokeCalls = 0;
  }
}

export const mockXClient = new MockXClient();

export function resetMockXState(): void {
  mockXClient.reset();
}

export default XClient;
