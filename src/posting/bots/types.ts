// Shared shapes for the Discord and Telegram bot clients. Keeping one interface
// for both means the connect and publish code never branches on platform.
// A bot token is application-level: it is read from the secret store and passed
// in per call. It is never put on a connection record or sent to a client.

export type BotPlatform = 'discord' | 'telegram';

export type BotErrorCode =
  | 'invalid_input'
  | 'bot_token_missing'
  | 'bot_unauthorized'
  | 'chat_not_found'
  | 'bot_not_member'
  | 'missing_permissions'
  | 'unsupported_channel'
  | 'rate_limited'
  | 'transport_error';

export class BotError extends Error {
  constructor(
    message: string,
    readonly code: BotErrorCode,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'BotError';
  }
}

// Channel metadata that is safe to show the owner and to store on a connection.
export interface VerifiedChannel {
  serverId?: string;
  serverName?: string;
  channelId: string;
  channelName?: string;
}

export interface SendResult {
  externalId: string;
}

export interface BotClient {
  readonly platform: BotPlatform;
  // Confirms the bot is a member of the destination and may post there.
  verifyChannel(botToken: string, channelId: string): Promise<VerifiedChannel>;
  sendMessage(botToken: string, channelId: string, content: string): Promise<SendResult>;
}
