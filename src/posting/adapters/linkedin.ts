import { config } from '../../config/index';
import {
  linkedInApiHeaders,
  linkedInMemberUrn,
  linkedInPostUrlFromUrn,
  linkedInPostsUrl,
  linkedInUserInfoUrl,
  resolveLinkedInApiVersion,
  LINKEDIN_SCOPES,
  LINKEDIN_SCOPE_STRING,
} from '../linkedin/config';
import {
  AdapterError,
  type AdapterTokens,
  type LinkedInClientLike,
  type OAuthSession,
  type PostResult,
  type VerifiedAccount,
} from './types';
import { asRecord, request, retryAfterSeconds, type FetchLike } from './http';

export const LINKEDIN_DEFAULT_TIMEOUT_MS = 15_000;

export interface LinkedInClientOptions {
  apiBaseUrl?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  // Centralised version; validated here so every request in this client sends
  // exactly one version or the client refuses to start.
  apiVersion?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

type Operation = 'token' | 'verify' | 'publish';

function apiDetail(data: unknown): string {
  const record = asRecord(data);
  const detail =
    record.message ||
    record.error_description ||
    record.error ||
    record.code ||
    record.serviceErrorCode;
  return typeof detail === 'string' ? detail.slice(0, 300) : '';
}

function fromResponse(
  status: number,
  data: unknown,
  headers: Headers,
  operation: Operation,
  apiVersion: string
): AdapterError {
  const detail = apiDetail(data);
  if (status === 401) {
    return new AdapterError(
      operation === 'verify'
        ? 'The LinkedIn account no longer authorises Crewlink. Reconnect it.'
        : 'LinkedIn rejected the access token. Reconnect the account.',
      operation === 'verify' ? 'revoked' : 'token_expired'
    );
  }
  if (status === 403) {
    if (operation === 'verify') {
      return new AdapterError(
        'The LinkedIn account no longer authorises Crewlink. Reconnect it.',
        'revoked'
      );
    }
    return new AdapterError(
      detail ||
        'LinkedIn denied this request. The application may be missing the w_member_social permission.',
      'validation_error'
    );
  }
  if (status === 404) {
    return new AdapterError(detail || 'LinkedIn could not find that resource.', 'validation_error');
  }
  if (status === 409) {
    return new AdapterError(
      detail || 'LinkedIn reported a conflict and did not create the post.',
      'validation_error'
    );
  }
  if (status === 429) {
    return new AdapterError(
      'LinkedIn rate-limited the request. Try again later.',
      'rate_limited',
      retryAfterSeconds(headers)
    );
  }
  if (status === 400 || status === 422) {
    if (/FIELD_LENGTH_TOO_LONG/i.test(`${detail} ${JSON.stringify(data ?? '')}`)) {
      return new AdapterError('LinkedIn rejected the post because it is too long.', 'validation_error');
    }
    return new AdapterError(detail || 'LinkedIn rejected the request.', 'validation_error');
  }
  if (status === 426) {
    // LinkedIn signals an unsupported or sunset API version this way.
    return new AdapterError(
      `LinkedIn rejected the configured API version (${apiVersion}). Update LINKEDIN_API_VERSION.`,
      'instance_error'
    );
  }
  return new AdapterError(
    detail || 'LinkedIn returned an unexpected error.',
    'instance_error'
  );
}

function tokensFromPayload(data: unknown, fallbackRefresh?: string): AdapterTokens {
  const record = asRecord(data);
  const accessToken = typeof record.access_token === 'string' ? record.access_token : '';
  if (!accessToken) {
    throw new AdapterError('LinkedIn did not return an access token.', 'instance_error');
  }
  // Refresh tokens are only issued to approved Marketing Developer Platform
  // partners. When one is absent, expiry leads to a reconnect; no fake refresh.
  const refreshToken =
    typeof record.refresh_token === 'string' && record.refresh_token
      ? record.refresh_token
      : fallbackRefresh;
  const expiresIn = Number(record.expires_in);
  return {
    accessToken,
    refreshToken,
    tokenExpiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : undefined,
  };
}

function scopesFromPayload(data: unknown): string[] | undefined {
  const scope = asRecord(data).scope;
  if (typeof scope !== 'string' || !scope.trim()) return undefined;
  return scope.trim().split(/\s+/).slice(0, 50);
}

export class LinkedInClient implements LinkedInClientLike {
  readonly platform = 'linkedin' as const;
  readonly apiVersion: string;
  private readonly apiBaseUrl: string;
  private readonly authorizeUrl: string;
  private readonly tokenUrl: string;
  private readonly fetchImpl?: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: LinkedInClientOptions = {}) {
    this.apiBaseUrl = (options.apiBaseUrl || config.linkedinApiBaseUrl).replace(/\/+$/, '');
    this.authorizeUrl = options.authorizeUrl || config.linkedinAuthorizeUrl;
    this.tokenUrl = options.tokenUrl || config.linkedinTokenUrl;
    this.apiVersion = resolveLinkedInApiVersion(options.apiVersion ?? config.linkedinApiVersion);
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? LINKEDIN_DEFAULT_TIMEOUT_MS;
  }

