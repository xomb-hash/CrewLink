import { config } from '../../config/index';
import {
  AdapterError,
  type AdapterTokens,
  type OAuthSession,
  type PostResult,
  type RedditClientLike,
  type RedditPostRequirements,
  type RedditRule,
  type RedditSubreddit,
  type VerifiedAccount,
} from './types';
import { asRecord, request, retryAfterSeconds, type FetchLike } from './http';

// Minimum scopes for identity verification, subreddit discovery and submission.
// Nothing broader is requested.
export const REDDIT_SCOPES = ['identity', 'read', 'submit'] as const;
export const REDDIT_SCOPE_STRING = REDDIT_SCOPES.join(' ');
export const REDDIT_DEFAULT_TIMEOUT_MS = 15_000;
export const REDDIT_SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{2,21}$/;

export interface RedditClientOptions {
  apiBaseUrl?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  revokeUrl?: string;
  userAgent?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

type Operation = 'token' | 'verify' | 'read' | 'submit';

function apiDetail(data: unknown): string {
  const record = asRecord(data);
  const detail = record.message || record.error_description || record.error || record.reason;
  return typeof detail === 'string' ? detail.slice(0, 300) : '';
}

// Reddit reports many failures inside a successful HTTP 200 body:
// `{ json: { errors: [[code, message, field], ...] } }`.
function submitErrors(data: unknown): string[][] {
  const errors = asRecord(asRecord(asRecord(data).json)).errors;
  if (!Array.isArray(errors)) return [];
  return errors
    .filter((entry): entry is unknown[] => Array.isArray(entry))
    .map((entry) => entry.map((part) => String(part ?? '').slice(0, 300)));
}

function fromResponse(
  status: number,
  data: unknown,
  headers: Headers,
  operation: Operation
): AdapterError {
  const detail = apiDetail(data);
  if (status === 401) {
    return new AdapterError(
      operation === 'verify'
        ? 'The Reddit account no longer authorises Crewlink. Reconnect it.'
        : 'Reddit rejected the access token. Reconnect the account.',
      operation === 'verify' ? 'revoked' : 'token_expired'
    );
  }
  if (status === 403) {
    if (operation === 'verify') {
      return new AdapterError(
        'The Reddit account no longer authorises Crewlink. Reconnect it.',
        'revoked'
      );
    }
    return new AdapterError(
      detail || 'Reddit refused the request. The account or subreddit may not allow it.',
      'validation_error'
    );
  }
  if (status === 404) {
    return new AdapterError('Reddit could not find that subreddit or post.', 'validation_error');
  }
  if (status === 429) {
    return new AdapterError(
      'Reddit rate-limited the request. Try again later.',
      'rate_limited',
      retryAfterSeconds(headers)
    );
  }
  if (status === 400 || status === 422) {
    return new AdapterError(detail || 'Reddit rejected the request.', 'validation_error');
  }
  return new AdapterError(detail || 'Reddit returned an unexpected error.', 'instance_error');
}

function numberField(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 200))
    .filter(Boolean);
}

function parseSubreddit(value: unknown): RedditSubreddit {
  const data = asRecord(asRecord(value).data ?? value);
  const name = String(data.display_name || data.subreddit || data.name || '').trim();
  if (!name) {
    throw new AdapterError('Reddit did not return the subreddit.', 'instance_error');
  }
  return {
    name,
    title: typeof data.title === 'string' ? data.title.slice(0, 300) : undefined,
    description:
      typeof data.public_description === 'string'
        ? data.public_description.slice(0, 2000)
        : typeof data.description === 'string'
          ? data.description.slice(0, 2000)
          : undefined,
    subscribers: numberField(data.subscribers),
    subredditType: typeof data.subreddit_type === 'string' ? data.subreddit_type : undefined,
    submissionType:
      typeof data.submission_type === 'string' ? data.submission_type : undefined,
    over18: booleanField(data.over18),
    userIsBanned: booleanField(data.user_is_banned),
    userIsMuted: booleanField(data.user_is_muted),
    userIsContributor: booleanField(data.user_is_contributor),
    url: typeof data.url === 'string' ? data.url.slice(0, 500) : undefined,
  };
}

