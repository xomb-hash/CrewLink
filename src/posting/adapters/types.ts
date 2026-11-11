// Shared shapes for creator-owned account platforms. Each platform client keeps
// its own request/response logic; the connect and publish code only sees these
// neutral types.
//
// Tokens in this module are always plaintext values held in server memory for the
// duration of one call. Storage and API responses only ever use ciphertext or the
// redacted account metadata.

export type OAuthPlatform =
  | 'bluesky'
  | 'mastodon'
  | 'x'
  | 'reddit'
  | 'linkedin'
  | 'slack';

export type AdapterErrorCode =
  | 'invalid_input'
  | 'auth_failed'
  | 'token_expired'
  | 'revoked'
  | 'validation_error'
  | 'rate_limited'
  | 'instance_error'
  | 'transport_error'
  | 'uncertain';

export interface AdapterTokens {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
}

// Metadata that is safe to store and show the owner. It never includes a token.
export interface VerifiedAccount {
  externalAccountId: string;
  externalAccountName: string;
  instanceUrl?: string;
  instanceName?: string;
}

export interface OAuthSession {
  tokens: AdapterTokens;
  account: VerifiedAccount;
  // Scopes the provider reports as actually granted, when it reports them.
  scopes?: string[];
}

export interface PostResult {
  externalId: string;
  externalUrl?: string;
  // Present when the adapter refreshed an expiring access token during the send.
  tokens?: AdapterTokens;
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly code: AdapterErrorCode,
    readonly retryAfterSeconds?: number,
    // Tokens refreshed before a failed send, so the caller can persist them.
    readonly tokens?: AdapterTokens
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export interface BlueskyClientLike {
  readonly platform: 'bluesky';
  createSession(identifier: string, appPassword: string): Promise<OAuthSession>;
  getSession(accessToken: string): Promise<VerifiedAccount>;
  refreshSession(refreshToken: string, refreshKey?: string): Promise<OAuthSession>;
  sendPost(input: {
    tokens: AdapterTokens;
    account: VerifiedAccount;
    text: string;
    // Connection id, used to single-flight and briefly reuse a rotated session.
    refreshKey?: string;
  }): Promise<PostResult>;
}

export interface MastodonApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface MastodonClientLike {
  readonly platform: 'mastodon';
  registerApp(instanceUrl: string, redirectUri: string): Promise<MastodonApp>;
  authorizationUrl(input: {
    instanceUrl: string;
    clientId: string;
    redirectUri: string;
    state: string;
  }): string;
  exchangeCode(input: {
    instanceUrl: string;
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<{ accessToken: string; scopes: string[] }>;
  verifyAccount(instanceUrl: string, accessToken: string): Promise<VerifiedAccount>;
  // The connected instance decides this; null means "not reported".
  getStatusCharacterLimit(instanceUrl: string): Promise<number | null>;
  sendStatus(input: {
    instanceUrl: string;
    accessToken: string;
    text: string;
    idempotencyKey?: string;
  }): Promise<PostResult>;
}

// Reddit metadata is read-only discovery data. Every field is optional because
// subreddits expose different amounts of information.
export interface RedditSubreddit {
  name: string;
  title?: string;
  description?: string;
  subscribers?: number;
  // public, restricted, private, archived, employees, gold_only...
  subredditType?: string;
  // any, self or link.
  submissionType?: string;
  over18?: boolean;
  userIsBanned?: boolean;
  userIsMuted?: boolean;
  userIsContributor?: boolean;
  url?: string;
}

export interface RedditRule {
  name: string;
  description?: string;
  kind?: string;
}

// Fields reported by Reddit's post_requirements endpoint. Unknown fields are
// preserved in `rawFields` and ignored by validation rather than guessed.
export interface RedditPostRequirements {
  titleMinLength?: number;
  titleMaxLength?: number;
  bodyMinLength?: number;
  bodyMaxLength?: number;
  titleRequired?: boolean;
  bodyRequired?: boolean;
  linkRequired?: boolean;
  linkRestrictionPolicy?: string;
  domainBlacklist?: string[];
  domainWhitelist?: string[];
  titleBlacklistedStrings?: string[];
  titleRequiredStrings?: string[];
  bodyBlacklistedStrings?: string[];
  bodyRequiredStrings?: string[];
  flairRequired?: boolean;
  galleryRequired?: boolean;
  rawFields?: Record<string, unknown>;
}

export interface RedditClientLike {
  readonly platform: 'reddit';
  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string;
  exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<OAuthSession>;
  refreshSession(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<AdapterTokens>;
  verifyAccount(accessToken: string): Promise<VerifiedAccount>;
  revoke(input: {
    clientId: string;
    clientSecret: string;
    accessToken: string;
  }): Promise<void>;
  searchSubreddits(accessToken: string, query: string, limit?: number): Promise<RedditSubreddit[]>;
  getSubreddit(accessToken: string, name: string): Promise<RedditSubreddit>;
  getRules(accessToken: string, name: string): Promise<RedditRule[]>;
  getPostRequirements(accessToken: string, name: string): Promise<RedditPostRequirements>;
  submit(input: {
    tokens: AdapterTokens;
    subreddit: string;
    kind: 'self' | 'link';
    title: string;
    body?: string;
    url?: string;
  }): Promise<PostResult>;
}

// X OAuth 2.0 already has a PKCE challenge and a rotating refresh token, so the
// client takes them explicitly rather than reading browser input.
export interface XClientLike {
  readonly platform: 'x';
  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string;
  exchangeCode(input: {
    clientId: string;
    clientSecret?: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<OAuthSession>;
  refreshSession(input: {
    clientId: string;
    clientSecret?: string;
    refreshToken: string;
  }): Promise<AdapterTokens>;
  verifyAccount(accessToken: string): Promise<VerifiedAccount>;
  revoke(input: {
    clientId: string;
    clientSecret?: string;
    accessToken: string;
  }): Promise<void>;
  sendPost(input: {
    tokens: AdapterTokens;
    text: string;
    // Replies chain a thread; the first post has no reply target.
    replyToId?: string;
  }): Promise<PostResult>;
}

// Slack issues a bot token for one installed workspace. The token is created by
// the OAuth v2 exchange on the server and is never accepted from the browser.
export interface SlackWorkspace {
  id: string;
  name: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  // True only when the Crewlink bot itself is a member. The owner's membership
  // is irrelevant and is never used to widen what the bot can see.
  isMember: boolean;
  isArchived: boolean;
}

export interface SlackOAuthSession extends OAuthSession {
  workspace: SlackWorkspace;
  botUserId: string;
}

export interface SlackClientLike {
  readonly platform: 'slack';
  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string;
  exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<SlackOAuthSession>;
  verifyWorkspace(accessToken: string): Promise<{
    workspace: SlackWorkspace;
    botUserId: string;
    botName: string;
  }>;
  listChannels(accessToken: string): Promise<SlackChannel[]>;
  getChannel(accessToken: string, channelId: string): Promise<SlackChannel>;
  sendMessage(input: {
    tokens: AdapterTokens;
    channelId: string;
    text: string;
  }): Promise<PostResult>;
  revoke(accessToken: string): Promise<void>;
}

// LinkedIn's current OAuth flow documents no PKCE parameters, so the client
// takes no code challenge. Refresh is only used when LinkedIn actually issued a
// refresh token (Marketing Developer Platform partners); otherwise expiry leads
// to a reconnect.
export interface LinkedInClientLike {
  readonly platform: 'linkedin';
  // The version every request in this client sends, for test assertions.
  readonly apiVersion: string;
  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string;
  exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<OAuthSession>;
  refreshSession(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<AdapterTokens>;
  verifyAccount(accessToken: string): Promise<VerifiedAccount>;
  // `authorId` is the verified userinfo `sub`; the adapter builds the URN.
  sendPost(input: {
    tokens: AdapterTokens;
    authorId: string;
    text: string;
  }): Promise<PostResult>;
}
