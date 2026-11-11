import { requestJson, type FetchLike } from './http';
import { BotError, type BotClient, type SendResult, type VerifiedChannel } from './types';

const DEFAULT_API_BASE = 'https://discord.com/api/v10';

// Discord permission bitfields. BigInt is required: the high bits do not fit a
// JavaScript number. The constructor (not a literal) keeps the TS target happy.
const ONE = BigInt(1);
export const VIEW_CHANNEL = ONE << BigInt(10);
export const SEND_MESSAGES = ONE << BigInt(11);
export const ADMINISTRATOR = ONE << BigInt(3);
export const DISCORD_REQUIRED_PERMISSIONS = VIEW_CHANNEL | SEND_MESSAGES;

const ALL_PERMISSIONS = (ONE << BigInt(64)) - ONE;
const TEXT_CHANNEL_TYPES = new Set([0, 5]);

export interface DiscordRoleLike {
  id?: unknown;
  permissions?: unknown;
}

export interface DiscordOverwriteLike {
  id?: unknown;
  type?: unknown;
  allow?: unknown;
  deny?: unknown;
}

function toBigInt(value: unknown): bigint {
  try {
    return BigInt(String(value ?? '0'));
  } catch {
    return BigInt(0);
  }
}

// Discord's documented channel permission resolution: guild base permissions,
// then @everyone overwrite, then role overwrites, then the member overwrite.
export function computeDiscordPermissions(input: {
  guildId: string;
  guildOwnerId?: string;
  botUserId: string;
  memberRoleIds: string[];
  roles: DiscordRoleLike[];
  overwrites: DiscordOverwriteLike[];
}): bigint {
  if (input.guildOwnerId && input.guildOwnerId === input.botUserId) {
    return ALL_PERMISSIONS;
  }

  const roleIds = new Set(input.memberRoleIds);
  roleIds.add(input.guildId); // @everyone always applies
  let permissions = BigInt(0);
  for (const role of input.roles) {
    const id = String(role.id ?? '');
    if (!roleIds.has(id)) continue;
    permissions |= toBigInt(role.permissions);
  }
  if ((permissions & ADMINISTRATOR) === ADMINISTRATOR) {
    return ALL_PERMISSIONS;
  }

  const applyOverwrite = (overwrite: DiscordOverwriteLike) => {
    const allow = toBigInt(overwrite.allow);
    const deny = toBigInt(overwrite.deny);
    permissions = (permissions & ~deny) | allow;
  };

  for (const overwrite of input.overwrites) {
    if (String(overwrite.type ?? 0) === '0' && String(overwrite.id ?? '') === input.guildId) {
      applyOverwrite(overwrite);
    }
  }
  for (const overwrite of input.overwrites) {
    if (String(overwrite.type ?? 0) !== '0') continue;
    const id = String(overwrite.id ?? '');
    // @everyone was already applied above; applying it twice is wrong even
    // though the bit math happens to be idempotent.
    if (id !== input.guildId && roleIds.has(id)) applyOverwrite(overwrite);
  }
  for (const overwrite of input.overwrites) {
    if (String(overwrite.type ?? 0) === '1' && String(overwrite.id ?? '') === input.botUserId) {
      applyOverwrite(overwrite);
    }
  }

  return permissions;
}

export function hasDiscordPostingPermission(permissions: bigint): boolean {
  return (permissions & DISCORD_REQUIRED_PERMISSIONS) === DISCORD_REQUIRED_PERMISSIONS;
}

export function isDiscordSnowflake(value: string): boolean {
  return /^\d{5,25}$/.test(value);
}

function mapDiscordError(status: number, data: unknown): BotError {
  if (status === 401) {
    return new BotError('The Discord bot token was rejected.', 'bot_unauthorized');
  }
  if (status === 403) {
    return new BotError('The Crewlink bot is not allowed to use this channel.', 'missing_permissions');
  }
  if (status === 404) {
    return new BotError('That Discord channel or server could not be found by the bot.', 'chat_not_found');
  }
  if (status === 429) {
    const retryAfter = Number((data as { retry_after?: unknown } | null)?.retry_after);
    return new BotError(
      'Discord is rate limiting requests. Try again shortly.',
      'rate_limited',
      Number.isFinite(retryAfter) ? Math.ceil(retryAfter) : undefined
    );
  }
  return new BotError('Discord returned an unexpected error.', 'transport_error');
}