function parseRequirements(value: unknown): RedditPostRequirements {
  const data = asRecord(asRecord(value).data ?? value);
  return {
    titleMinLength: numberField(data.title_text_min_length),
    titleMaxLength: numberField(data.title_text_max_length),
    bodyMinLength: numberField(data.body_text_min_length),
    bodyMaxLength: numberField(data.body_text_max_length),
    titleRequired: booleanField(data.title_required),
    bodyRequired: booleanField(data.body_required),
    linkRequired: booleanField(data.link_required),
    linkRestrictionPolicy:
      typeof data.link_restriction_policy === 'string'
        ? data.link_restriction_policy
        : undefined,
    domainBlacklist: stringList(data.domain_blacklist),
    domainWhitelist: stringList(data.domain_whitelist),
    titleBlacklistedStrings: stringList(data.title_blacklisted_strings),
    titleRequiredStrings: stringList(data.title_required_strings),
    bodyBlacklistedStrings: stringList(data.body_blacklisted_strings),
    bodyRequiredStrings: stringList(data.body_required_strings),
    flairRequired: booleanField(data.is_flair_required),
    galleryRequired: booleanField(data.gallery_required),
    rawFields: data,
  };
}

function tokensFromPayload(data: unknown, fallbackRefresh?: string): AdapterTokens {
  const record = asRecord(data);
  const accessToken = typeof record.access_token === 'string' ? record.access_token : '';
  if (!accessToken) {
    throw new AdapterError('Reddit did not return an access token.', 'instance_error');
  }
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

function basicAuth(clientId: string, clientSecret: string): Record<string, string> {
  return {
    authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`,
  };
}

export class RedditClient implements RedditClientLike {
  readonly platform = 'reddit' as const;
  private readonly apiBaseUrl: string;
  private readonly authorizeUrl: string;
  private readonly tokenUrl: string;
  private readonly revokeUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl?: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: RedditClientOptions = {}) {
    this.apiBaseUrl = (options.apiBaseUrl || config.redditApiBaseUrl).replace(/\/+$/, '');
    this.authorizeUrl = options.authorizeUrl || config.redditAuthorizeUrl;
    this.tokenUrl = options.tokenUrl || config.redditTokenUrl;
    this.revokeUrl = options.revokeUrl || config.redditRevokeUrl;
    this.userAgent = options.userAgent || config.redditUserAgent;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? REDDIT_DEFAULT_TIMEOUT_MS;
  }

  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string {
    const url = new URL(this.authorizeUrl);
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', input.state);
    url.searchParams.set('redirect_uri', input.redirectUri);
    // A permanent token is required so the connection survives an access-token
    // expiry; Crewlink stores the refresh token encrypted.
    url.searchParams.set('duration', 'permanent');
    url.searchParams.set('scope', REDDIT_SCOPE_STRING);
    return url.toString();
  }

  private headers(accessToken?: string): Record<string, string> {
    return {
      'user-agent': this.userAgent,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    };
  }

  private async tokenRequest(form: Record<string, string>, clientId: string, clientSecret: string) {
    return request(this.tokenUrl, {
      method: 'POST',
      headers: { ...basicAuth(clientId, clientSecret), 'user-agent': this.userAgent },
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
    const response = await this.tokenRequest(
      {
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
      },
      input.clientId,
      input.clientSecret
    );
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'token');
    }
    const tokens = tokensFromPayload(response.data);
    const account = await this.verifyAccount(tokens.accessToken);
    return { tokens, account };
  }

  async refreshSession(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<AdapterTokens> {
    const response = await this.tokenRequest(
      { grant_type: 'refresh_token', refresh_token: input.refreshToken },
      input.clientId,
      input.clientSecret
    );
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'token');
    }
    return tokensFromPayload(response.data, input.refreshToken);
  }

  async verifyAccount(accessToken: string): Promise<VerifiedAccount> {
    const response = await request(`${this.apiBaseUrl}/api/v1/me`, {
      headers: this.headers(accessToken),
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'verify');
    }
    const data = asRecord(response.data);
    const id = typeof data.id === 'string' ? data.id : '';
    const name = typeof data.name === 'string' ? data.name : '';
    if (!id || !name) {
      throw new AdapterError('Reddit did not return the connected account.', 'instance_error');
    }
    return { externalAccountId: id, externalAccountName: name };
  }

  async revoke(input: {
    clientId: string;
    clientSecret: string;
    accessToken: string;
  }): Promise<void> {
    const response = await request(this.revokeUrl, {
      method: 'POST',
      headers: { ...basicAuth(input.clientId, input.clientSecret), 'user-agent': this.userAgent },
      body: {
        form: { token: input.accessToken, token_type_hint: 'access_token' },
      },
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'token');
    }
  }

  private async get(path: string, accessToken: string) {
    const response = await request(`${this.apiBaseUrl}${path}`, {
      headers: this.headers(accessToken),
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'read');
    }
    return response.data;
  }

  async searchSubreddits(
    accessToken: string,
    query: string,
    limit = 10
  ): Promise<RedditSubreddit[]> {
    const value = String(query || '').trim().slice(0, 100);
    if (!value) return [];
    const safeLimit = Math.min(Math.max(Math.round(limit), 1), 25);
    const data = await this.get(
      `/subreddits/search?q=${encodeURIComponent(value)}&limit=${safeLimit}&include_over_18=false`,
      accessToken
    );
    const children = asRecord(asRecord(data).data).children;
    if (!Array.isArray(children)) return [];
    return children
      .map((child) => {
        try {
          return parseSubreddit(child);
        } catch {
          return null;
        }
      })
      .filter((item): item is RedditSubreddit => Boolean(item))
      .slice(0, safeLimit);
  }

  async getSubreddit(accessToken: string, name: string): Promise<RedditSubreddit> {
    const safe = String(name || '').trim();
    if (!REDDIT_SUBREDDIT_PATTERN.test(safe)) {
      throw new AdapterError('Enter a valid subreddit name.', 'invalid_input');
    }
    const data = await this.get(`/r/${encodeURIComponent(safe)}/about`, accessToken);
    return parseSubreddit(data);
  }

  async getRules(accessToken: string, name: string): Promise<RedditRule[]> {
    const safe = String(name || '').trim();
    if (!REDDIT_SUBREDDIT_PATTERN.test(safe)) {
      throw new AdapterError('Enter a valid subreddit name.', 'invalid_input');
    }
    const data = await this.get(`/r/${encodeURIComponent(safe)}/about/rules`, accessToken);
    const rules = asRecord(data).rules ?? asRecord(asRecord(data).data).rules;
    if (!Array.isArray(rules)) return [];
    return rules
      .filter((rule): rule is Record<string, unknown> => Boolean(rule && typeof rule === 'object'))
      .map((rule) => ({
        name: String(rule.short_name || rule.name || '').slice(0, 200),
        description:
          typeof rule.description === 'string' ? rule.description.slice(0, 2000) : undefined,
        kind: typeof rule.kind === 'string' ? rule.kind.slice(0, 50) : undefined,
      }))
      .filter((rule) => rule.name);
  }

  async getPostRequirements(
    accessToken: string,
    name: string
  ): Promise<RedditPostRequirements> {
    const safe = String(name || '').trim();
    if (!REDDIT_SUBREDDIT_PATTERN.test(safe)) {
      throw new AdapterError('Enter a valid subreddit name.', 'invalid_input');
    }
    const data = await this.get(`/api/v1/${encodeURIComponent(safe)}/post_requirements`, accessToken);
    return parseRequirements(data);
  }

  async submit(input: {
    tokens: AdapterTokens;
    subreddit: string;
    kind: 'self' | 'link';
    title: string;
    body?: string;
    url?: string;
  }): Promise<PostResult> {
    const safe = String(input.subreddit || '').trim();
    if (!REDDIT_SUBREDDIT_PATTERN.test(safe)) {
      throw new AdapterError('Enter a valid subreddit name.', 'invalid_input');
    }
    const form: Record<string, string> = {
      api_type: 'json',
      sr: safe,
      kind: input.kind,
      title: String(input.title || ''),
      resubmit: 'false',
      sendreplies: 'false',
    };
    if (input.kind === 'link') {
      form.url = String(input.url || '');
    } else {
      form.text = String(input.body || '');
    }

    // A timeout here may still have created the submission, so it is reported as
    // uncertain and is never retried automatically.
    const response = await request(`${this.apiBaseUrl}/api/submit`, {
      method: 'POST',
      headers: this.headers(input.tokens.accessToken),
      body: { form },
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      networkErrorCode: 'uncertain',
    });
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'submit');
    }

    const errors = submitErrors(response.data);
    if (errors.length) {
      const code = (errors[0][0] || '').toUpperCase();
      const message = errors[0][1] || 'Reddit rejected the submission.';
      if (code === 'RATELIMIT') {
        throw new AdapterError(
          'Reddit rate-limited this submission. Wait before trying again.',
          'rate_limited',
          retryAfterSeconds(response.headers)
        );
      }
      throw new AdapterError(message, 'validation_error');
    }

    const result = asRecord(asRecord(asRecord(response.data).json).data);
    const id = typeof result.id === 'string' ? result.id : '';
    const name = typeof result.name === 'string' ? result.name : '';
    const url = typeof result.url === 'string' ? result.url : '';
    if (!id && !name) {
      throw new AdapterError(
        'Reddit accepted the request but returned no submission id.',
        'uncertain'
      );
    }
    const externalUrl = /^https?:\/\/(?:www\.)?reddit\.com\//i.test(url)
      ? url
      : id
        ? `https://www.reddit.com/comments/${encodeURIComponent(id)}`
        : undefined;
    return { externalId: name || id, externalUrl };
  }
}

// --- Mock used by tests and by the default non-live transport ---
interface MockSubmission {
  subreddit: string;
  kind: 'self' | 'link';
  title: string;
  body?: string;
  url?: string;
}

export class MockRedditClient implements RedditClientLike {
  readonly platform = 'reddit' as const;
  submissions: MockSubmission[] = [];
  searches: string[] = [];
  aboutCalls: string[] = [];
  requirementCalls: string[] = [];
  private counter = 0;
  private refreshCounter = 0;

  // Fixtures are mutable so a test can model a restricted, banned or
  // flair-requiring subreddit without touching production logic.
  subreddits = new Map<string, RedditSubreddit>();
  requirements = new Map<string, RedditPostRequirements>();

  failAtSubmit: number | null = null;
  failCode: 'rate_limited' | 'validation_error' | 'revoked' | 'token_expired' | 'instance_error' =
    'instance_error';
  uncertainAtSubmit: number | null = null;
  tokenExpiredAtSubmit: number | null = null;
  submitErrors: string[][] | null = null;
  searchFails = false;
  verifyCalls = 0;
  refreshCalls = 0;
  revokeCalls = 0;

  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string {
    const url = new URL('https://www.reddit.test/api/v1/authorize');
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', input.state);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('duration', 'permanent');
    url.searchParams.set('scope', REDDIT_SCOPE_STRING);
    return url.toString();
  }

  async exchangeCode(): Promise<OAuthSession> {
    return {
      tokens: {
        accessToken: 'mock-reddit-access',
        refreshToken: 'mock-reddit-refresh-0',
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      account: await this.verifyAccount(),
    };
  }

  async refreshSession(): Promise<AdapterTokens> {
    this.refreshCalls += 1;
    this.refreshCounter += 1;
    return {
      accessToken: `mock-reddit-access-${this.refreshCounter}`,
      refreshToken: `mock-reddit-refresh-${this.refreshCounter}`,
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }

  async verifyAccount(): Promise<VerifiedAccount> {
    this.verifyCalls += 1;
    return { externalAccountId: 'mock-reddit-user', externalAccountName: 'mock_reddit_user' };
  }

  async revoke(): Promise<void> {
    this.revokeCalls += 1;
  }

  setSubreddit(
    name: string,
    value: Partial<RedditSubreddit> = {},
    requirements: RedditPostRequirements = {}
  ): void {
    this.subreddits.set(name.toLowerCase(), {
      name,
      title: `${name} community`,
      description: `Community for ${name}`,
      subscribers: 1000,
      subredditType: 'public',
      submissionType: 'any',
      userIsBanned: false,
      userIsMuted: false,
      userIsContributor: false,
      ...value,
    });
    this.requirements.set(name.toLowerCase(), requirements);
  }

  async searchSubreddits(
    _accessToken: string,
    query: string,
    limit = 10
  ): Promise<RedditSubreddit[]> {
    this.searches.push(query);
    if (this.searchFails) {
      throw new AdapterError('Mock Reddit search is unavailable.', 'instance_error');
    }
    const value = query.toLowerCase();
    if (!this.subreddits.size) {
      this.setSubreddit('programming');
      this.setSubreddit('opensource');
    }
    return [...this.subreddits.values()]
      .filter(
        (subreddit) =>
          subreddit.name.toLowerCase().includes(value) ||
          (subreddit.title || '').toLowerCase().includes(value)
      )
      .slice(0, limit);
  }

  async getSubreddit(_accessToken: string, name: string): Promise<RedditSubreddit> {
    this.aboutCalls.push(name);
    const key = name.toLowerCase();
    if (!this.subreddits.has(key)) this.setSubreddit(name);
    return { ...this.subreddits.get(key)! };
  }

  async getRules(): Promise<RedditRule[]> {
    return [{ name: 'Be respectful', description: 'Keep discussion civil.', kind: 'all' }];
  }

  async getPostRequirements(
    _accessToken: string,
    name: string
  ): Promise<RedditPostRequirements> {
    this.requirementCalls.push(name);
    const key = name.toLowerCase();
    if (!this.requirements.has(key)) this.setSubreddit(name);
    return { ...this.requirements.get(key)! };
  }

  async submit(input: {
    tokens: AdapterTokens;
    subreddit: string;
    kind: 'self' | 'link';
    title: string;
    body?: string;
    url?: string;
  }): Promise<PostResult> {
    const call = this.submissions.length + 1;
    if (this.tokenExpiredAtSubmit === call) {
      this.tokenExpiredAtSubmit = null;
      throw new AdapterError('Mock Reddit access token expired.', 'token_expired');
    }
    if (this.failAtSubmit === call) {
      throw new AdapterError('Mock Reddit submission failure.', this.failCode);
    }
    if (this.uncertainAtSubmit === call) {
      throw new AdapterError('Mock Reddit submission outcome is uncertain.', 'uncertain');
    }
    if (this.submitErrors) {
      const [code, message] = this.submitErrors[0] || [];
      const errors = this.submitErrors;
      this.submitErrors = null;
      if ((code || '').toUpperCase() === 'RATELIMIT') {
        throw new AdapterError(message || 'Rate limited.', 'rate_limited', 60);
      }
      throw new AdapterError(message || 'Reddit rejected the submission.', 'validation_error');
    }
    this.submissions.push({
      subreddit: input.subreddit,
      kind: input.kind,
      title: input.title,
      body: input.body,
      url: input.url,
    });
    this.counter += 1;
    const id = `mock-post-${this.counter}`;
    return {
      externalId: `t3_${id}`,
      externalUrl: `https://www.reddit.com/r/${input.subreddit}/comments/${id}/`,
    };
  }

  reset(): void {
    this.submissions = [];
    this.searches = [];
    this.aboutCalls = [];
    this.requirementCalls = [];
    this.counter = 0;
    this.refreshCounter = 0;
    this.subreddits = new Map();
    this.requirements = new Map();
    this.failAtSubmit = null;
    this.uncertainAtSubmit = null;
    this.tokenExpiredAtSubmit = null;
    this.submitErrors = null;
    this.searchFails = false;
    this.verifyCalls = 0;
    this.refreshCalls = 0;
    this.revokeCalls = 0;
  }
}

export const mockRedditClient = new MockRedditClient();

export function resetMockRedditState(): void {
  mockRedditClient.reset();
}

export default RedditClient;
