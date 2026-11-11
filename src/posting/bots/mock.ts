import { BotError, type BotClient, type SendResult, type VerifiedChannel } from './types';

// Deterministic fake bot APIs used whenever PUBLISHING_TRANSPORT is not `live`.
// Special channel ids let tests and manual runs exercise failure paths without
// any network call.

export const MOCK_CHANNEL_OUTCOMES = {
  notFound: 'mock-not-found',
  notMember: 'mock-not-member',
  missingPermissions: 'mock-missing-permissions',
  unsupported: 'mock-unsupported',
  rateLimited: 'mock-rate-limit',
  sendFails: 'mock-send-fails',
} as const;

const outcomeFor = (channelId: string) =>
  Object.values(MOCK_CHANNEL_OUTCOMES).find((outcome) => outcome === channelId);

export interface MockSentMessage {
  platform: 'discord' | 'telegram';
  channelId: string;
  content: string;
  externalId: string;
}

let sentMessages: MockSentMessage[] = [];
let counter = 0;

export function listMockSentMessages(): MockSentMessage[] {
  return [...sentMessages];
}

export function resetMockBotState(): void {
  sentMessages = [];
  counter = 0;
}

function verify(platform: 'discord' | 'telegram', channelId: string): VerifiedChannel {
  switch (outcomeFor(channelId)) {
    case MOCK_CHANNEL_OUTCOMES.notFound:
      throw new BotError('That channel could not be found.', 'chat_not_found');
    case MOCK_CHANNEL_OUTCOMES.notMember:
      throw new BotError('Add the Crewlink bot first.', 'bot_not_member');
    case MOCK_CHANNEL_OUTCOMES.missingPermissions:
      throw new BotError('The Crewlink bot needs posting permission.', 'missing_permissions');
    case MOCK_CHANNEL_OUTCOMES.unsupported:
      throw new BotError('That channel type is not supported.', 'unsupported_channel');
    case MOCK_CHANNEL_OUTCOMES.rateLimited:
      throw new BotError('The platform is rate limiting requests.', 'rate_limited', 5);
  }

  const id = channelId.trim();
  if (!id) throw new BotError('Choose a channel first.', 'invalid_input');
  return {
    serverId: `${platform}-mock-server`,
    serverName: platform === 'discord' ? 'Mock Discord Server' : 'Mock Telegram Channel',
    channelId: id,
    channelName: platform === 'discord' ? `#${id}` : `Mock ${id}`,
  };
}

function send(platform: 'discord' | 'telegram', channelId: string, content: string): SendResult {
  switch (outcomeFor(channelId)) {
    case MOCK_CHANNEL_OUTCOMES.sendFails:
      throw new BotError('The mock platform rejected the message.', 'transport_error');
    case MOCK_CHANNEL_OUTCOMES.rateLimited:
      throw new BotError('The platform is rate limiting requests.', 'rate_limited', 5);
  }
  if (!content.trim()) {
    throw new BotError('The message is empty.', 'invalid_input');
  }
  counter += 1;
  const externalId = `mock-${platform}-${counter}`;
  sentMessages.push({ platform, channelId, content, externalId });
  return { externalId };
}

export class MockDiscordClient implements BotClient {
  readonly platform = 'discord' as const;
  async verifyChannel(_botToken: string, channelId: string): Promise<VerifiedChannel> {
    return verify('discord', channelId);
  }
  async sendMessage(_botToken: string, channelId: string, content: string): Promise<SendResult> {
    return send('discord', channelId, content);
  }
}

export class MockTelegramClient implements BotClient {
  readonly platform = 'telegram' as const;
  async verifyChannel(_botToken: string, channelId: string): Promise<VerifiedChannel> {
    return verify('telegram', channelId);
  }
  async sendMessage(_botToken: string, channelId: string, content: string): Promise<SendResult> {
    return send('telegram', channelId, content);
  }
}
