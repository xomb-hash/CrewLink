import crypto from 'node:crypto';
import { config } from '../config/index';
import { storage } from '../lib/storage';
import { byId } from '../platforms/registry';
import { getCredentialVault, type EncryptedCredential, CredentialDecryptionError } from './credentials';
import { createPkcePair } from './x/pkce';
import { BotError, type BotPlatform, type VerifiedChannel } from './bots/types';
import { getBotClient, loadBotToken } from './bots/index';
import {
  AdapterError,
  getBlueskyClient,
  getLinkedInClient,
  getMastodonClient,
  getRedditClient,
  getSlackClient,
  getXClient,
  isSlackConfigured,
  LINKEDIN_SCOPES,
  LinkedInConfigError,
  MASTODON_SCOPES,
  normalizeMastodonInstanceUrl,
  REDDIT_SCOPES,
  resolveLinkedInCredentials,
  SLACK_SCOPES,
  X_SCOPES,
  type AdapterTokens,
  type SlackChannel,
  type VerifiedAccount,
} from './adapters/index';
import type {
  Platform,
  PlatformConnection,
  StoredPlatformConnection,
} from '../types/index';

export type ConnectionErrorCode =
  | 'unknown_platform'
  | 'manual_platform'
  | 'invalid_input'
  | 'project_not_found'
  | 'forbidden'
  | 'connection_not_found'
  | 'connection_inactive'
  | 'bot_requires_verification'
  | 'bot_verification_failed'
  | 'invalid_credentials'
  | 'platform_rate_limited'
  | 'platform_unreachable'
  | 'oauth_state_invalid';

export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly code: ConnectionErrorCode,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'ConnectionError';
  }
}

// --- Map an adapter failure to a connection error without leaking credentials ---
function fromAdapterError(err: AdapterError, platformName: string): ConnectionError {
  switch (err.code) {
    case 'auth_failed':
    case 'revoked':
    case 'token_expired':
      return new ConnectionError(
        err.message || `${platformName} rejected the account credentials.`,
        'invalid_credentials'
      );
    case 'rate_limited':
      return new ConnectionError(err.message, 'platform_rate_limited', err.retryAfterSeconds);
    case 'invalid_input':
    case 'validation_error':
      return new ConnectionError(err.message, 'invalid_input');
    default:
      return new ConnectionError(
        err.message || `${platformName} could not be reached.`,
        'platform_unreachable'
      );
  }
}

