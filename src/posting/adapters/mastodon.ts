import { config } from '../../config/index';
import {
  AdapterError,
  type MastodonApp,
  type MastodonClientLike,
  type PostResult,
  type VerifiedAccount,
} from './types';
import {
  asRecord,
  request,
  retryAfterSeconds,
  type FetchLike,
} from './http';
import type { LookupFn } from './ssrf';

// Publishing a status is the only write permission. read:accounts is the minimum
// extra scope Mastodon requires to call verify_credentials, which is how Crewlink
// confirms the account and stores its id and username.
export const MASTODON_SCOPES = ['read:accounts', 'write:statuses'] as const;
export const MASTODON_SCOPE_STRING = MASTODON_SCOPES.join(' ');
export const DEFAULT_MASTODON_LIMIT = 500;
const LIMIT_CACHE_MS = 10 * 60 * 1000;

function invalidInstance(message = 'Enter a valid public HTTPS Mastodon instance URL.'): AdapterError {
  return new AdapterError(message, 'invalid_input');
}

// Mastodon instances are creator-supplied URLs. DNS names are required (no IP
// literals) and every outbound call resolves and validates the address against
// public ranges before connecting (see ssrf.ts).
function assertPublicHost(hostname: string): void {
  const host = hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.home.arpa')
  ) {
    throw invalidInstance();
  }
  if (host.startsWith('[') || host.includes(':')) {
    // IPv6 literals are rejected rather than classified.
    throw invalidInstance();
  }
  if (/^[\d.]+$/.test(host)) {
    // IPv4 literals are rejected; a public instance must use a DNS name so the
    // address can be resolved and pinned for each request.
    throw invalidInstance();
  }
  if (!host.includes('.')) throw invalidInstance();
}

export function normalizeMastodonInstanceUrl(raw: string): string {
  let value = String(raw || '').trim();
  if (!value) throw invalidInstance('Enter your Mastodon instance URL.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidInstance();
  }
  if (url.protocol !== 'https:') throw invalidInstance();
  if (url.username || url.password) throw invalidInstance();
  if (url.pathname !== '/' && url.pathname !== '') throw invalidInstance();
  if (url.search || url.hash) throw invalidInstance();
  assertPublicHost(url.hostname);

  return url.origin;
}

function mapError(
  status: number,
  headers: Headers,
  context: 'app' | 'token' | 'read' | 'post'
): AdapterError {
  if (status === 429) {
    return new AdapterError(
      'The instance is rate limiting requests. Try again shortly.',
      'rate_limited',
      retryAfterSeconds(headers)
    );
  }
  if (context === 'app') {
    if (status === 400 || status === 422) {
      return new AdapterError(
        'The instance rejected the Crewlink OAuth application.',
        'invalid_input'
      );
    }
    return new AdapterError('The instance returned an unexpected error.', 'instance_error');
  }
  if (context === 'token') {
    if (status === 400 || status === 401 || status === 403) {
      return new AdapterError(
        'The instance rejected the authorization code. Try connecting again.',
        'auth_failed'
      );
    }
    return new AdapterError('The instance returned an unexpected error.', 'instance_error');
  }
  if (context === 'read') {
    if (status === 401 || status === 403) {
      return new AdapterError(
        'The Mastodon access token was revoked. Reconnect the account.',
        'revoked'
      );
    }
    return new AdapterError('The instance returned an unexpected error.', 'instance_error');
  }
  if (status === 401 || status === 403) {
    return new AdapterError(
      'The Mastodon access token was revoked. Reconnect the account.',
      'revoked'
    );
  }
  if (status === 400 || status === 422) {
    return new AdapterError(
      'The instance rejected the status. Edit the draft and approve it again.',
      'validation_error'
    );
  }
  return new AdapterError('The instance returned an unexpected error.', 'instance_error');
}

function accountFrom(data: unknown, instanceUrl: string, instanceName?: string): VerifiedAccount {
  const record = asRecord(data);
  const id = String(record.id || '');
  const acct = String(record.acct || record.username || '');
  if (!id || !acct) {
    throw new AdapterError('The instance returned an incomplete account.', 'instance_error');
  }
  return {
    externalAccountId: id,
    externalAccountName: acct,
    instanceUrl,
    instanceName,
  };
}

function statusLimitFrom(data: unknown): number | null {
  const record = asRecord(data);
  const configuration = asRecord(record.configuration);
  const statuses = asRecord(configuration.statuses);
  const maxCharacters = Number(statuses.max_characters ?? record.max_toot_chars);
  return Number.isInteger(maxCharacters) && maxCharacters > 0 ? maxCharacters : null;
}

export class MastodonClient implements MastodonClientLike {
  readonly platform = 'mastodon' as const;
  private fetchImpl?: FetchLike;
  private lookup?: LookupFn;
  private limitCache = new Map<string, { value: number | null; expiresAt: number }>();

