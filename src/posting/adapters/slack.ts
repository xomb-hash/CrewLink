import { config } from '../../config/index';
import { SLACK_MESSAGE_LIMIT, SLACK_SCOPE_STRING } from '../slack/config';
import {
  AdapterError,
  type AdapterErrorCode,
  type AdapterTokens,
  type OAuthSession,
  type PostResult,
  type SlackChannel,
  type SlackClientLike,
  type SlackOAuthSession,
  type SlackWorkspace,
} from './types';
import { asRecord, request, retryAfterSeconds, type FetchLike } from './http';

export const SLACK_DEFAULT_TIMEOUT_MS = 15_000;

// Slack returns HTTP 200 for most API failures and signals the real result in
// `ok`. These codes make that distinction available to the publish engine so a
// channel problem is not reported as a text problem.
export class SlackError extends AdapterError {
  constructor(
    message: string,
    readonly slackError: string,
    code: AdapterErrorCode,
    retryAfterSeconds?: number
  ) {
    super(message, code, retryAfterSeconds);
    this.name = 'SlackError';
  }
}

export interface SlackClientOptions {
  authorizeUrl?: string;
  tokenUrl?: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

type Operation = 'oauth' | 'verify' | 'channels' | 'send' | 'revoke';

const AUTH_ERRORS = new Set([
  'invalid_auth',
  'not_authed',
  'token_revoked',
  'token_expired',
  'account_inactive',
  'bot_not_found',
]);

function slackFailure(
  error: string,
  headers: Headers,
  operation: Operation
): SlackError {
  const safe = error || 'unknown_error';
  if (safe === 'ratelimited' || safe === 'rate_limited') {
    return new SlackError(
      'Slack rate-limited the request. Try again after the retry window.',
      safe,
      'rate_limited',
      retryAfterSeconds(headers) ?? 30
    );
  }
  if (AUTH_ERRORS.has(safe)) {
    return new SlackError(
      safe === 'token_expired'
        ? 'The Slack bot token has expired. Reinstall the Crewlink app in this workspace.'
        : 'The Slack app is no longer authorised for this workspace. Reinstall it.',
      safe,
      safe === 'token_expired' ? 'token_expired' : 'revoked'
    );
  }
  if (safe === 'missing_scope' || safe === 'not_allowed_token_type') {
    return new SlackError(
      'The Crewlink Slack app is missing a required permission. Reinstall it with chat:write, channels:read and groups:read.',
      safe,
      'auth_failed'
    );
  }
  if (
    safe === 'not_in_channel' ||
    safe === 'channel_not_found' ||
    safe === 'is_archived' ||
    safe === 'restricted_action' ||
    safe === 'msg_too_long' ||
    safe === 'no_text' ||
    safe === 'invalid_arguments' ||
    safe === 'invalid_blocks'
  ) {
    return new SlackError(
      safe === 'not_in_channel'
        ? 'The Crewlink bot is not a member of this channel. Invite it in Slack, then try again.'
        : safe === 'channel_not_found'
          ? 'Slack could not find this channel. It may have been deleted, or the selection is stale.'
          : safe === 'is_archived'
            ? 'This Slack channel is archived and cannot receive new messages.'
            : safe === 'restricted_action'
              ? 'A Slack workspace policy prevents the Crewlink app from posting here.'
              : safe === 'msg_too_long'
                ? `Slack messages are limited to ${SLACK_MESSAGE_LIMIT} characters.`
                : safe === 'no_text'
                  ? 'The Slack message is empty.'
                  : 'Slack rejected the message fields.',
      safe,
      'validation_error'
    );
  }
  if (safe === 'access_denied') {
    return new SlackError(
      'The Slack installation was cancelled.',
      safe,
      'auth_failed'
    );
  }
  if (
    safe === 'invalid_code' ||
    safe === 'bad_redirect_uri' ||
    safe === 'invalid_client_id' ||
    safe === 'invalid_client_secret' ||
    safe === 'invalid_scope'
  ) {
    return new SlackError(
      `Slack rejected the installation request (${safe}).`,
      safe,
      'auth_failed'
    );
  }
  return new SlackError(
    `Slack returned an unexpected error (${safe}).`,
    safe,
    operation === 'send' ? 'instance_error' : 'instance_error'
  );
}

function fromResponse(
  status: number,
  data: unknown,
  headers: Headers,
  operation: Operation
): SlackError {
  const record = asRecord(data);
  if (typeof record.error === 'string' && record.error) {
    return slackFailure(record.error, headers, operation);
  }
  if (status === 429) {
    return new SlackError(
      'Slack rate-limited the request. Try again after the retry window.',
      'ratelimited',
      'rate_limited',
      retryAfterSeconds(headers) ?? 30
    );
  }
  if (status === 401 || status === 403) {
    return new SlackError(
      'Slack rejected the Crewlink app credentials. Reinstall it.',
      'invalid_auth',
      'revoked'
    );
  }
  if (status >= 500) {
    // A server error during a send may still have created the message.
    return new SlackError(
      'Slack returned a server error.',
      'server_error',
      operation === 'send' ? 'uncertain' : 'instance_error'
    );
  }
  return new SlackError(
    `Slack returned HTTP ${status}.`,
    `http_${status}`,
    'instance_error'
  );
}

function tokensFromPayload(data: unknown): AdapterTokens {
  const record = asRecord(data);
  const accessToken = typeof record.access_token === 'string' ? record.access_token : '';
  if (!accessToken) {
    throw new SlackError(
      'Slack did not return a bot token.',
      'missing_access_token',
      'instance_error'
    );
  }
  const expiresIn = Number(record.expires_in);
  return {
    accessToken,
    refreshToken:
      typeof record.refresh_token === 'string' && record.refresh_token
        ? record.refresh_token
        : undefined,
    tokenExpiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : undefined,
  };
}

function scopesFromPayload(data: unknown): string[] {
  const scope = asRecord(data).scope;
  return typeof scope === 'string' && scope.trim()
    ? scope.trim().split(/[,\s]+/).filter(Boolean).slice(0, 50)
    : [];
}

function channelFrom(value: unknown): SlackChannel | null {
  const record = asRecord(value);
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) return null;
  return {
    id,
    name:
      typeof record.name === 'string' && record.name.trim()
        ? record.name.trim()
        : id,
    isPrivate: record.is_private === true,
    isMember: record.is_member === true,
    isArchived: record.is_archived === true,
  };
}