  // LinkedIn's documented flow takes no PKCE parameters, so none are added.
  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string {
    const url = new URL(this.authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('state', input.state);
    url.searchParams.set('scope', LINKEDIN_SCOPE_STRING);
    return url.toString();
  }

  // Version and Rest.li headers are attached to every request from the single
  // configured version, including the OpenID userinfo call.
  private headers(accessToken?: string): Record<string, string> {
    return {
      ...linkedInApiHeaders(this.apiVersion),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    };
  }

  private tokenRequest(form: Record<string, string>) {
    return request(this.tokenUrl, {
      method: 'POST',
      headers: linkedInApiHeaders(this.apiVersion),
      body: { form },
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
  }

  async exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<OAuthSession> {
    const response = await this.tokenRequest({
      grant_type: 'authorization_code',
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
    });
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'token', this.apiVersion);
    }
    const tokens = tokensFromPayload(response.data);
    const account = await this.verifyAccount(tokens.accessToken);
    return { tokens, account, scopes: scopesFromPayload(response.data) };
  }

  async refreshSession(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<AdapterTokens> {
    const response = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
    });
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'token', this.apiVersion);
    }
    return tokensFromPayload(response.data, input.refreshToken);
  }

  async verifyAccount(accessToken: string): Promise<VerifiedAccount> {
    const response = await request(linkedInUserInfoUrl(this.apiBaseUrl), {
      headers: this.headers(accessToken),
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'verify', this.apiVersion);
    }
    const data = asRecord(response.data);
    const sub = typeof data.sub === 'string' ? data.sub.trim() : '';
    const fullName =
      typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : [data.given_name, data.family_name]
            .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
            .join(' ')
            .trim();
    if (!sub) {
      throw new AdapterError('LinkedIn did not return the connected member.', 'instance_error');
    }
    // The author URN must be valid before the account is stored as active.
    linkedInMemberUrn(sub);
    return {
      externalAccountId: sub,
      externalAccountName: fullName || 'LinkedIn member',
    };
  }

  async sendPost(input: {
    tokens: AdapterTokens;
    authorId: string;
    text: string;
  }): Promise<PostResult> {
    const author = linkedInMemberUrn(input.authorId);
    const response = await request(linkedInPostsUrl(this.apiBaseUrl), {
      method: 'POST',
      headers: this.headers(input.tokens.accessToken),
      body: {
        json: {
          author,
          commentary: input.text,
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        },
      },
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      // A lost response may still have created the post, so it must stay
      // uncertain and must never be retried automatically.
      networkErrorCode: 'uncertain',
    });
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'publish', this.apiVersion);
    }

    const urn = response.headers.get('x-restli-id')?.trim() || '';
    if (!urn) {
      throw new AdapterError(
        'LinkedIn accepted the request but returned no post identifier.',
        'uncertain'
      );
    }
    // Only documented share/ugcPost URNs map to a public feed URL.
    return { externalId: urn, externalUrl: linkedInPostUrlFromUrn(urn) };
  }
}