  constructor(options: { fetchImpl?: FetchLike; lookup?: LookupFn } = {}) {
    this.fetchImpl = options.fetchImpl;
    this.lookup = options.lookup;
  }

  private call(
    instanceUrl: string,
    path: string,
    init: {
      method?: 'GET' | 'POST';
      accessToken?: string;
      form?: Record<string, string>;
      json?: unknown;
      headers?: Record<string, string>;
      networkErrorCode?: 'transport_error' | 'uncertain';
    } = {}
  ) {
    return request(`${instanceUrl}${path}`, {
      method: init.method,
      headers: {
        ...(init.accessToken ? { authorization: `Bearer ${init.accessToken}` } : {}),
        ...init.headers,
      },
      body:
        init.json !== undefined
          ? { json: init.json }
          : init.form
            ? { form: init.form }
            : undefined,
      fetchImpl: this.fetchImpl,
      networkErrorCode: init.networkErrorCode,
      guard: { lookup: this.lookup },
    });
  }

  async registerApp(instanceUrl: string, redirectUri: string): Promise<MastodonApp> {
    const instance = normalizeMastodonInstanceUrl(instanceUrl);
    const response = await this.call(instance, '/api/v1/apps', {
      method: 'POST',
      form: {
        client_name: 'Crewlink',
        redirect_uris: redirectUri,
        scopes: MASTODON_SCOPE_STRING,
        website: config.appUrl,
      },
    });
    if (!response.ok) {
      throw mapError(response.status, response.headers, 'app');
    }
    const record = asRecord(response.data);
    const clientId = String(record.client_id || '');
    const clientSecret = String(record.client_secret || '');
    if (!clientId || !clientSecret) {
      throw new AdapterError(
        'The instance did not return OAuth client credentials.',
        'instance_error'
      );
    }
    return {
      clientId,
      clientSecret,
      redirectUri: String(record.redirect_uri || redirectUri),
    };
  }

  authorizationUrl(input: {
    instanceUrl: string;
    clientId: string;
    redirectUri: string;
    state: string;
  }): string {
    const instance = normalizeMastodonInstanceUrl(input.instanceUrl);
    const url = new URL('/oauth/authorize', instance);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', MASTODON_SCOPE_STRING);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async exchangeCode(input: {
    instanceUrl: string;
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<{ accessToken: string; scopes: string[] }> {
    const instance = normalizeMastodonInstanceUrl(input.instanceUrl);
    const code = String(input.code || '').trim();
    if (!code) throw new AdapterError('The authorization code is missing.', 'invalid_input');

    const response = await this.call(instance, '/oauth/token', {
      method: 'POST',
      form: {
        grant_type: 'authorization_code',
        code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        scope: MASTODON_SCOPE_STRING,
      },
    });
    if (!response.ok) {
      throw mapError(response.status, response.headers, 'token');
    }
    const record = asRecord(response.data);
    const accessToken = String(record.access_token || '');
    if (!accessToken) {
      throw new AdapterError(
        'The instance did not return an access token.',
        'instance_error'
      );
    }
    const scopes = String(record.scope || '')
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
    return { accessToken, scopes };
  }

  async verifyAccount(instanceUrl: string, accessToken: string): Promise<VerifiedAccount> {
    const instance = normalizeMastodonInstanceUrl(instanceUrl);
    const response = await this.call(instance, '/api/v1/accounts/verify_credentials', {
      accessToken,
    });
    if (!response.ok) {
      throw mapError(response.status, response.headers, 'read');
    }
    return accountFrom(response.data, instance, new URL(instance).hostname);
  }

  async getStatusCharacterLimit(instanceUrl: string): Promise<number | null> {
    const instance = normalizeMastodonInstanceUrl(instanceUrl);
    const cached = this.limitCache.get(instance);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let limit: number | null = null;
    try {
      const v2 = await this.call(instance, '/api/v2/instance');
      if (v2.ok) {
        limit = statusLimitFrom(v2.data);
      } else {
        // Older instances may not expose /api/v2; v1 carries the same value.
        const v1 = await this.call(instance, '/api/v1/instance');
        if (v1.ok) limit = statusLimitFrom(v1.data);
      }
    } catch {
      // Limits are best effort. Publishing falls back to the documented default.
      limit = null;
    }

    this.limitCache.set(instance, { value: limit, expiresAt: Date.now() + LIMIT_CACHE_MS });
    return limit;
  }

  clearLimitCache(): void {
    this.limitCache.clear();
  }

  async sendStatus(input: {
    instanceUrl: string;
    accessToken: string;
    text: string;
    idempotencyKey?: string;
  }): Promise<PostResult> {
    const instance = normalizeMastodonInstanceUrl(input.instanceUrl);
    const text = String(input.text || '');
    if (!text.trim()) {
      throw new AdapterError('The draft is empty.', 'validation_error');
    }

    const instanceLimit = await this.getStatusCharacterLimit(instance);
    const limit = instanceLimit ?? DEFAULT_MASTODON_LIMIT;
    // Mastodon counts characters (code points). URL reweighting is not applied,
    // so this check can only be stricter than the instance.
    if ([...text].length > limit) {
      throw new AdapterError(
        `This instance allows ${limit} characters per status.`,
        'validation_error'
      );
    }

    const response = await this.call(instance, '/api/v1/statuses', {
      method: 'POST',
      accessToken: input.accessToken,
      json: { status: text },
      headers: input.idempotencyKey ? { 'idempotency-key': input.idempotencyKey } : {},
      networkErrorCode: 'uncertain',
    });
    if (!response.ok) {
      throw mapError(response.status, response.headers, 'post');
    }
    const record = asRecord(response.data);
    const externalId = String(record.id || '');
    if (!externalId) {
      throw new AdapterError(
        'The instance accepted the status but returned no id. Check the account before retrying.',
        'uncertain'
      );
    }
    return {
      externalId,
      externalUrl: String(record.url || '') || undefined,
    };
  }
}

// Deterministic fake used unless PUBLISHING_TRANSPORT=live. It never contacts an
// instance and accepts any non-empty code.
let mockCounter = 0;

export function resetMockMastodonState(): void {
  mockCounter = 0;
}

export class MockMastodonClient implements MastodonClientLike {
  readonly platform = 'mastodon' as const;

