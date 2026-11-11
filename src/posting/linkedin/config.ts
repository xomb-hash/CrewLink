import { config } from '../../config/index';

// Central LinkedIn API configuration. Every LinkedIn request reads its version
// and protocol headers from here so an upgrade touches one constant, never the
// adapter, publish engine or routes.

// Identity uses the OpenID Connect userinfo endpoint; publishing a member post
// needs w_member_social. Organizations would need w_organization_social plus a
// Marketing Developer Platform app and page admin role, which is out of scope.
export const LINKEDIN_SCOPES = ['openid', 'profile', 'w_member_social'] as const;
export const LINKEDIN_SCOPE_STRING = LINKEDIN_SCOPES.join(' ');
export const LINKEDIN_ORGANIZATION_SCOPE = 'w_organization_social';

// LinkedIn documents monthly API versions (YYYYMM) and supports each for at
// least a year. 202610 is the latest documented version at the time of writing;
// 202511 sunsets on 2026-11-16.
export const LINKEDIN_LATEST_DOCUMENTED_VERSION = '202610';
export const LINKEDIN_DEFAULT_API_VERSION = LINKEDIN_LATEST_DOCUMENTED_VERSION;
export const LINKEDIN_VERSION_RETENTION_MONTHS = 12;
export const LINKEDIN_RESTLI_PROTOCOL_VERSION = '2.0.0';

// The Posts API documentation does not publish a numeric limit. This is the
// long-standing LinkedIn text ceiling used by the registry; a server-side
// FIELD_LENGTH_TOO_LONG response stays authoritative.
export const LINKEDIN_POST_LIMIT = 3000;

export const LINKEDIN_CALLBACK_PATH = '/api/platforms/linkedin/callback';

export type LinkedInConfigErrorCode =
  | 'missing_credentials'
  | 'invalid_version'
  | 'unsupported_version';

export class LinkedInConfigError extends Error {
  constructor(
    message: string,
    readonly code: LinkedInConfigErrorCode
  ) {
    super(message);
    this.name = 'LinkedInConfigError';
  }
}

function versionParts(value: string): { year: number; month: number } | null {
  if (!/^\d{6}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4));
  if (year < 2010 || month < 1 || month > 12) return null;
  return { year, month };
}

function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

// Validates a configured version, rejecting malformed values and versions older
// than LinkedIn's documented one-year support window. `now` is injectable so the
// check is deterministic in tests.
export function validateLinkedInApiVersion(value: string, now = new Date()): string {
  const raw = String(value ?? '').trim();
  const parts = versionParts(raw);
  if (!parts) {
    throw new LinkedInConfigError(
      'LINKEDIN_API_VERSION must use the YYYYMM format, for example 202610.',
      'invalid_version'
    );
  }
  const earliest = monthIndex(now.getUTCFullYear(), now.getUTCMonth() + 1) -
    LINKEDIN_VERSION_RETENTION_MONTHS;
  if (monthIndex(parts.year, parts.month) < earliest) {
    throw new LinkedInConfigError(
      `LINKEDIN_API_VERSION ${raw} is older than LinkedIn's ${LINKEDIN_VERSION_RETENTION_MONTHS}-month support window. Set a current version, for example ${LINKEDIN_DEFAULT_API_VERSION}.`,
      'unsupported_version'
    );
  }
  return raw;
}

// Unset means the documented default; an explicit value must be valid.
export function resolveLinkedInApiVersion(
  raw: string | undefined = config.linkedinApiVersion,
  now = new Date()
): string {
  const value = String(raw ?? '').trim();
  if (!value) return validateLinkedInApiVersion(LINKEDIN_DEFAULT_API_VERSION, now);
  return validateLinkedInApiVersion(value, now);
}

export interface LinkedInCredentials {
  clientId: string;
  clientSecret: string;
}

// A missing client id or secret disables connections and automatic publishing.
// Drafting stays available, and callers report the missing configuration
// instead of attempting a request that cannot succeed.
export function resolveLinkedInCredentials(): LinkedInCredentials {
  const clientId = config.linkedinClientId;
  const clientSecret = config.linkedinClientSecret;
  if (!clientId || !clientSecret) {
    throw new LinkedInConfigError(
      'LinkedIn is not configured on this deployment. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET.',
      'missing_credentials'
    );
  }
  return { clientId, clientSecret };
}

export function isLinkedInConfigured(): boolean {
  return Boolean(config.linkedinClientId && config.linkedinClientSecret);
}

// The callback is always derived from the configured app origin, never from
// request headers, so a forged Host cannot redirect the authorization code.
export function linkedInRedirectUri(appUrl: string = config.appUrl): string {
  return `${appUrl.replace(/\/+$/, '')}${LINKEDIN_CALLBACK_PATH}`;
}

// Protocol headers required by LinkedIn's versioned REST APIs. The version is
// passed in explicitly so a caller cannot accidentally mix versions.
export function linkedInApiHeaders(version: string): Record<string, string> {
  return {
    'linkedin-version': version,
    'x-restli-protocol-version': LINKEDIN_RESTLI_PROTOCOL_VERSION,
  };
}

export function linkedInPostsUrl(
  baseUrl: string = config.linkedinApiBaseUrl
): string {
  return `${baseUrl.replace(/\/+$/, '')}/rest/posts`;
}

export function linkedInUserInfoUrl(
  baseUrl: string = config.linkedinApiBaseUrl
): string {
  return `${baseUrl.replace(/\/+$/, '')}/v2/userinfo`;
}

const MEMBER_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

// Member author URNs are derived from the verified userinfo `sub`; a browser
// supplied author is never accepted.
export function linkedInMemberUrn(memberId: string): string {
  const value = String(memberId ?? '').trim();
  if (!MEMBER_ID_PATTERN.test(value)) {
    throw new LinkedInConfigError(
      'The connected LinkedIn member identifier is not valid.',
      'missing_credentials'
    );
  }
  return `urn:li:person:${value}`;
}

// Only documented share/ugcPost URNs have a stable public feed URL. Anything
// else returns undefined rather than inventing a link.
export function linkedInPostUrlFromUrn(urn: string): string | undefined {
  const value = String(urn ?? '').trim();
  if (!/^urn:li:(?:share|ugcPost):\d+$/.test(value)) return undefined;
  return `https://www.linkedin.com/feed/update/${value}`;
}