// --- Mock used by tests and by the default non-live transport ---
interface MockLinkedInPost {
  authorId: string;
  text: string;
}

export class MockLinkedInClient implements LinkedInClientLike {
  readonly platform = 'linkedin' as const;
  private readonly versionOverride?: string;
  posts: MockLinkedInPost[] = [];
  authorizationUrls: string[] = [];
  // Off by default because LinkedIn only issues refresh tokens to approved
  // Marketing Developer Platform partners.
  issueRefreshToken = false;
  tokenExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  failAtSend: number | null = null;
  failCode:
    | 'rate_limited'
    | 'validation_error'
    | 'revoked'
    | 'token_expired'
    | 'instance_error' = 'instance_error';
  uncertainAtSend: number | null = null;
  tokenExpiredAtSend: number | null = null;
  verifyCalls = 0;
  refreshCalls = 0;
  private counter = 0;
  private refreshCounter = 0;

  constructor(options: { apiVersion?: string } = {}) {
    this.versionOverride = options.apiVersion;
  }

  // Resolved lazily so importing the default mock never fails on a malformed
  // deployment setting; callers that use LinkedIn still see the clear error.
  get apiVersion(): string {
    return resolveLinkedInApiVersion(this.versionOverride ?? config.linkedinApiVersion);
  }

  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string {
    const url = new URL('https://www.linkedin.test/oauth/v2/authorization');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('state', input.state);
    url.searchParams.set('scope', LINKEDIN_SCOPE_STRING);
    this.authorizationUrls.push(url.toString());
    return url.toString();
  }

  async exchangeCode(): Promise<OAuthSession> {
    return {
      tokens: {
        accessToken: 'mock-linkedin-access',
        refreshToken: this.issueRefreshToken ? 'mock-linkedin-refresh-0' : undefined,
        tokenExpiresAt: this.tokenExpiresAt,
      },
      account: await this.verifyAccount(),
      scopes: [...LINKEDIN_SCOPES],
    };
  }

  async refreshSession(): Promise<AdapterTokens> {
    this.refreshCalls += 1;
    this.refreshCounter += 1;
    return {
      accessToken: `mock-linkedin-access-${this.refreshCounter}`,
      refreshToken: `mock-linkedin-refresh-${this.refreshCounter}`,
      tokenExpiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  async verifyAccount(): Promise<VerifiedAccount> {
    this.verifyCalls += 1;
    return {
      externalAccountId: 'mock-member-id',
      externalAccountName: 'Mock LinkedIn Member',
    };
  }

  async sendPost(input: {
    tokens: AdapterTokens;
    authorId: string;
    text: string;
  }): Promise<PostResult> {
    const call = this.posts.length + 1;
    if (this.tokenExpiredAtSend === call) {
      this.tokenExpiredAtSend = null;
      throw new AdapterError('Mock LinkedIn access token expired.', 'token_expired');
    }
    if (this.failAtSend === call) {
      throw new AdapterError('Mock LinkedIn post failure.', this.failCode);
    }
    if (this.uncertainAtSend === call) {
      throw new AdapterError('Mock LinkedIn outcome is uncertain.', 'uncertain');
    }
    linkedInMemberUrn(input.authorId);
    this.posts.push({ authorId: input.authorId, text: input.text });
    this.counter += 1;
    const urn = `urn:li:share:700000000000000000${this.counter}`;
    return { externalId: urn, externalUrl: linkedInPostUrlFromUrn(urn) };
  }

  reset(): void {
    this.posts = [];
    this.authorizationUrls = [];
    this.issueRefreshToken = false;
    this.tokenExpiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    this.failAtSend = null;
    this.failCode = 'instance_error';
    this.uncertainAtSend = null;
    this.tokenExpiredAtSend = null;
    this.verifyCalls = 0;
    this.refreshCalls = 0;
    this.counter = 0;
    this.refreshCounter = 0;
  }
}

export const mockLinkedInClient = new MockLinkedInClient();

export function resetMockLinkedInState(): void {
  mockLinkedInClient.reset();
}

export default LinkedInClient;