export class SlackClient implements SlackClientLike {
  readonly platform = 'slack' as const;
  private readonly authorizeUrl: string;
  private readonly tokenUrl: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl?: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: SlackClientOptions = {}) {
    this.authorizeUrl = options.authorizeUrl || config.slackAuthorizeUrl;
    this.tokenUrl = options.tokenUrl || config.slackTokenUrl;
    this.apiBaseUrl = (options.apiBaseUrl || config.slackApiBaseUrl).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? SLACK_DEFAULT_TIMEOUT_MS;
  }

  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string {
    const url = new URL(this.authorizeUrl);
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('scope', SLACK_SCOPE_STRING);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  private apiCall(
    method: string,
    accessToken: string | undefined,
    body: Record<string, string>,
    operation: Operation
  ) {
    return request(`${this.apiBaseUrl}/${method}`, {
      method: 'POST',
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      body: { form: body },
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      // A lost send response may still have created a message.
      networkErrorCode: operation === 'send' ? 'uncertain' : 'transport_error',
    });
  }

  private requireOk(data: unknown, headers: Headers, operation: Operation): Record<string, unknown> {
    const record = asRecord(data);
    if (record.ok !== true) {
      throw fromResponse(200, data, headers, operation);
    }
    return record;
  }

  async exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  }): Promise<SlackOAuthSession> {
    const response = await request(this.tokenUrl, {
      method: 'POST',
      body: {
        form: {
          code: input.code,
          client_id: input.clientId,
          client_secret: input.clientSecret,
          redirect_uri: input.redirectUri,
        },
      },
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
    });
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'oauth');
    }
    const record = this.requireOk(response.data, response.headers, 'oauth');
    const team = asRecord(record.team);
    const workspaceId = typeof team.id === 'string' ? team.id.trim() : '';
    if (!workspaceId) {
      throw new SlackError(
        'Slack did not return the installed workspace.',
        'missing_team',
        'instance_error'
      );
    }
    const workspace: SlackWorkspace = {
      id: workspaceId,
      name:
        typeof team.name === 'string' && team.name.trim()
          ? team.name.trim()
          : workspaceId,
    };
    const tokens = tokensFromPayload(record);
    const botUserId =
      typeof record.bot_user_id === 'string' ? record.bot_user_id.trim() : '';
    if (!botUserId) {
      throw new SlackError(
        'Slack did not return the Crewlink bot identity. Check that chat:write is granted.',
        'missing_bot_user',
        'auth_failed'
      );
    }
    // auth.test confirms the token and gives a human-readable bot name.
    const verified = await this.verifyWorkspace(tokens.accessToken);
    return {
      tokens,
      workspace,
      botUserId: verified.botUserId || botUserId,
      account: {
        externalAccountId: verified.botUserId || botUserId,
        externalAccountName: verified.botName || 'Crewlink bot',
      },
      scopes: scopesFromPayload(record),
    };
  }

  async verifyWorkspace(accessToken: string): Promise<{
    workspace: SlackWorkspace;
    botUserId: string;
    botName: string;
  }> {
    const response = await this.apiCall('auth.test', accessToken, {}, 'verify');
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'verify');
    }
    const record = this.requireOk(response.data, response.headers, 'verify');
    const teamId = typeof record.team_id === 'string' ? record.team_id.trim() : '';
    const userId = typeof record.user_id === 'string' ? record.user_id.trim() : '';
    if (!teamId || !userId) {
      throw new SlackError(
        'Slack did not identify the workspace or bot.',
        'missing_identity',
        'instance_error'
      );
    }
    return {
      workspace: {
        id: teamId,
        name:
          typeof record.team === 'string' && record.team.trim()
            ? record.team.trim()
            : teamId,
      },
      botUserId: userId,
      botName:
        typeof record.user === 'string' && record.user.trim() ? record.user.trim() : '',
    };
  }

  async listChannels(accessToken: string): Promise<SlackChannel[]> {
    const channels = new Map<string, SlackChannel>();
    let cursor = '';
    // Public channels are visible to the bot; private channels only appear when
    // the bot was invited. No user token is ever used to widen this list.
    for (let page = 0; page < 5; page += 1) {
      const response = await this.apiCall(
        'conversations.list',
        accessToken,
        {
          exclude_archived: 'true',
          types: 'public_channel,private_channel',
          limit: '200',
          ...(cursor ? { cursor } : {}),
        },
        'channels'
      );
      if (!response.ok) {
        throw fromResponse(response.status, response.data, response.headers, 'channels');
      }
      const record = this.requireOk(response.data, response.headers, 'channels');
      const list = Array.isArray(record.channels) ? record.channels : [];
      for (const value of list) {
        const channel = channelFrom(value);
        if (channel && !channels.has(channel.id)) channels.set(channel.id, channel);
      }
      const metadata = asRecord(record.response_metadata);
      const next = typeof metadata.next_cursor === 'string' ? metadata.next_cursor : '';
      if (!next) break;
      cursor = next;
    }
    return [...channels.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getChannel(accessToken: string, channelId: string): Promise<SlackChannel> {
    const response = await this.apiCall(
      'conversations.info',
      accessToken,
      { channel: channelId },
      'channels'
    );
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'channels');
    }
    const record = this.requireOk(response.data, response.headers, 'channels');
    const channel = channelFrom(record.channel);
    if (!channel) {
      throw new SlackError(
        'Slack did not return this channel.',
        'channel_not_found',
        'validation_error'
      );
    }
    return channel;
  }

  async sendMessage(input: {
    tokens: AdapterTokens;
    channelId: string;
    text: string;
  }): Promise<PostResult> {
    if (!input.text.trim()) {
      throw new SlackError('The Slack message is empty.', 'no_text', 'validation_error');
    }
    if (input.text.length > SLACK_MESSAGE_LIMIT) {
      throw new SlackError(
        `Slack messages are limited to ${SLACK_MESSAGE_LIMIT} characters.`,
        'msg_too_long',
        'validation_error'
      );
    }
    const response = await this.apiCall(
      'chat.postMessage',
      input.tokens.accessToken,
      {
        channel: input.channelId,
        text: input.text,
        // Slack renders previews by default; state it explicitly so a workspace
        // level default cannot silently change the result.
        unfurl_links: 'true',
        unfurl_media: 'true',
      },
      'send'
    );
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'send');
    }
    const record = this.requireOk(response.data, response.headers, 'send');
    const ts = typeof record.ts === 'string' ? record.ts.trim() : '';
    if (!ts) {
      // Slack accepted the call but did not return the message identifier, so
      // the outcome cannot be confirmed and must never be retried automatically.
      throw new SlackError(
        'Slack accepted the message but returned no timestamp.',
        'missing_ts',
        'uncertain'
      );
    }
    return { externalId: ts };
  }

  async revoke(accessToken: string): Promise<void> {
    const response = await this.apiCall('auth.revoke', accessToken, {}, 'revoke');
    if (!response.ok) {
      throw fromResponse(response.status, response.data, response.headers, 'revoke');
    }
    this.requireOk(response.data, response.headers, 'revoke');
  }
}