export class DiscordBotClient implements BotClient {
  readonly platform = 'discord' as const;
  private apiBase: string;
  private fetchImpl?: FetchLike;

  constructor(options: { fetchImpl?: FetchLike; apiBase?: string } = {}) {
    this.apiBase = options.apiBase || DEFAULT_API_BASE;
    this.fetchImpl = options.fetchImpl;
  }

  private async call(
    botToken: string,
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown } = {}
  ): Promise<unknown> {
    const response = await requestJson(`${this.apiBase}${path}`, {
      method: init.method,
      body: init.body,
      headers: { authorization: `Bot ${botToken}` },
      fetchImpl: this.fetchImpl,
    });
    if (!response.ok) throw mapDiscordError(response.status, response.data);
    return response.data;
  }

  async verifyChannel(botToken: string, channelId: string): Promise<VerifiedChannel> {
    const id = String(channelId || '').trim();
    if (!isDiscordSnowflake(id)) {
      throw new BotError('Enter the numeric id of a Discord text channel.', 'invalid_input');
    }

    const channel = (await this.call(botToken, `/channels/${id}`)) as {
      type?: unknown;
      name?: unknown;
      guild_id?: unknown;
      permission_overwrites?: DiscordOverwriteLike[];
    };
    if (!TEXT_CHANNEL_TYPES.has(Number(channel.type))) {
      throw new BotError('Only standard Discord text channels can be posted to.', 'unsupported_channel');
    }
    const guildId = String(channel.guild_id ?? '');
    if (!isDiscordSnowflake(guildId)) {
      throw new BotError('Choose a channel inside a Discord server.', 'invalid_input');
    }

    const guild = (await this.call(botToken, `/guilds/${guildId}`)) as {
      name?: unknown;
      owner_id?: unknown;
    };
    const me = (await this.call(botToken, '/users/@me')) as { id?: unknown };
    const botUserId = String(me.id ?? '');
    if (!isDiscordSnowflake(botUserId)) {
      throw new BotError('The Discord bot identity could not be confirmed.', 'transport_error');
    }

    let member: { roles?: unknown };
    try {
      member = (await this.call(botToken, `/guilds/${guildId}/members/${botUserId}`)) as {
        roles?: unknown;
      };
    } catch (err) {
      if (err instanceof BotError && err.code === 'chat_not_found') {
        throw new BotError('Add the Crewlink bot to this Discord server first.', 'bot_not_member');
      }
      throw err;
    }

    const rolesResponse = await this.call(botToken, `/guilds/${guildId}/roles`);
    const roles = Array.isArray(rolesResponse) ? (rolesResponse as DiscordRoleLike[]) : [];
    const memberRoleIds = Array.isArray(member.roles) ? member.roles.map(String) : [];

    const permissions = computeDiscordPermissions({
      guildId,
      guildOwnerId: typeof guild.owner_id === 'string' ? guild.owner_id : undefined,
      botUserId,
      memberRoleIds,
      roles,
      overwrites: Array.isArray(channel.permission_overwrites)
        ? channel.permission_overwrites
        : [],
    });
    if (!hasDiscordPostingPermission(permissions)) {
      throw new BotError(
        'The Crewlink bot needs View Channel and Send Messages in this channel.',
        'missing_permissions'
      );
    }

    return {
      serverId: guildId,
      serverName: typeof guild.name === 'string' ? guild.name : undefined,
      channelId: id,
      channelName: typeof channel.name === 'string' ? channel.name : undefined,
    };
  }

  async sendMessage(botToken: string, channelId: string, content: string): Promise<SendResult> {
    const id = String(channelId || '').trim();
    if (!isDiscordSnowflake(id)) {
      throw new BotError('Enter the numeric id of a Discord text channel.', 'invalid_input');
    }
    const message = (await this.call(botToken, `/channels/${id}/messages`, {
      method: 'POST',
      // Never let an approved draft ping @everyone or roles.
      body: { content, allowed_mentions: { parse: [] } },
    })) as { id?: unknown };
    const externalId = String(message.id ?? '');
    if (!externalId) {
      throw new BotError('Discord accepted the message but returned no id.', 'transport_error');
    }
    return { externalId };
  }
}