  async registerApp(instanceUrl: string, redirectUri: string): Promise<MastodonApp> {
    normalizeMastodonInstanceUrl(instanceUrl);
    return {
      clientId: 'mock-mastodon-client',
      clientSecret: 'mock-mastodon-secret',
      redirectUri,
    };
  }

  authorizationUrl(input: {
    instanceUrl: string;
    clientId: string;
    redirectUri: string;
    state: string;
  }): string {
    const instance = normalizeMastodonInstanceUrl(input.instanceUrl);
    const url = new URL('/oauth/authorize', instance);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', MASTODON_SCOPE_STRING);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async exchangeCode(input: {
    instanceUrl: string;
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<{ accessToken: string; scopes: string[] }> {
    normalizeMastodonInstanceUrl(input.instanceUrl);
    if (!input.code || input.code === 'denied') {
      throw new AdapterError('The instance rejected the authorization code.', 'auth_failed');
    }
    return {
      accessToken: `mock-mastodon-access-${input.code}`,
      scopes: [...MASTODON_SCOPES],
    };
  }

  async verifyAccount(instanceUrl: string, accessToken: string): Promise<VerifiedAccount> {
    const instance = normalizeMastodonInstanceUrl(instanceUrl);
    if (String(accessToken).includes('revoked')) {
      throw new AdapterError(
        'The Mastodon access token was revoked. Reconnect the account.',
        'revoked'
      );
    }
    return {
      externalAccountId: 'mock-mastodon-account',
      externalAccountName: 'mockuser',
      instanceUrl: instance,
      instanceName: new URL(instance).hostname,
    };
  }

  async getStatusCharacterLimit(instanceUrl: string): Promise<number | null> {
    normalizeMastodonInstanceUrl(instanceUrl);
    return DEFAULT_MASTODON_LIMIT;
  }

  async sendStatus(input: {
    instanceUrl: string;
    accessToken: string;
    text: string;
    idempotencyKey?: string;
  }): Promise<PostResult> {
    normalizeMastodonInstanceUrl(input.instanceUrl);
    const text = String(input.text || '');
    if (!text.trim()) {
      throw new AdapterError('The draft is empty.', 'validation_error');
    }
    if ([...text].length > DEFAULT_MASTODON_LIMIT) {
      throw new AdapterError(
        `This instance allows ${DEFAULT_MASTODON_LIMIT} characters per status.`,
        'validation_error'
      );
    }
    if (text.includes('[mock-uncertain]')) {
      throw new AdapterError(
        'The platform could not confirm the post. Check the account before retrying.',
        'uncertain'
      );
    }
    if (text.includes('[mock-rate-limit]')) {
      throw new AdapterError('The instance is rate limiting requests.', 'rate_limited', 5);
    }
    if (text.includes('[mock-fail]')) {
      throw new AdapterError('The instance returned an unexpected error.', 'instance_error');
    }
    if (String(input.accessToken).includes('revoked')) {
      throw new AdapterError(
        'The Mastodon access token was revoked. Reconnect the account.',
        'revoked'
      );
    }
    mockCounter += 1;
    return {
      externalId: `mock-mastodon-${mockCounter}`,
      externalUrl: `${input.instanceUrl}/@mockuser/${mockCounter}`,
    };
  }
}

export default {
  MastodonClient,
  MockMastodonClient,
  normalizeMastodonInstanceUrl,
  resetMockMastodonState,
};