// --- Mock used by tests and by the default non-live transport ---
export interface MockSlackPost {
  channelId: string;
  text: string;
  ts: string;
}

export class MockSlackClient implements SlackClientLike {
  readonly platform = 'slack' as const;
  workspaceId = 'T_MOCK';
  workspaceName = 'Mock Workspace';
  botUserId = 'U_CREWLINK';
  botName = 'Crewlink';
  channels: SlackChannel[] = [
    { id: 'C0GENERAL', name: 'general', isPrivate: false, isMember: true, isArchived: false },
    { id: 'C0RANDOM', name: 'random', isPrivate: false, isMember: false, isArchived: false },
    { id: 'G0LEADS', name: 'leads', isPrivate: true, isMember: true, isArchived: false },
    { id: 'C0ARCHIVED', name: 'old-announcements', isPrivate: false, isMember: true, isArchived: true },
  ];
  posts: MockSlackPost[] = [];
  authorizationUrls: string[] = [];
  verifyCalls = 0;
  listCalls = 0;
  revokeCalls = 0;
  // Test switches. Each one fails exactly once, like a real transient failure.
  failExchange: AdapterError | null = null;
  failList: AdapterError | null = null;
  failAtSend: number | null = null;
  failSendWith: AdapterError | null = null;
  uncertainAtSend: number | null = null;
  private counter = 0;

  authorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
  }): string {
    const url = new URL('https://slack.test/oauth/v2/authorize');
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('scope', SLACK_SCOPE_STRING);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('state', input.state);
    this.authorizationUrls.push(url.toString());
    return url.toString();
  }

  async exchangeCode(): Promise<SlackOAuthSession> {
    if (this.failExchange) {
      const failure = this.failExchange;
      this.failExchange = null;
      throw failure;
    }
    return {
      tokens: { accessToken: 'mock-slack-bot-token' },
      account: {
        externalAccountId: this.botUserId,
        externalAccountName: this.botName,
      },
      scopes: ['chat:write', 'channels:read', 'groups:read'],
      workspace: { id: this.workspaceId, name: this.workspaceName },
      botUserId: this.botUserId,
    };
  }

  async verifyWorkspace(): Promise<{
    workspace: SlackWorkspace;
    botUserId: string;
    botName: string;
  }> {
    this.verifyCalls += 1;
    return {
      workspace: { id: this.workspaceId, name: this.workspaceName },
      botUserId: this.botUserId,
      botName: this.botName,
    };
  }

  async listChannels(): Promise<SlackChannel[]> {
    this.listCalls += 1;
    if (this.failList) {
      const failure = this.failList;
      this.failList = null;
      throw failure;
    }
    return this.channels.map((channel) => ({ ...channel }));
  }

  async getChannel(_accessToken: string, channelId: string): Promise<SlackChannel> {
    const found = this.channels.find((channel) => channel.id === channelId);
    if (!found) {
      throw new SlackError(
        'Slack could not find this channel.',
        'channel_not_found',
        'validation_error'
      );
    }
    return { ...found };
  }

  async sendMessage(input: {
    tokens: AdapterTokens;
    channelId: string;
    text: string;
  }): Promise<PostResult> {
    const call = this.posts.length + 1;
    if (this.failAtSend === call && this.failSendWith) {
      throw this.failSendWith;
    }
    if (this.uncertainAtSend === call) {
      throw new SlackError('Mock Slack outcome is uncertain.', 'mock_uncertain', 'uncertain');
    }
    this.counter += 1;
    const ts = `1700000000.000${this.counter.toString().padStart(3, '0')}`;
    this.posts.push({ channelId: input.channelId, text: input.text, ts });
    return { externalId: ts };
  }

  async revoke(): Promise<void> {
    this.revokeCalls += 1;
  }

  reset(): void {
    this.workspaceId = 'T_MOCK';
    this.workspaceName = 'Mock Workspace';
    this.botUserId = 'U_CREWLINK';
    this.botName = 'Crewlink';
    this.channels = [
      { id: 'C0GENERAL', name: 'general', isPrivate: false, isMember: true, isArchived: false },
      { id: 'C0RANDOM', name: 'random', isPrivate: false, isMember: false, isArchived: false },
      { id: 'G0LEADS', name: 'leads', isPrivate: true, isMember: true, isArchived: false },
      { id: 'C0ARCHIVED', name: 'old-announcements', isPrivate: false, isMember: true, isArchived: true },
    ];
    this.posts = [];
    this.authorizationUrls = [];
    this.verifyCalls = 0;
    this.listCalls = 0;
    this.revokeCalls = 0;
    this.failExchange = null;
    this.failList = null;
    this.failAtSend = null;
    this.failSendWith = null;
    this.uncertainAtSend = null;
    this.counter = 0;
  }
}

export const mockSlackClient = new MockSlackClient();

export function resetMockSlackState(): void {
  mockSlackClient.reset();
}

export type { OAuthSession };
