import { requestJson, type FetchLike } from './http';
import { BotError, type BotClient, type SendResult, type VerifiedChannel } from './types';

const DEFAULT_API_BASE = 'https://api.telegram.org';

interface TelegramEnvelope<T> {
  ok?: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

function mapTelegramError(status: number, data: unknown): BotError {
  const envelope = (data || {}) as TelegramEnvelope<unknown>;
  const code = Number(envelope.error_code ?? status);
  const description = String(envelope.description || '');

  if (code === 401) {
    return new BotError('The Telegram bot token was rejected.', 'bot_unauthorized');
  }
  if (code === 403) {
    return new BotError('The Crewlink bot is not allowed to post in this chat.', 'missing_permissions');
  }
  if (code === 429) {
    const retryAfter = Number(envelope.parameters?.retry_after);
    return new BotError(
      'Telegram is rate limiting requests. Try again shortly.',
      'rate_limited',
      Number.isFinite(retryAfter) ? Math.ceil(retryAfter) : undefined
    );
  }
  if (code === 400) {
    if (/not found|invalid chat|chat_id is empty/i.test(description)) {
      return new BotError(
        'That Telegram channel could not be found. Add the Crewlink bot as an admin first.',
        'chat_not_found'
      );
    }
    if (/not a member|not enough rights|participant/i.test(description)) {
      return new BotError('Add the Crewlink bot to this Telegram channel first.', 'bot_not_member');
    }
    return new BotError('Telegram rejected the request.', 'invalid_input');
  }
  return new BotError('Telegram returned an unexpected error.', 'transport_error');
}

export function isTelegramChatId(value: string): boolean {
  return /^-?\d{5,25}$/.test(value) || /^@[A-Za-z0-9_]{5,64}$/.test(value);
}

export class TelegramBotClient implements BotClient {
  readonly platform = 'telegram' as const;
  private apiBase: string;
  private fetchImpl?: FetchLike;

  constructor(options: { fetchImpl?: FetchLike; apiBase?: string } = {}) {
    this.apiBase = options.apiBase || DEFAULT_API_BASE;
    this.fetchImpl = options.fetchImpl;
  }

  // The bot token lives in the URL path for the Telegram API. The URL must never
  // be logged or echoed; requestJson only reports safe, static errors.
  private async call<T>(
    botToken: string,
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const response = await requestJson(`${this.apiBase}/bot${botToken}/${method}`, {
      method: params ? 'POST' : 'GET',
      body: params,
      fetchImpl: this.fetchImpl,
    });
    const envelope = (response.data || {}) as TelegramEnvelope<T>;
    if (!response.ok || envelope.ok !== true) {
      throw mapTelegramError(response.status, response.data);
    }
    return envelope.result as T;
  }

  async verifyChannel(botToken: string, channelId: string): Promise<VerifiedChannel> {
    const chatId = String(channelId || '').trim();
    if (!isTelegramChatId(chatId)) {
      throw new BotError(
        'Enter a Telegram channel id (like -1001234567890) or @username.',
        'invalid_input'
      );
    }

    const me = await this.call<{ id?: number; is_bot?: boolean }>(botToken, 'getMe');
    if (!me || me.is_bot !== true || me.id === undefined) {
      throw new BotError('The Telegram bot identity could not be confirmed.', 'bot_unauthorized');
    }

    const chat = await this.call<{
      id?: number | string;
      type?: string;
      title?: string;
      username?: string;
    }>(botToken, 'getChat', { chat_id: chatId });
    const chatType = String(chat?.type || '');
    if (!['channel', 'group', 'supergroup'].includes(chatType)) {
      throw new BotError('Only Telegram channels and groups can be posted to.', 'unsupported_channel');
    }

    const member = await this.call<{ status?: string; can_post_messages?: boolean }>(
      botToken,
      'getChatMember',
      { chat_id: chatId, user_id: me.id }
    );
    const status = String(member?.status || '');
    if (status !== 'administrator' && status !== 'creator') {
      throw new BotError(
        'Add the Crewlink bot as an admin of this Telegram channel.',
        'bot_not_member'
      );
    }
    // In channels only administrators with this right may post; creators always can.
    if (chatType === 'channel' && status === 'administrator' && member?.can_post_messages !== true) {
      throw new BotError(
        'Give the Crewlink bot permission to post messages in this Telegram channel.',
        'missing_permissions'
      );
    }

    const resolvedId = String(chat.id ?? chatId);
    const title =
      typeof chat.title === 'string' && chat.title
        ? chat.title
        : typeof chat.username === 'string' && chat.username
          ? chat.username
          : undefined;

    return {
      serverId: resolvedId,
      serverName: title,
      channelId: resolvedId,
      channelName: title,
    };
  }

  async sendMessage(botToken: string, channelId: string, content: string): Promise<SendResult> {
    const chatId = String(channelId || '').trim();
    if (!isTelegramChatId(chatId)) {
      throw new BotError(
        'Enter a Telegram channel id (like -1001234567890) or @username.',
        'invalid_input'
      );
    }

    const message = await this.call<{ message_id?: number }>(botToken, 'sendMessage', {
      chat_id: chatId,
      text: content,
    });
    if (!message || message.message_id === undefined) {
      throw new BotError('Telegram accepted the message but returned no id.', 'transport_error');
    }
    return { externalId: String(message.message_id) };
  }
}