function newConnectionId(): string {
  return `pcn_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function oauthRedirectUri(
  platform: 'mastodon' | 'x' | 'reddit' | 'linkedin' | 'slack'
): string {
  return `${config.appUrl.replace(/\/+$/, '')}/api/platforms/${platform}/callback`;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export interface SaveConnectionInput {
  userId: string;
  projectId: string;
  platformId: string;
  accessToken: string;
  refreshToken?: string;
  scopes?: string[];
  externalAccountId?: string;
  externalAccountName?: string;
  channelId?: string;
  channelName?: string;
  tokenExpiresAt?: string | null;
}

export interface ConnectionTokens {
  connectionId: string;
  platformId: string;
  projectId: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
}

const cleanOptional = (value: unknown, max: number): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text ? text.slice(0, max) : undefined;
};

const cleanScopes = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const scopes = value
    .map((scope) => String(scope || '').trim().slice(0, 100))
    .filter(Boolean);
  return [...new Set(scopes)].slice(0, 50);
};

const parseExpiry = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ConnectionError('Token expiry is not a valid date.', 'invalid_input');
  }
  return date.toISOString();
};

// Strips every token field so the result is safe to return from an API route.
function toSummary(connection: StoredPlatformConnection): PlatformConnection {
  return {
    id: connection.id,
    userId: connection.userId,
    projectId: connection.projectId,
    platformId: connection.platformId,
    externalAccountId: connection.externalAccountId,
    externalAccountName: connection.externalAccountName,
    serverId: connection.serverId,
    serverName: connection.serverName,
    channelId: connection.channelId,
    channelName: connection.channelName,
    instanceUrl: connection.instanceUrl,
    status: connection.status,
    scopes: connection.scopes,
    tokenExpiresAt: connection.tokenExpiresAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

function requireConnectablePlatform(platformId: string): Platform {
  const platform = byId(platformId);
  if (!platform) {
    throw new ConnectionError('Unknown platform.', 'unknown_platform');
  }
  if (platform.auth === 'manual') {
    throw new ConnectionError(
      `${platform.name} is posted by hand, so it has no account to connect.`,
      'manual_platform'
    );
  }
  return platform;
}

function requireOwnedProject(userId: string, projectId: string) {
  return storage.getProjectById(projectId).then((project) => {
    if (!project) {
      throw new ConnectionError('Project not found.', 'project_not_found');
    }
    if (project.ownerId !== userId) {
      throw new ConnectionError('Only the project owner can manage connections.', 'forbidden');
    }
    return project;
  });
}

// --- Save or replace the connection for one owner, project and platform ---
// Tokens are encrypted before they touch storage. A re-save keeps the existing
// record id (and therefore the same AAD binding) and replaces the credentials.
// Bot platforms are rejected here: they go through connectBotChannel, which
// verifies bot membership and posting rights before the connection goes active.
export async function saveConnection(input: SaveConnectionInput): Promise<PlatformConnection> {
  const platform = requireConnectablePlatform(input.platformId);
  await requireOwnedProject(input.userId, input.projectId);

  if (platform.auth === 'bot') {
    throw new ConnectionError(
      `${platform.name} uses the Crewlink bot. Connect a channel so the bot can be verified.`,
      'bot_requires_verification'
    );
  }

  // Creator-owned accounts are only connected by verifying their credentials or
  // completing OAuth; accepting a pasted token here would bypass verification.
  if (
    platform.id === 'bluesky' ||
    platform.id === 'mastodon' ||
    platform.id === 'x' ||
    platform.id === 'reddit' ||
    platform.id === 'linkedin' ||
    platform.id === 'slack'
  ) {
    throw new ConnectionError(
      `${platform.name} connects through its own account flow.`,
      'invalid_input'
    );
  }

  const accessToken = String(input.accessToken || '').trim();
  if (!accessToken) {
    throw new ConnectionError('An access token is required for this platform.', 'invalid_input');
  }

  const channelId = cleanOptional(input.channelId, 200);

  const existing = await storage.findPlatformConnection(
    input.userId,
    input.projectId,
    input.platformId
  );
  const connectionId = existing?.id ?? `pcn_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const vault = getCredentialVault();
  const context = {
    userId: input.userId,
    platformId: platform.id,
    connectionId,
  };

  const encryptedAccess = await vault.encrypt(accessToken, context);
  const refreshToken = cleanOptional(input.refreshToken, 4000);
  const encryptedRefresh = refreshToken
    ? await vault.encrypt(refreshToken, context)
    : undefined;

  const now = new Date().toISOString();
  const saved = await storage.upsertPlatformConnection({
    id: connectionId,
    userId: input.userId,
    projectId: input.projectId,
    platformId: platform.id,
    externalAccountId: cleanOptional(input.externalAccountId, 200),
    externalAccountName: cleanOptional(input.externalAccountName, 100),
    channelId,
    channelName: cleanOptional(input.channelName, 200),
    status: 'active',
    scopes: cleanScopes(input.scopes),
    tokenExpiresAt: parseExpiry(input.tokenExpiresAt),
    accessTokenCiphertext: encryptedAccess.ciphertext,
    // Providers often omit the refresh token on re-authorisation; keep the old one.
    refreshTokenCiphertext: encryptedRefresh?.ciphertext ?? existing?.refreshTokenCiphertext,
    credentialProvider: encryptedAccess.provider,
    keyRef: encryptedAccess.keyRef,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  return toSummary(saved);
}

export interface ConnectBotChannelInput {
  userId: string;
  projectId: string;
  platformId: string;
  channelId: string;
}

function requireBotPlatform(platform: Platform): BotPlatform {
  if (platform.id === 'discord' || platform.id === 'telegram') return platform.id;
  throw new ConnectionError(
    `${platform.name} does not use the Crewlink bot.`,
    'invalid_input'
  );
}

// --- Connect one creator-owned channel through the Crewlink bot ---
// The owner supplies a channel id, never a token. Membership and posting rights
// are verified before the connection is saved as active, and the record holds no
// token material at all (provider 'none').
export async function connectBotChannel(
  input: ConnectBotChannelInput
): Promise<PlatformConnection> {
  const platform = requireConnectablePlatform(input.platformId);
  const botPlatform = requireBotPlatform(platform);
  await requireOwnedProject(input.userId, input.projectId);

  const channelId = String(input.channelId || '').trim();
  if (!channelId || channelId.length > 100 || !/^[@\w-]+$/.test(channelId)) {
    throw new ConnectionError('Choose a channel before connecting.', 'invalid_input');
  }

  let verified: VerifiedChannel;
  try {
    const botToken = await loadBotToken(botPlatform);
    verified = await getBotClient(botPlatform).verifyChannel(botToken, channelId);
  } catch (err) {
    if (err instanceof BotError) {
      throw new ConnectionError(err.message, 'bot_verification_failed');
    }
    throw err;
  }

  const existing = await storage.findPlatformConnection(
    input.userId,
    input.projectId,
    platform.id
  );

  // A different channel or server is a publishing-options change: approved
  // drafts for this platform no longer describe where they were approved for.
  const destinationChanged =
    existing?.channelId !== undefined &&
    (existing.channelId !== verified.channelId ||
      (existing.serverId !== undefined &&
        verified.serverId !== undefined &&
        existing.serverId !== verified.serverId));
  if (destinationChanged) {
    await storage.invalidateDraftApprovals(input.projectId, platform.id);
  }

  const now = new Date().toISOString();
  const saved = await storage.upsertPlatformConnection({
    id: existing?.id ?? `pcn_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    userId: input.userId,
    projectId: input.projectId,
    platformId: platform.id,
    serverId: verified.serverId,
    serverName: verified.serverName,
    channelId: verified.channelId,
    channelName: verified.channelName,
    status: 'active',
    scopes: [],
    accessTokenCiphertext: '',
    credentialProvider: 'none',
    keyRef: '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  return toSummary(saved);
}

// --- Creator-owned Bluesky account: app password sign-in, token storage only ---
// The app password is used once to create an AT Protocol session and is never
// stored. Access and refresh JWTs are encrypted with the M1 vault.
export interface ConnectBlueskyInput {
  userId: string;
  projectId: string;
  identifier: string;
  appPassword: string;
}

export async function connectBlueskyAccount(
  input: ConnectBlueskyInput
): Promise<PlatformConnection> {
  requireConnectablePlatform('bluesky');
  await requireOwnedProject(input.userId, input.projectId);

  const identifier = String(input.identifier || '').trim();
  const appPassword = String(input.appPassword || '').trim();
  if (!identifier || identifier.length > 320) {
    throw new ConnectionError('Enter your Bluesky handle or email.', 'invalid_input');
  }
  if (!appPassword || appPassword.length > 500) {
    throw new ConnectionError('Enter a Bluesky app password.', 'invalid_input');
  }

  let session;
  try {
    session = await getBlueskyClient().createSession(identifier, appPassword);
  } catch (err) {
    if (err instanceof AdapterError) throw fromAdapterError(err, 'Bluesky');
    throw err;
  }

  const account = session.account;
  const existing = await storage.findPlatformConnection(
    input.userId,
    input.projectId,
    'bluesky'
  );

  // Re-authorising the same account keeps approvals valid. A different account
  // is a destination change, so every approved Bluesky draft must be re-approved
  // even when the previous connection was revoked or disconnected.
  if (
    existing?.externalAccountId &&
    existing.externalAccountId !== account.externalAccountId
  ) {
    await storage.invalidateDraftApprovals(input.projectId, 'bluesky');
  }

  const connectionId = existing?.id ?? newConnectionId();
  const vault = getCredentialVault();
  const context = { userId: input.userId, platformId: 'bluesky', connectionId };
  const access = await vault.encrypt(session.tokens.accessToken, context);
  const refresh = session.tokens.refreshToken
    ? await vault.encrypt(session.tokens.refreshToken, context)
    : undefined;

  const now = new Date().toISOString();
  const saved = await storage.upsertPlatformConnection({
    id: connectionId,
    userId: input.userId,
    projectId: input.projectId,
    platformId: 'bluesky',
    externalAccountId: account.externalAccountId,
    externalAccountName: account.externalAccountName,
    status: 'active',
    scopes: [],
    tokenExpiresAt: session.tokens.tokenExpiresAt,
    accessTokenCiphertext: access.ciphertext,
    refreshTokenCiphertext: refresh?.ciphertext ?? existing?.refreshTokenCiphertext,
    credentialProvider: access.provider,
    keyRef: access.keyRef,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  return toSummary(saved);
}

// --- Creator-owned Mastodon account: OAuth app registration + authorization ---
export interface BeginMastodonAuthorizationInput {
  userId: string;
  projectId: string;
  instanceUrl: string;
  // Signed-in session that started the flow. The state is bound to it so a
  // stolen callback URL cannot be completed from another session.
  sessionId: string;
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

interface PendingMastodonOAuth {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  instanceUrl: string;
  sessionHash: string;
}

async function clearMastodonPending(connectionId: string): Promise<void> {
  // Only clears the handshake that was just consumed. A newer pending handshake
  // (or a successful connection) on the same record is left untouched.
  await storage.finishOAuthFailure(connectionId);
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function beginMastodonAuthorization(
  input: BeginMastodonAuthorizationInput
): Promise<{ authorizationUrl: string }> {
  requireConnectablePlatform('mastodon');
  await requireOwnedProject(input.userId, input.projectId);

  const sessionId = String(input.sessionId || '');
  if (!sessionId) {
    throw new ConnectionError('Please sign in again to connect Mastodon.', 'forbidden');
  }

  let instanceUrl: string;
  try {
    instanceUrl = normalizeMastodonInstanceUrl(input.instanceUrl);
  } catch (err) {
    if (err instanceof AdapterError) throw fromAdapterError(err, 'Mastodon');
    throw err;
  }

  const redirectUri = oauthRedirectUri('mastodon');
  let app;
  try {
    app = await getMastodonClient().registerApp(instanceUrl, redirectUri);
  } catch (err) {
    if (err instanceof AdapterError) throw fromAdapterError(err, 'Mastodon');
    throw err;
  }

  const existing = await storage.findPlatformConnection(
    input.userId,
    input.projectId,
    'mastodon'
  );
  const connectionId = existing?.id ?? newConnectionId();
  const vault = getCredentialVault();
  const context = { userId: input.userId, platformId: 'mastodon', connectionId };

  const pendingPayload: PendingMastodonOAuth = {
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    redirectUri: app.redirectUri,
    instanceUrl,
    sessionHash: sha256(sessionId),
  };
  const pending = await vault.encrypt(JSON.stringify(pendingPayload), context);
  const state = crypto.randomBytes(32).toString('hex');

  const now = new Date().toISOString();
  // Keep an active connection usable (and pointed at its old instance) until the
  // callback succeeds. Its tokens are only replaced after the account verifies.
  const keepActive = existing?.status === 'active';
  await storage.upsertPlatformConnection({
    id: connectionId,
    userId: input.userId,
    projectId: input.projectId,
    platformId: 'mastodon',
    externalAccountId: existing?.externalAccountId,
    externalAccountName: existing?.externalAccountName,
    instanceUrl: keepActive ? existing.instanceUrl : instanceUrl,
    status: keepActive ? 'active' : 'pending',
    scopes: existing?.scopes ?? [],
    tokenExpiresAt: existing?.tokenExpiresAt,
    accessTokenCiphertext: existing?.accessTokenCiphertext ?? '',
    refreshTokenCiphertext: existing?.refreshTokenCiphertext,
    credentialProvider: existing?.credentialProvider ?? 'none',
    keyRef: existing?.keyRef ?? '',
    oauthStateHash: sha256(state),
    oauthStateExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
    pendingOAuthCiphertext: JSON.stringify(pending),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  return {
    authorizationUrl: getMastodonClient().authorizationUrl({
      instanceUrl,
      clientId: app.clientId,
      redirectUri: app.redirectUri,
      state,
    }),
  };
}

export async function completeMastodonAuthorization(input: {
  userId: string;
  state: string;
  code: string;
  sessionId: string;
}): Promise<PlatformConnection> {
  const state = String(input.state || '').trim();
  const sessionId = String(input.sessionId || '');
  const invalidState = () =>
    new ConnectionError(
      'The OAuth state is missing or expired. Start the connection again.',
      'oauth_state_invalid'
    );
  if (!state || !sessionId) throw invalidState();

  const stateHash = sha256(state);
  const pending = await storage.findPlatformConnectionByOAuthState(stateHash);
  if (
    !pending ||
    pending.platformId !== 'mastodon' ||
    pending.userId !== input.userId ||
    !pending.pendingOAuthCiphertext
  ) {
    throw invalidState();
  }

  // Expired handshakes are consumed and cleared without contacting the instance.
  if (
    !pending.oauthStateExpiresAt ||
    Date.parse(pending.oauthStateExpiresAt) <= Date.now()
  ) {
    if (await storage.claimOAuthState(stateHash)) {
      await clearMastodonPending(pending.id);
    }
    throw invalidState();
  }

  // Capture the handshake before the claim clears it; file-backed storage hands
  // back the live record, so the atomic consume would otherwise null our copy.
  const pendingCiphertext = pending.pendingOAuthCiphertext;

  // Atomic single-use claim: concurrent callbacks (or a replay) can never both
  // exchange the code. The loser sees an already-consumed state.
  if (!(await storage.claimOAuthState(stateHash))) throw invalidState();

  const vault = getCredentialVault();
  const context = { userId: pending.userId, platformId: 'mastodon', connectionId: pending.id };
  let payload: PendingMastodonOAuth;
  try {
    const envelope = JSON.parse(pendingCiphertext) as EncryptedCredential;
    const plaintext = await vault.decrypt(envelope, context);
    const parsed = JSON.parse(plaintext) as Partial<PendingMastodonOAuth>;
    payload = {
      clientId: String(parsed.clientId || ''),
      clientSecret: String(parsed.clientSecret || ''),
      redirectUri: String(parsed.redirectUri || ''),
      instanceUrl: normalizeMastodonInstanceUrl(String(parsed.instanceUrl || '')),
      sessionHash: String(parsed.sessionHash || ''),
    };
    if (!payload.clientId || !payload.clientSecret || !payload.redirectUri) {
      throw new Error('incomplete pending authorization');
    }
  } catch {
    await clearMastodonPending(pending.id);
    throw new ConnectionError(
      'The OAuth handshake could not be read. Start the connection again.',
      'oauth_state_invalid'
    );
  }

  // The state is bound to the signed-in session that started the handshake, not
  // only to the user, so a callback URL shared between sessions is rejected.
  if (!payload.sessionHash || !sameHash(payload.sessionHash, sha256(sessionId))) {
    await clearMastodonPending(pending.id);
    throw invalidState();
  }

  const client = getMastodonClient();
  let exchanged: { accessToken: string; scopes: string[] };
  try {
    exchanged = await client.exchangeCode({
      instanceUrl: payload.instanceUrl,
      clientId: payload.clientId,
      clientSecret: payload.clientSecret,
      code: String(input.code || ''),
      redirectUri: payload.redirectUri,
    });
  } catch (err) {
    await clearMastodonPending(pending.id);
    if (err instanceof AdapterError) throw fromAdapterError(err, 'Mastodon');
    throw err;
  }

  let account: VerifiedAccount;
  try {
    account = await client.verifyAccount(payload.instanceUrl, exchanged.accessToken);
  } catch (err) {
    await clearMastodonPending(pending.id);
    if (err instanceof AdapterError) throw fromAdapterError(err, 'Mastodon');
    throw err;
  }

  // The pending row still points at the old instance during a reconnect, so it
  // is the reliable "before" value for destination-change detection. A revoked
  // or disconnected record still counts: reconnecting to a different account or
  // instance invalidates approvals.
  const destinationChanged =
    Boolean(pending.externalAccountId) &&
    (pending.externalAccountId !== account.externalAccountId ||
      pending.instanceUrl !== payload.instanceUrl);
  if (destinationChanged) {
    await storage.invalidateDraftApprovals(pending.projectId, 'mastodon');
  }

  const access = await vault.encrypt(exchanged.accessToken, {
    userId: pending.userId,
    platformId: 'mastodon',
    connectionId: pending.id,
  });
  const scopes = exchanged.scopes.length ? exchanged.scopes : [...MASTODON_SCOPES];

  const saved = await storage.upsertPlatformConnection({
    ...pending,
    externalAccountId: account.externalAccountId,
    externalAccountName: account.externalAccountName,
    instanceUrl: payload.instanceUrl,
    status: 'active',
    scopes,
    tokenExpiresAt: undefined,
    accessTokenCiphertext: access.ciphertext,
    refreshTokenCiphertext: undefined,
    credentialProvider: access.provider,
    keyRef: access.keyRef,
    oauthStateHash: undefined,
    oauthStateExpiresAt: undefined,
    pendingOAuthCiphertext: undefined,
  });

  return toSummary(saved);
}

// A denied or failed callback must invalidate the same state so it cannot be
// reused. The userId check prevents one signed-in user from cancelling another
// user's handshake if a callback URL leaks.
export async function cancelMastodonAuthorization(
  state: string,
  options: { userId?: string } = {}
): Promise<void> {
  const value = String(state || '').trim();
  if (!value) return;
  const stateHash = sha256(value);
  const pending = await storage.findPlatformConnectionByOAuthState(stateHash);
  if (!pending || pending.platformId !== 'mastodon') return;
  if (options.userId && pending.userId !== options.userId) return;
  if (await storage.claimOAuthState(stateHash)) {
    await clearMastodonPending(pending.id);
  }
}

// --- Creator-owned X account: OAuth 2.0 Authorization Code with PKCE ---
// The verifier is generated server-side and stored only inside the encrypted
// pending payload. The public client id may reach the browser; the secret never
// does. State handling matches Mastodon exactly: hashed, session-bound,
// single-use and expiring.
export interface BeginXAuthorizationInput {
  userId: string;
  projectId: string;
  sessionId: string;
}

interface PendingXOAuth {
  codeVerifier: string;
  redirectUri: string;
  sessionHash: string;
}

async function clearXPending(connectionId: string): Promise<void> {
  await storage.finishOAuthFailure(connectionId);
}

export async function beginXAuthorization(
  input: BeginXAuthorizationInput
): Promise<{ authorizationUrl: string }> {
  requireConnectablePlatform('x');
  await requireOwnedProject(input.userId, input.projectId);

  if (!config.xClientId) {
    throw new ConnectionError(
      'Automatic X publishing is not configured on this Crewlink server.',
      'invalid_input'
    );
  }
  const sessionId = String(input.sessionId || '');
  if (!sessionId) {
    throw new ConnectionError('Please sign in again to connect X.', 'forbidden');
  }

  const redirectUri = oauthRedirectUri('x');
  const existing = await storage.findPlatformConnection(input.userId, input.projectId, 'x');
  const connectionId = existing?.id ?? newConnectionId();
  const vault = getCredentialVault();
  const context = { userId: input.userId, platformId: 'x', connectionId };

  const { verifier, challenge } = createPkcePair();
  const pendingPayload: PendingXOAuth = {
    codeVerifier: verifier,
    redirectUri,
    sessionHash: sha256(sessionId),
  };
  const pending = await vault.encrypt(JSON.stringify(pendingPayload), context);
  const state = crypto.randomBytes(32).toString('hex');

  const now = new Date().toISOString();
  // An active connection stays usable until the callback verifies the account.
  const keepActive = existing?.status === 'active';
  await storage.upsertPlatformConnection({
    id: connectionId,
    userId: input.userId,
    projectId: input.projectId,
    platformId: 'x',
    externalAccountId: existing?.externalAccountId,
    externalAccountName: existing?.externalAccountName,
    status: keepActive ? 'active' : 'pending',
    scopes: existing?.scopes ?? [],
    tokenExpiresAt: existing?.tokenExpiresAt,
    accessTokenCiphertext: existing?.accessTokenCiphertext ?? '',
    refreshTokenCiphertext: existing?.refreshTokenCiphertext,
    credentialProvider: existing?.credentialProvider ?? 'none',
    keyRef: existing?.keyRef ?? '',
    oauthStateHash: sha256(state),
    oauthStateExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
    pendingOAuthCiphertext: JSON.stringify(pending),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  return {
    authorizationUrl: getXClient().authorizationUrl({
      clientId: config.xClientId,
      redirectUri,
      state,
      codeChallenge: challenge,
    }),
  };
}

export async function completeXAuthorization(input: {
  userId: string;
  state: string;
  code: string;
  sessionId: string;
}): Promise<PlatformConnection> {
  const state = String(input.state || '').trim();
  const sessionId = String(input.sessionId || '');
  const invalidState = () =>
    new ConnectionError(
      'The OAuth state is missing or expired. Start the connection again.',
      'oauth_state_invalid'
    );
  if (!state || !sessionId || !config.xClientId) throw invalidState();

  const stateHash = sha256(state);
  const pending = await storage.findPlatformConnectionByOAuthState(stateHash);
  if (
    !pending ||
    pending.platformId !== 'x' ||
    pending.userId !== input.userId ||
    !pending.pendingOAuthCiphertext
  ) {
    throw invalidState();
  }

  if (
    !pending.oauthStateExpiresAt ||
    Date.parse(pending.oauthStateExpiresAt) <= Date.now()
  ) {
    if (await storage.claimOAuthState(stateHash)) {
      await clearXPending(pending.id);
    }
    throw invalidState();
  }

  const pendingCiphertext = pending.pendingOAuthCiphertext;
  if (!(await storage.claimOAuthState(stateHash))) throw invalidState();

  const vault = getCredentialVault();
  const context = { userId: pending.userId, platformId: 'x', connectionId: pending.id };
  let payload: PendingXOAuth;
  try {
    const envelope = JSON.parse(pendingCiphertext) as EncryptedCredential;
    const plaintext = await vault.decrypt(envelope, context);
    const parsed = JSON.parse(plaintext) as Partial<PendingXOAuth>;
    payload = {
      codeVerifier: String(parsed.codeVerifier || ''),
      redirectUri: String(parsed.redirectUri || ''),
      sessionHash: String(parsed.sessionHash || ''),
    };
    if (!payload.codeVerifier || !payload.redirectUri) {
      throw new Error('incomplete pending authorization');
    }
  } catch {
    await clearXPending(pending.id);
    throw new ConnectionError(
      'The OAuth handshake could not be read. Start the connection again.',
      'oauth_state_invalid'
    );
  }

  if (!payload.sessionHash || !sameHash(payload.sessionHash, sha256(sessionId))) {
    await clearXPending(pending.id);
    throw invalidState();
  }

  const client = getXClient();
  let session;
  try {
    session = await client.exchangeCode({
      clientId: config.xClientId,
      clientSecret: config.xClientSecret || undefined,
      code: String(input.code || ''),
      redirectUri: payload.redirectUri,
      codeVerifier: payload.codeVerifier,
    });
  } catch (err) {
    await clearXPending(pending.id);
    if (err instanceof AdapterError) throw fromAdapterError(err, 'X');
    throw err;
  }

  const account = session.account;
  const destinationChanged =
    Boolean(pending.externalAccountId) &&
    pending.externalAccountId !== account.externalAccountId;
  if (destinationChanged) {
    await storage.invalidateDraftApprovals(pending.projectId, 'x');
  }

  const access = await vault.encrypt(session.tokens.accessToken, {
    userId: pending.userId,
    platformId: 'x',
    connectionId: pending.id,
  });
  const refresh = session.tokens.refreshToken
    ? await vault.encrypt(session.tokens.refreshToken, {
        userId: pending.userId,
        platformId: 'x',
        connectionId: pending.id,
      })
    : undefined;

  const saved = await storage.upsertPlatformConnection({
    ...pending,
    externalAccountId: account.externalAccountId,
    externalAccountName: account.externalAccountName,
    status: 'active',
    scopes: [...X_SCOPES],
    tokenExpiresAt: session.tokens.tokenExpiresAt,
    accessTokenCiphertext: access.ciphertext,
    refreshTokenCiphertext: refresh?.ciphertext,
    credentialProvider: access.provider,
    keyRef: access.keyRef,
    oauthStateHash: undefined,
    oauthStateExpiresAt: undefined,
    pendingOAuthCiphertext: undefined,
  });

  return toSummary(saved);
}

export async function cancelXAuthorization(
  state: string,
  options: { userId?: string } = {}
): Promise<void> {
  const value = String(state || '').trim();
  if (!value) return;
  const stateHash = sha256(value);
  const pending = await storage.findPlatformConnectionByOAuthState(stateHash);
  if (!pending || pending.platformId !== 'x') return;
  if (options.userId && pending.userId !== options.userId) return;
  if (await storage.claimOAuthState(stateHash)) {
    await clearXPending(pending.id);
  }
}

// --- Creator-owned Reddit account: OAuth 2.0 authorization code ---
// Reddit uses HTTP Basic client authentication and no PKCE, so the client secret
// stays server-side and is read from configuration, never from the browser.
// State handling is the same as X and Mastodon: hashed, session-bound, expiring
// and consumed atomically.
export interface BeginRedditAuthorizationInput {
  userId: string;
  projectId: string;
  sessionId: string;
}

interface PendingRedditOAuth {
  redirectUri: string;
  sessionHash: string;
}

async function clearRedditPending(connectionId: string): Promise<void> {
  await storage.finishOAuthFailure(connectionId);
}

export async function beginRedditAuthorization(
  input: BeginRedditAuthorizationInput
): Promise<{ authorizationUrl: string }> {
  requireConnectablePlatform('reddit');
  await requireOwnedProject(input.userId, input.projectId);

  if (!config.redditClientId || !config.redditClientSecret) {
    throw new ConnectionError(
      'Automatic Reddit publishing is not configured on this Crewlink server.',
      'invalid_input'
    );
  }
  const sessionId = String(input.sessionId || '');
  if (!sessionId) {
    throw new ConnectionError('Please sign in again to connect Reddit.', 'forbidden');
  }

  const redirectUri = oauthRedirectUri('reddit');
  const existing = await storage.findPlatformConnection(input.userId, input.projectId, 'reddit');
  const connectionId = existing?.id ?? newConnectionId();
  const vault = getCredentialVault();
  const context = { userId: input.userId, platformId: 'reddit', connectionId };

  const pendingPayload: PendingRedditOAuth = {
    redirectUri,
    sessionHash: sha256(sessionId),
  };
  const pending = await vault.encrypt(JSON.stringify(pendingPayload), context);
  const state = crypto.randomBytes(32).toString('hex');

  const now = new Date().toISOString();
  // An active connection stays usable until the callback verifies the account.
  const keepActive = existing?.status === 'active';
  await storage.upsertPlatformConnection({
    id: connectionId,
    userId: input.userId,
    projectId: input.projectId,
    platformId: 'reddit',
    externalAccountId: existing?.externalAccountId,
    externalAccountName: existing?.externalAccountName,
    status: keepActive ? 'active' : 'pending',
    scopes: existing?.scopes ?? [],
    tokenExpiresAt: existing?.tokenExpiresAt,
    accessTokenCiphertext: existing?.accessTokenCiphertext ?? '',
    refreshTokenCiphertext: existing?.refreshTokenCiphertext,
    credentialProvider: existing?.credentialProvider ?? 'none',
    keyRef: existing?.keyRef ?? '',
    oauthStateHash: sha256(state),
    oauthStateExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
    pendingOAuthCiphertext: JSON.stringify(pending),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  return {
    authorizationUrl: getRedditClient().authorizationUrl({
      clientId: config.redditClientId,
      redirectUri,
      state,
    }),
  };
}

export async function completeRedditAuthorization(input: {
  userId: string;
  state: string;
  code: string;
  sessionId: string;
}): Promise<PlatformConnection> {
  const state = String(input.state || '').trim();
  const sessionId = String(input.sessionId || '');
  const invalidState = () =>
    new ConnectionError(
      'The OAuth state is missing or expired. Start the connection again.',
      'oauth_state_invalid'
    );
  if (!state || !sessionId || !config.redditClientId || !config.redditClientSecret) {
    throw invalidState();
  }

  const stateHash = sha256(state);
  const pending = await storage.findPlatformConnectionByOAuthState(stateHash);
  if (
    !pending ||
    pending.platformId !== 'reddit' ||
    pending.userId !== input.userId ||
    !pending.pendingOAuthCiphertext
  ) {
    throw invalidState();
  }

  if (!pending.oauthStateExpiresAt || Date.parse(pending.oauthStateExpiresAt) <= Date.now()) {
    if (await storage.claimOAuthState(stateHash)) {
      await clearRedditPending(pending.id);
    }
    throw invalidState();
  }

  const pendingCiphertext = pending.pendingOAuthCiphertext;
  if (!(await storage.claimOAuthState(stateHash))) throw invalidState();

  const vault = getCredentialVault();
  const context = { userId: pending.userId, platformId: 'reddit', connectionId: pending.id };
  let payload: PendingRedditOAuth;
  try {
    const envelope = JSON.parse(pendingCiphertext) as EncryptedCredential;
    const plaintext = await vault.decrypt(envelope, context);
    const parsed = JSON.parse(plaintext) as Partial<PendingRedditOAuth>;
    payload = {
      redirectUri: String(parsed.redirectUri || ''),
      sessionHash: String(parsed.sessionHash || ''),
    };
    if (!payload.redirectUri) throw new Error('incomplete pending authorization');
  } catch {
    await clearRedditPending(pending.id);
    throw new ConnectionError(
      'The OAuth handshake could not be read. Start the connection again.',
      'oauth_state_invalid'
    );
  }

  if (!payload.sessionHash || !sameHash(payload.sessionHash, sha256(sessionId))) {
    await clearRedditPending(pending.id);
    throw invalidState();
  }

  const client = getRedditClient();
  let session;
  try {
    session = await client.exchangeCode({
      clientId: config.redditClientId,
      clientSecret: config.redditClientSecret,
      code: String(input.code || ''),
      redirectUri: payload.redirectUri,
    });
  } catch (err) {
    await clearRedditPending(pending.id);
    if (err instanceof AdapterError) throw fromAdapterError(err, 'Reddit');
    throw err;
  }

  const account = session.account;
  const destinationChanged =
    Boolean(pending.externalAccountId) &&
    pending.externalAccountId !== account.externalAccountId;
  if (destinationChanged) {
    await storage.invalidateDraftApprovals(pending.projectId, 'reddit');
  }

  const access = await vault.encrypt(session.tokens.accessToken, {
    userId: pending.userId,
    platformId: 'reddit',
    connectionId: pending.id,
  });
  const refresh = session.tokens.refreshToken
    ? await vault.encrypt(session.tokens.refreshToken, {
        userId: pending.userId,
        platformId: 'reddit',
        connectionId: pending.id,
      })
    : undefined;

  const saved = await storage.upsertPlatformConnection({
    ...pending,
    externalAccountId: account.externalAccountId,
    externalAccountName: account.externalAccountName,
    status: 'active',
    scopes: [...REDDIT_SCOPES],
    tokenExpiresAt: session.tokens.tokenExpiresAt,
    accessTokenCiphertext: access.ciphertext,
    refreshTokenCiphertext: refresh?.ciphertext,
    credentialProvider: access.provider,
    keyRef: access.keyRef,
    oauthStateHash: undefined,
    oauthStateExpiresAt: undefined,
    pendingOAuthCiphertext: undefined,
  });

  return toSummary(saved);
}

export async function cancelRedditAuthorization(
  state: string,
  options: { userId?: string } = {}
): Promise<void> {
  const value = String(state || '').trim();
  if (!value) return;
  const stateHash = sha256(value);
  const pending = await storage.findPlatformConnectionByOAuthState(stateHash);
  if (!pending || pending.platformId !== 'reddit') return;
  if (options.userId && pending.userId !== options.userId) return;
  if (await storage.claimOAuthState(stateHash)) {
    await clearRedditPending(pending.id);
  }
}

// --- Creator-owned LinkedIn account: OAuth 2.0 authorization code ---
// LinkedIn's documented flow has no PKCE parameters, so none are sent. The
// client secret stays server-side. A refresh token is stored only when LinkedIn
// actually issues one (Marketing Developer Platform partners); otherwise an
// expired token leads to reconnect rather than a fabricated refresh.
function linkedInCredentials() {
  try {
    return resolveLinkedInCredentials();
  } catch (err) {
    if (err instanceof LinkedInConfigError) {
      throw new ConnectionError(err.message, 'invalid_input');
    }
    throw err;
  }
}

function linkedInClient() {
  try {
    return getLinkedInClient();
  } catch (err) {
    if (err instanceof LinkedInConfigError) {
      throw new ConnectionError(err.message, 'invalid_input');
    }
    throw err;
  }
}

export interface BeginLinkedInAuthorizationInput {
  userId: string;
  projectId: string;
  sessionId: string;
}

interface PendingLinkedInOAuth {
  redirectUri: string;
  sessionHash: string;
}

async function clearLinkedInPending(connectionId: string): Promise<void> {
  await storage.finishOAuthFailure(connectionId);
}

export async function beginLinkedInAuthorization(
  input: BeginLinkedInAuthorizationInput
): Promise<{ authorizationUrl: string }> {
  requireConnectablePlatform('linkedin');
  await requireOwnedProject(input.userId, input.projectId);

  const credentials = linkedInCredentials();
  const client = linkedInClient();
  const sessionId = String(input.sessionId || '');
  if (!sessionId) {
    throw new ConnectionError('Please sign in again to connect LinkedIn.', 'forbidden');
  }

  const redirectUri = oauthRedirectUri('linkedin');
  const existing = await storage.findPlatformConnection(
    input.userId,
    input.projectId,
    'linkedin'
  );
  const connectionId = existing?.id ?? newConnectionId();
  const vault = getCredentialVault();
  const context = { userId: input.userId, platformId: 'linkedin', connectionId };

  const pendingPayload: PendingLinkedInOAuth = {
    redirectUri,
    sessionHash: sha256(sessionId),
  };
  const pending = await vault.encrypt(JSON.stringify(pendingPayload), context);
  const state = crypto.randomBytes(32).toString('hex');

  const now = new Date().toISOString();
  // An active connection stays usable until the callback verifies the account.
  const keepActive = existing?.status === 'active';
  await storage.upsertPlatformConnection({
    id: connectionId,
    userId: input.userId,
    projectId: input.projectId,
    platformId: 'linkedin',
    externalAccountId: existing?.externalAccountId,
    externalAccountName: existing?.externalAccountName,
    status: keepActive ? 'active' : 'pending',
    scopes: existing?.scopes ?? [],
    tokenExpiresAt: existing?.tokenExpiresAt,
    accessTokenCiphertext: existing?.accessTokenCiphertext ?? '',
    refreshTokenCiphertext: existing?.refreshTokenCiphertext,
    credentialProvider: existing?.credentialProvider ?? 'none',
    keyRef: existing?.keyRef ?? '',
    oauthStateHash: sha256(state),
    oauthStateExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
    pendingOAuthCiphertext: JSON.stringify(pending),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  return {
    authorizationUrl: client.authorizationUrl({
      clientId: credentials.clientId,
      redirectUri,
      state,
    }),
  };
}

export async function completeLinkedInAuthorization(input: {
  userId: string;
  state: string;
  code: string;
  sessionId: string;
}): Promise<PlatformConnection> {
  const state = String(input.state || '').trim();
  const sessionId = String(input.sessionId || '');
  const invalidState = () =>
    new ConnectionError(
      'The OAuth state is missing or expired. Start the connection again.',
      'oauth_state_invalid'
    );
  if (!state || !sessionId) throw invalidState();

  const stateHash = sha256(state);
  const pending = await storage.findPlatformConnectionByOAuthState(stateHash);
  if (
    !pending ||
    pending.platformId !== 'linkedin' ||
    pending.userId !== input.userId ||
    !pending.pendingOAuthCiphertext
  ) {
    throw invalidState();
  }

  if (!pending.oauthStateExpiresAt || Date.parse(pending.oauthStateExpiresAt) <= Date.now()) {
    if (await storage.claimOAuthState(stateHash)) {
      await clearLinkedInPending(pending.id);
    }
    throw invalidState();
  }

  const pendingCiphertext = pending.pendingOAuthCiphertext;
  if (!(await storage.claimOAuthState(stateHash))) throw invalidState();

  const vault = getCredentialVault();
  const context = { userId: pending.userId, platformId: 'linkedin', connectionId: pending.id };
  let payload: PendingLinkedInOAuth;
  try {
    const envelope = JSON.parse(pendingCiphertext) as EncryptedCredential;
    const plaintext = await vault.decrypt(envelope, context);
    const parsed = JSON.parse(plaintext) as Partial<PendingLinkedInOAuth>;
    payload = {
      redirectUri: String(parsed.redirectUri || ''),
      sessionHash: String(parsed.sessionHash || ''),
    };
    if (!payload.redirectUri) throw new Error('incomplete pending authorization');
  } catch {
    await clearLinkedInPending(pending.id);
    throw new ConnectionError(
      'The OAuth handshake could not be read. Start the connection again.',
      'oauth_state_invalid'
    );
  }

  // The state is bound to the session that started the handshake, so a callback
  // URL shared with another signed-in session is rejected.
  if (!payload.sessionHash || !sameHash(payload.sessionHash, sha256(sessionId))) {
    await clearLinkedInPending(pending.id);
    throw invalidState();
  }

  const credentials = linkedInCredentials();
  const client = linkedInClient();
  let session;
  try {
    session = await client.exchangeCode({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      code: String(input.code || ''),
      redirectUri: payload.redirectUri,
    });
  } catch (err) {
    await clearLinkedInPending(pending.id);
    if (err instanceof AdapterError) throw fromAdapterError(err, 'LinkedIn');
    throw err;
  }

  const account = session.account;
  const destinationChanged =
    Boolean(pending.externalAccountId) &&
    pending.externalAccountId !== account.externalAccountId;
  if (destinationChanged) {
    await storage.invalidateDraftApprovals(pending.projectId, 'linkedin');
  }

  const access = await vault.encrypt(session.tokens.accessToken, {
    userId: pending.userId,
    platformId: 'linkedin',
    connectionId: pending.id,
  });
  const refresh = session.tokens.refreshToken
    ? await vault.encrypt(session.tokens.refreshToken, {
        userId: pending.userId,
        platformId: 'linkedin',
        connectionId: pending.id,
      })
    : undefined;

  const saved = await storage.upsertPlatformConnection({
    ...pending,
    externalAccountId: account.externalAccountId,
    externalAccountName: account.externalAccountName,
    status: 'active',
    scopes: session.scopes?.length ? session.scopes : [...LINKEDIN_SCOPES],
    tokenExpiresAt: session.tokens.tokenExpiresAt,
    accessTokenCiphertext: access.ciphertext,
    refreshTokenCiphertext: refresh?.ciphertext,
    credentialProvider: access.provider,
    keyRef: access.keyRef,
    oauthStateHash: undefined,
    oauthStateExpiresAt: undefined,
    pendingOAuthCiphertext: undefined,
  });

  return toSummary(saved);
}

export async function cancelLinkedInAuthorization(
  state: string,
  options: { userId?: string } = {}
): Promise<void> {
  const value = String(state || '').trim();
  if (!value) return;
  const stateHash = sha256(value);
  const pending = await storage.findPlatformConnectionByOAuthState(stateHash);
  if (!pending || pending.platformId !== 'linkedin') return;
  if (options.userId && pending.userId !== options.userId) return;
  if (await storage.claimOAuthState(stateHash)) {
    await clearLinkedInPending(pending.id);
  }
}

// --- Crewlink-owned Slack app: OAuth v2 installation into an owner's workspace ---
// The owner installs one Crewlink app and picks a channel; Crewlink receives only
// the bot token. No user token is requested, so the app never sees a person's
// Slack history or membership beyond the channels the bot was invited to.
export interface BeginSlackAuthorizationInput {
  userId: string;
  projectId: string;
  sessionId: string;
}

interface PendingSlackOAuth {
  redirectUri: string;
  sessionHash: string;
}

async function clearSlackPending(connectionId: string): Promise<void> {
  await storage.finishOAuthFailure(connectionId);
}

function slackClient() {
  if (!isSlackConfigured()) {
    throw new ConnectionError(
      'Slack is not configured on this server. Add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.',
      'invalid_input'
    );
  }
  return getSlackClient();
}

export async function beginSlackAuthorization(
  input: BeginSlackAuthorizationInput
): Promise<{ authorizationUrl: string }> {
  requireConnectablePlatform('slack');
  await requireOwnedProject(input.userId, input.projectId);

  const client = slackClient();
  const sessionId = String(input.sessionId || '');
  if (!sessionId) {
    throw new ConnectionError('Please sign in again to connect Slack.', 'forbidden');
  }
  if (!config.slackClientId) {
    throw new ConnectionError('Slack is not configured on this server.', 'invalid_input');
  }

  const redirectUri = oauthRedirectUri('slack');
  const existing = await storage.findPlatformConnection(
    input.userId,
    input.projectId,
    'slack'
  );
  const connectionId = existing?.id ?? newConnectionId();
  const vault = getCredentialVault();
  const context = { userId: input.userId, platformId: 'slack', connectionId };

  const pendingPayload: PendingSlackOAuth = {
    redirectUri,
    sessionHash: sha256(sessionId),
  };
  const pending = await vault.encrypt(JSON.stringify(pendingPayload), context);
  const state = crypto.randomBytes(32).toString('hex');

  const now = new Date().toISOString();
  // Reinstalling an already active workspace keeps the connection usable and
  // leaves the selected channel in place until the callback confirms identity.
  const keepActive = existing?.status === 'active';
  await storage.upsertPlatformConnection({
    id: connectionId,
    userId: input.userId,
    projectId: input.projectId,
    platformId: 'slack',
    externalAccountId: existing?.externalAccountId,
    externalAccountName: existing?.externalAccountName,
    serverId: existing?.serverId,
    serverName: existing?.serverName,
    channelId: existing?.channelId,
    channelName: existing?.channelName,
    status: keepActive ? 'active' : 'pending',
    scopes: existing?.scopes ?? [],
    tokenExpiresAt: existing?.tokenExpiresAt,
    accessTokenCiphertext: existing?.accessTokenCiphertext ?? '',
    refreshTokenCiphertext: existing?.refreshTokenCiphertext,
    credentialProvider: existing?.credentialProvider ?? 'none',
    keyRef: existing?.keyRef ?? '',
    oauthStateHash: sha256(state),
    oauthStateExpiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
    pendingOAuthCiphertext: JSON.stringify(pending),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  return {
    authorizationUrl: client.authorizationUrl({
      clientId: config.slackClientId,
      redirectUri,
      state,
    }),
  };
}

export async function completeSlackAuthorization(input: {
  userId: string;
  state: string;
  code: string;
  sessionId: string;
}): Promise<PlatformConnection> {
  const state = String(input.state || '').trim();
  const sessionId = String(input.sessionId || '');
  const invalidState = () =>
    new ConnectionError(
      'The OAuth state is missing or expired. Start the connection again.',
      'oauth_state_invalid'
    );
  if (!state || !sessionId) throw invalidState();

  const stateHash = sha256(state);
  const pending = await storage.findPlatformConnectionByOAuthState(stateHash);
  if (
    !pending ||
    pending.platformId !== 'slack' ||
    pending.userId !== input.userId ||
    !pending.pendingOAuthCiphertext
  ) {
    throw invalidState();
  }

  if (!pending.oauthStateExpiresAt || Date.parse(pending.oauthStateExpiresAt) <= Date.now()) {
    if (await storage.claimOAuthState(stateHash)) {
      await clearSlackPending(pending.id);
    }
    throw invalidState();
  }

  const pendingCiphertext = pending.pendingOAuthCiphertext;
  if (!(await storage.claimOAuthState(stateHash))) throw invalidState();

  const vault = getCredentialVault();
  const context = { userId: pending.userId, platformId: 'slack', connectionId: pending.id };
  let payload: PendingSlackOAuth;
  try {
    const envelope = JSON.parse(pendingCiphertext) as EncryptedCredential;
    const plaintext = await vault.decrypt(envelope, context);
    const parsed = JSON.parse(plaintext) as Partial<PendingSlackOAuth>;
    payload = {
      redirectUri: String(parsed.redirectUri || ''),
      sessionHash: String(parsed.sessionHash || ''),
    };
    if (!payload.redirectUri) throw new Error('incomplete pending authorization');
  } catch {
    await clearSlackPending(pending.id);
    throw new ConnectionError(
      'The OAuth handshake could not be read. Start the connection again.',
      'oauth_state_invalid'
    );
  }

  // The handshake is bound to the session that started it.
  if (!payload.sessionHash || !sameHash(payload.sessionHash, sha256(sessionId))) {
    await clearSlackPending(pending.id);
    throw invalidState();
  }

  const client = slackClient();
  let session;
  try {
    session = await client.exchangeCode({
      clientId: config.slackClientId,
      clientSecret: config.slackClientSecret,
      code: String(input.code || ''),
      redirectUri: payload.redirectUri,
    });
  } catch (err) {
    await clearSlackPending(pending.id);
    if (err instanceof AdapterError) throw fromAdapterError(err, 'Slack');
    throw err;
  }

  // A different workspace is a different destination: approvals made for the
  // old workspace must not carry over, and the old channel selection is dropped.
  const workspaceChanged =
    Boolean(pending.serverId) && pending.serverId !== session.workspace.id;
  if (workspaceChanged) {
    await storage.invalidateDraftApprovals(pending.projectId, 'slack');
  }

  const access = await vault.encrypt(session.tokens.accessToken, {
    userId: pending.userId,
    platformId: 'slack',
    connectionId: pending.id,
  });
  const refresh = session.tokens.refreshToken
    ? await vault.encrypt(session.tokens.refreshToken, {
        userId: pending.userId,
        platformId: 'slack',
        connectionId: pending.id,
      })
    : undefined;

  const saved = await storage.upsertPlatformConnection({
    ...pending,
    serverId: session.workspace.id,
    serverName: session.workspace.name,
    externalAccountId: session.account.externalAccountId,
    externalAccountName: session.account.externalAccountName,
    channelId: workspaceChanged ? undefined : pending.channelId,
    channelName: workspaceChanged ? undefined : pending.channelName,
    status: 'active',
    scopes: session.scopes?.length ? session.scopes : [...SLACK_SCOPES],
    tokenExpiresAt: session.tokens.tokenExpiresAt,
    accessTokenCiphertext: access.ciphertext,
    refreshTokenCiphertext: refresh?.ciphertext,
    credentialProvider: access.provider,
    keyRef: access.keyRef,
    oauthStateHash: undefined,
    oauthStateExpiresAt: undefined,
    pendingOAuthCiphertext: undefined,
  });

  return toSummary(saved);
}

export async function cancelSlackAuthorization(
  state: string,
  options: { userId?: string } = {}
): Promise<void> {
  const value = String(state || '').trim();
  if (!value) return;
  const stateHash = sha256(value);
  const pending = await storage.findPlatformConnectionByOAuthState(stateHash);
  if (!pending || pending.platformId !== 'slack') return;
  if (options.userId && pending.userId !== options.userId) return;
  if (await storage.claimOAuthState(stateHash)) {
    await clearSlackPending(pending.id);
  }
}

// --- Channel discovery uses the bot token only ---
// Private channels appear only when the Crewlink bot was invited; the owner's own
// Slack access never widens the list.
async function requireOwnedSlackConnection(
  userId: string,
  connectionId: string
): Promise<StoredPlatformConnection> {
  const connection = await storage.getPlatformConnectionById(connectionId);
  if (!connection || connection.userId !== userId) {
    throw new ConnectionError('Connection not found.', 'connection_not_found');
  }
  if (connection.platformId !== 'slack') {
    throw new ConnectionError('This is not a Slack connection.', 'invalid_input');
  }
  if (connection.status !== 'active') {
    throw new ConnectionError('This connection is not active.', 'connection_inactive');
  }
  return connection;
}

export async function listSlackChannels(
  userId: string,
  connectionId: string
): Promise<SlackChannel[]> {
  const connection = await requireOwnedSlackConnection(userId, connectionId);
  const tokens = await decryptConnectionTokens(connection);
  try {
    return await slackClient().listChannels(tokens.accessToken);
  } catch (err) {
    if (err instanceof AdapterError) throw fromAdapterError(err, 'Slack');
    throw err;
  }
}

export async function selectSlackChannel(input: {
  userId: string;
  connectionId: string;
  channelId: string;
}): Promise<PlatformConnection> {
  const connection = await requireOwnedSlackConnection(input.userId, input.connectionId);
  const channelId = String(input.channelId || '').trim();
  if (!channelId || channelId.length > 100 || !/^[A-Za-z0-9]+$/.test(channelId)) {
    throw new ConnectionError('Choose a Slack channel.', 'invalid_input');
  }

  const tokens = await decryptConnectionTokens(connection);
  let channel: SlackChannel;
  try {
    channel = await slackClient().getChannel(tokens.accessToken, channelId);
  } catch (err) {
    if (err instanceof AdapterError) throw fromAdapterError(err, 'Slack');
    throw err;
  }

  if (channel.isArchived) {
    throw new ConnectionError(
      'This Slack channel is archived and cannot receive new messages. Choose another channel.',
      'invalid_input'
    );
  }
  // Public channels also require membership for chat.postMessage with chat:write.
  // Crewlink never joins a channel on the owner's behalf.
  if (!channel.isMember) {
    throw new ConnectionError(
      `The Crewlink bot is not a member of #${channel.name}. Invite @Crewlink to the channel in Slack, then refresh this list.`,
      'invalid_input'
    );
  }

  const destinationChanged = Boolean(connection.channelId) && connection.channelId !== channel.id;
  if (destinationChanged) {
    await storage.invalidateDraftApprovals(connection.projectId, 'slack');
  }

  const saved = await storage.updatePlatformConnectionChannel(connection.id, {
    channelId: channel.id,
    channelName: channel.name,
  });
  if (!saved) {
    throw new ConnectionError('This connection is not active.', 'connection_inactive');
  }
  return toSummary(saved);
}

export async function verifySlackConnection(
  connection: StoredPlatformConnection
): Promise<PlatformConnection> {
  const tokens = await decryptConnectionTokens(connection);
  let verified: { workspace: { id: string; name: string }; botUserId: string; botName: string };
  try {
    verified = await slackClient().verifyWorkspace(tokens.accessToken);
  } catch (err) {
    if (
      err instanceof AdapterError &&
      (err.code === 'revoked' || err.code === 'token_expired' || err.code === 'auth_failed')
    ) {
      await storage.disconnectPlatformConnection(connection.id);
      throw new ConnectionError(
        'The Slack app is no longer authorised for this workspace. Reinstall it.',
        'invalid_credentials'
      );
    }
    if (err instanceof AdapterError) throw fromAdapterError(err, 'Slack');
    throw err;
  }

  // The stored token must still belong to the workspace on the record. A token
  // for a different workspace means the connection was replaced elsewhere.
  if (connection.serverId && connection.serverId !== verified.workspace.id) {
    await storage.disconnectPlatformConnection(connection.id);
    throw new ConnectionError(
      'The Slack token belongs to a different workspace. Reconnect Slack.',
      'invalid_credentials'
    );
  }

  const saved = await storage.upsertPlatformConnection({
    ...connection,
    serverId: verified.workspace.id,
    serverName: verified.workspace.name,
    externalAccountId: verified.botUserId,
    externalAccountName: verified.botName || connection.externalAccountName || 'Crewlink bot',
  });
  return toSummary(saved);
}

// --- Internal use only: decrypt active account tokens for an adapter ---
// Never expose the result to a route response.
export async function decryptConnectionTokens(
  connection: StoredPlatformConnection
): Promise<AdapterTokens> {
  if (
    connection.status !== 'active' ||
    connection.credentialProvider === 'none' ||
    !connection.accessTokenCiphertext ||
    !connection.keyRef
  ) {
    throw new ConnectionError('This connection is not active.', 'connection_inactive');
  }

  const vault = getCredentialVault();
  const context = {
    userId: connection.userId,
    platformId: connection.platformId,
    connectionId: connection.id,
  };
  const decrypt = async (credential: EncryptedCredential): Promise<string> => {
    try {
      return await vault.decrypt(credential, context);
    } catch (err) {
      // A local-vault decryption failure is deterministic: the ciphertext is
      // malformed, corrupt, or was written under a different key version. The
      // owner must reconnect; retrying can never succeed. KMS decryption can
      // also fail transiently, so it keeps its generic error.
      if (
        err instanceof CredentialDecryptionError &&
        connection.credentialProvider === 'local'
      ) {
        throw new ConnectionError(
          'The stored credential could not be decrypted. Reconnect this account.',
          'invalid_credentials'
        );
      }
      throw err;
    }
  };
  const accessToken = await decrypt({
    ciphertext: connection.accessTokenCiphertext,
    provider: connection.credentialProvider,
    keyRef: connection.keyRef,
  });
  const refreshToken = connection.refreshTokenCiphertext
    ? await decrypt({
        ciphertext: connection.refreshTokenCiphertext,
        provider: connection.credentialProvider,
        keyRef: connection.keyRef,
      })
    : undefined;

  return { accessToken, refreshToken, tokenExpiresAt: connection.tokenExpiresAt };
}

// --- Internal use only: persist tokens refreshed during a verify or publish ---
// Compare-and-set against the ciphertext the caller loaded. If another request
// rotated the session first, its tokens win; this request never overwrites them.
export async function persistConnectionTokens(
  connection: StoredPlatformConnection,
  tokens: AdapterTokens
): Promise<StoredPlatformConnection> {
  const vault = getCredentialVault();
  const context = {
    userId: connection.userId,
    platformId: connection.platformId,
    connectionId: connection.id,
  };
  const access = await vault.encrypt(tokens.accessToken, context);
  const refresh = tokens.refreshToken
    ? await vault.encrypt(tokens.refreshToken, context)
    : undefined;

  const saved = await storage.updatePlatformConnectionTokens({
    id: connection.id,
    expectedAccessTokenCiphertext: connection.accessTokenCiphertext,
    accessTokenCiphertext: access.ciphertext,
    refreshTokenCiphertext: refresh?.ciphertext ?? connection.refreshTokenCiphertext,
    tokenExpiresAt: tokens.tokenExpiresAt ?? connection.tokenExpiresAt ?? null,
    credentialProvider: access.provider,
    keyRef: access.keyRef,
  });
  if (saved) return saved;

  // Another request saved newer tokens (or disconnected the account) first.
  const latest = await storage.getPlatformConnectionById(connection.id);
  if (!latest) {
    throw new ConnectionError('Connection not found.', 'connection_not_found');
  }
  return latest;
}

// --- Re-verify a creator-owned account; never accepts a pasted token ---
export async function verifyConnection(
  userId: string,
  connectionId: string
): Promise<PlatformConnection> {
  const connection = await storage.getPlatformConnectionById(connectionId);
  if (!connection || connection.userId !== userId) {
    throw new ConnectionError('Connection not found.', 'connection_not_found');
  }
  if (connection.status !== 'active') {
    throw new ConnectionError('This connection is not active.', 'connection_inactive');
  }

  if (connection.platformId === 'slack') {
    return verifySlackConnection(connection);
  }

  if (connection.platformId === 'bluesky') {
    const client = getBlueskyClient();
    let tokens = await decryptConnectionTokens(connection);
    let account: VerifiedAccount;
    let refreshed = false;

    try {
      account = await client.getSession(tokens.accessToken);
    } catch (err) {
      if (
        err instanceof AdapterError &&
        (err.code === 'revoked' || err.code === 'token_expired') &&
        tokens.refreshToken
      ) {
        try {
          const session = await client.refreshSession(tokens.refreshToken, connection.id);
          tokens = session.tokens;
          account = session.account;
          refreshed = true;
        } catch (refreshErr) {
          if (
            refreshErr instanceof AdapterError &&
            (refreshErr.code === 'revoked' ||
              refreshErr.code === 'token_expired' ||
              refreshErr.code === 'auth_failed')
          ) {
            await storage.disconnectPlatformConnection(connection.id);
            throw new ConnectionError(
              'The Bluesky session was revoked. Reconnect the account.',
              'invalid_credentials'
            );
          }
          if (refreshErr instanceof AdapterError) throw fromAdapterError(refreshErr, 'Bluesky');
          throw refreshErr;
        }
      } else if (
        err instanceof AdapterError &&
        (err.code === 'revoked' || err.code === 'token_expired')
      ) {
        await storage.disconnectPlatformConnection(connection.id);
        throw new ConnectionError(
          'The Bluesky session was revoked. Reconnect the account.',
          'invalid_credentials'
        );
      } else if (err instanceof AdapterError) {
        throw fromAdapterError(err, 'Bluesky');
      } else {
        throw err;
      }
    }

    const saved = refreshed
      ? await persistConnectionTokens(connection, tokens)
      : connection;
    const withAccount =
      (await storage.updatePlatformConnectionAccount(connection.id, {
        externalAccountId: account.externalAccountId,
        externalAccountName: account.externalAccountName,
      })) ?? saved;
    return toSummary(withAccount);
  }

  if (connection.platformId === 'mastodon') {
    const instanceUrl = connection.instanceUrl;
    if (!instanceUrl) {
      throw new ConnectionError('Reconnect this Mastodon account.', 'invalid_input');
    }
    const tokens = await decryptConnectionTokens(connection);
    let account: VerifiedAccount;
    try {
      account = await getMastodonClient().verifyAccount(instanceUrl, tokens.accessToken);
    } catch (err) {
      if (
        err instanceof AdapterError &&
        (err.code === 'revoked' || err.code === 'token_expired' || err.code === 'auth_failed')
      ) {
        await storage.disconnectPlatformConnection(connection.id);
        throw new ConnectionError(
          'The Mastodon access token was revoked. Reconnect the account.',
          'invalid_credentials'
        );
      }
      if (err instanceof AdapterError) throw fromAdapterError(err, 'Mastodon');
      throw err;
    }

    const saved = await storage.updatePlatformConnectionAccount(connection.id, {
      externalAccountId: account.externalAccountId,
      externalAccountName: account.externalAccountName,
      instanceUrl: account.instanceUrl || instanceUrl,
    });
    if (!saved) {
      throw new ConnectionError('Connection not found.', 'connection_not_found');
    }
    return toSummary(saved);
  }

  if (connection.platformId === 'x') {
    const client = getXClient();
    let tokens = await decryptConnectionTokens(connection);
    let account: VerifiedAccount;
    let refreshed = false;

    try {
      account = await client.verifyAccount(tokens.accessToken);
    } catch (err) {
      if (
        err instanceof AdapterError &&
        (err.code === 'revoked' || err.code === 'token_expired') &&
        tokens.refreshToken
      ) {
        try {
          tokens = await client.refreshSession({
            clientId: config.xClientId,
            clientSecret: config.xClientSecret || undefined,
            refreshToken: tokens.refreshToken,
          });
          account = await client.verifyAccount(tokens.accessToken);
          refreshed = true;
        } catch (refreshErr) {
          await storage.disconnectPlatformConnection(connection.id);
          if (refreshErr instanceof AdapterError) throw fromAdapterError(refreshErr, 'X');
          throw refreshErr;
        }
      } else if (
        err instanceof AdapterError &&
        (err.code === 'revoked' || err.code === 'token_expired' || err.code === 'auth_failed')
      ) {
        await storage.disconnectPlatformConnection(connection.id);
        throw new ConnectionError(
          'The X account is no longer connected. Reconnect it.',
          'invalid_credentials'
        );
      } else if (err instanceof AdapterError) {
        throw fromAdapterError(err, 'X');
      } else {
        throw err;
      }
    }

    const saved = refreshed ? await persistConnectionTokens(connection, tokens) : connection;
    const withAccount =
      (await storage.updatePlatformConnectionAccount(connection.id, {
        externalAccountId: account.externalAccountId,
        externalAccountName: account.externalAccountName,
      })) ?? saved;
    return toSummary(withAccount);
  }

  if (connection.platformId === 'reddit') {
    const client = getRedditClient();
    let tokens = await decryptConnectionTokens(connection);
    let account: VerifiedAccount;
    let refreshed = false;

    try {
      account = await client.verifyAccount(tokens.accessToken);
    } catch (err) {
      if (
        err instanceof AdapterError &&
        (err.code === 'revoked' || err.code === 'token_expired') &&
        tokens.refreshToken &&
        config.redditClientId &&
        config.redditClientSecret
      ) {
        try {
          tokens = await client.refreshSession({
            clientId: config.redditClientId,
            clientSecret: config.redditClientSecret,
            refreshToken: tokens.refreshToken,
          });
          account = await client.verifyAccount(tokens.accessToken);
          refreshed = true;
        } catch (refreshErr) {
          await storage.disconnectPlatformConnection(connection.id);
          if (refreshErr instanceof AdapterError) throw fromAdapterError(refreshErr, 'Reddit');
          throw refreshErr;
        }
      } else if (
        err instanceof AdapterError &&
        (err.code === 'revoked' || err.code === 'token_expired' || err.code === 'auth_failed')
      ) {
        await storage.disconnectPlatformConnection(connection.id);
        throw new ConnectionError(
          'The Reddit account is no longer connected. Reconnect it.',
          'invalid_credentials'
        );
      } else if (err instanceof AdapterError) {
        throw fromAdapterError(err, 'Reddit');
      } else {
        throw err;
      }
    }

    const saved = refreshed ? await persistConnectionTokens(connection, tokens) : connection;
    const withAccount =
      (await storage.updatePlatformConnectionAccount(connection.id, {
        externalAccountId: account.externalAccountId,
        externalAccountName: account.externalAccountName,
      })) ?? saved;
    return toSummary(withAccount);
  }

  if (connection.platformId === 'linkedin') {
    const client = linkedInClient();
    const credentials = linkedInCredentials();
    let tokens = await decryptConnectionTokens(connection);
    let account: VerifiedAccount;
    let refreshed = false;

    try {
      account = await client.verifyAccount(tokens.accessToken);
    } catch (err) {
      // Refresh is attempted only when LinkedIn actually issued a refresh token;
      // most apps must reconnect after the ~60-day access token expires.
      if (
        err instanceof AdapterError &&
        (err.code === 'revoked' || err.code === 'token_expired') &&
        tokens.refreshToken
      ) {
        try {
          tokens = await client.refreshSession({
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret,
            refreshToken: tokens.refreshToken,
          });
          account = await client.verifyAccount(tokens.accessToken);
          refreshed = true;
        } catch (refreshErr) {
          await storage.disconnectPlatformConnection(connection.id);
          if (refreshErr instanceof AdapterError) throw fromAdapterError(refreshErr, 'LinkedIn');
          throw refreshErr;
        }
      } else if (
        err instanceof AdapterError &&
        (err.code === 'revoked' || err.code === 'token_expired' || err.code === 'auth_failed')
      ) {
        await storage.disconnectPlatformConnection(connection.id);
        throw new ConnectionError(
          'The LinkedIn account is no longer connected. Reconnect it.',
          'invalid_credentials'
        );
      } else if (err instanceof AdapterError) {
        throw fromAdapterError(err, 'LinkedIn');
      } else {
        throw err;
      }
    }

    const saved = refreshed ? await persistConnectionTokens(connection, tokens) : connection;
    const withAccount =
      (await storage.updatePlatformConnectionAccount(connection.id, {
        externalAccountId: account.externalAccountId,
        externalAccountName: account.externalAccountName,
      })) ?? saved;
    return toSummary(withAccount);
  }

  throw new ConnectionError(
    'Only creator-owned accounts can be verified this way.',
    'invalid_input'
  );
}

// --- Owner-scoped listing. Tokens are stripped; disconnected records are included ---
export async function listConnections(
  userId: string,
  projectId?: string
): Promise<PlatformConnection[]> {
  if (projectId) {
    await requireOwnedProject(userId, projectId);
  }
  const connections = await storage.listPlatformConnections(userId, projectId);
  return connections.map(toSummary);
}

// --- Internal use only: decrypt a connection's token for an adapter ---
// Never expose the result to a route response. Anything except an active,
// owned connection fails closed.
export async function getConnectionToken(
  userId: string,
  connectionId: string
): Promise<ConnectionTokens> {
  const connection = await storage.getPlatformConnectionById(connectionId);
  if (!connection || connection.userId !== userId) {
    throw new ConnectionError('Connection not found.', 'connection_not_found');
  }
  if (
    connection.status !== 'active' ||
    connection.credentialProvider === 'none' ||
    !connection.accessTokenCiphertext ||
    !connection.keyRef
  ) {
    throw new ConnectionError('This connection is not active.', 'connection_inactive');
  }

  const vault = getCredentialVault();
  const context = {
    userId: connection.userId,
    platformId: connection.platformId,
    connectionId: connection.id,
  };
  const accessToken = await vault.decrypt(
    {
      ciphertext: connection.accessTokenCiphertext,
      provider: connection.credentialProvider,
      keyRef: connection.keyRef,
    },
    context
  );
  const refreshToken = connection.refreshTokenCiphertext
    ? await vault.decrypt(
        {
          ciphertext: connection.refreshTokenCiphertext,
          provider: connection.credentialProvider,
          keyRef: connection.keyRef,
        },
        context
      )
    : undefined;

  return {
    connectionId: connection.id,
    platformId: connection.platformId,
    projectId: connection.projectId,
    accessToken,
    refreshToken,
    tokenExpiresAt: connection.tokenExpiresAt,
  };
}

// --- Mark a connection disconnected and wipe its encrypted token material ---
export async function disconnectConnection(userId: string, connectionId: string): Promise<void> {
  const connection = await storage.getPlatformConnectionById(connectionId);
  if (!connection || connection.userId !== userId) {
    throw new ConnectionError('Connection not found.', 'connection_not_found');
  }

  // Revoke at the provider first when possible, then wipe locally regardless. A
  // failed revoke must not leave usable-looking credentials in Crewlink.
  if (connection.platformId === 'x' && connection.status === 'active') {
    try {
      const tokens = await decryptConnectionTokens(connection);
      await getXClient().revoke({
        clientId: config.xClientId,
        clientSecret: config.xClientSecret || undefined,
        accessToken: tokens.accessToken,
      });
    } catch {
      // Best effort only; the local wipe below is what Crewlink controls.
    }
  }

  if (connection.platformId === 'slack' && connection.status === 'active') {
    try {
      const tokens = await decryptConnectionTokens(connection);
      await getSlackClient().revoke(tokens.accessToken);
    } catch {
      // Best effort only; the local wipe below is what Crewlink controls.
    }
  }

  if (
    connection.platformId === 'reddit' &&
    connection.status === 'active' &&
    config.redditClientId &&
    config.redditClientSecret
  ) {
    try {
      const tokens = await decryptConnectionTokens(connection);
      await getRedditClient().revoke({
        clientId: config.redditClientId,
        clientSecret: config.redditClientSecret,
        accessToken: tokens.accessToken,
      });
    } catch {
      // Best effort only; the local wipe below is what Crewlink controls.
    }
  }

  const disconnected = await storage.disconnectPlatformConnection(connectionId);
  if (!disconnected) {
    throw new ConnectionError('Connection not found.', 'connection_not_found');
  }
}

export default {
  saveConnection,
  connectBotChannel,
  connectBlueskyAccount,
  beginMastodonAuthorization,
  completeMastodonAuthorization,
  cancelMastodonAuthorization,
  beginXAuthorization,
  completeXAuthorization,
  cancelXAuthorization,
  beginRedditAuthorization,
  completeRedditAuthorization,
  cancelRedditAuthorization,
  beginLinkedInAuthorization,
  completeLinkedInAuthorization,
  cancelLinkedInAuthorization,
  beginSlackAuthorization,
  completeSlackAuthorization,
  cancelSlackAuthorization,
  listSlackChannels,
  selectSlackChannel,
  verifySlackConnection,
  verifyConnection,
  listConnections,
  getConnectionToken,
  decryptConnectionTokens,
  persistConnectionTokens,
  disconnectConnection,
};
