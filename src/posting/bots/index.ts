import { config } from '../../config/index';
import { getSecretStore } from '../secrets';
import { BotError, type BotClient, type BotPlatform } from './types';
import { DiscordBotClient } from './discord';
import { TelegramBotClient } from './telegram';
import { MockDiscordClient, MockTelegramClient } from './mock';

// Application-level Crewlink bot tokens. They live in the secret store only and
// are passed to the HTTP clients per call; nothing here reaches the client side.
export const BOT_TOKEN_SECRETS: Record<BotPlatform, string> = {
  discord: 'DISCORD_BOT_TOKEN',
  telegram: 'TELEGRAM_BOT_TOKEN',
};

export async function loadBotToken(platform: BotPlatform): Promise<string> {
  const name = BOT_TOKEN_SECRETS[platform];
  let value: string | null;
  try {
    value = await getSecretStore().get(name);
  } catch {
    throw new BotError('The Crewlink bot token could not be loaded.', 'bot_token_missing');
  }
  const token = String(value || '').trim();
  // Tokens are sent as headers/URLs; whitespace would be header injection.
  if (!token || /\s/.test(token)) {
    throw new BotError(`The Crewlink ${platform} bot is not configured.`, 'bot_token_missing');
  }
  return token;
}

let clientOverrides: Partial<Record<BotPlatform, BotClient>> = {};

export function setBotClientForTests(platform: BotPlatform, client: BotClient | null): void {
  if (client) {
    clientOverrides[platform] = client;
  } else {
    delete clientOverrides[platform];
  }
}

export function resetBotClientsForTests(): void {
  clientOverrides = {};
}

// Mock by default; the live clients only exist when PUBLISHING_TRANSPORT=live.
export function getBotClient(platform: BotPlatform): BotClient {
  const override = clientOverrides[platform];
  if (override) return override;

  const live = config.publishingTransport === 'live';
  if (platform === 'discord') {
    return live ? new DiscordBotClient() : new MockDiscordClient();
  }
  return live ? new TelegramBotClient() : new MockTelegramClient();
}

export * from './types';
export { DiscordBotClient, computeDiscordPermissions, hasDiscordPostingPermission } from './discord';
export { TelegramBotClient } from './telegram';
export {
  MockDiscordClient,
  MockTelegramClient,
  MOCK_CHANNEL_OUTCOMES,
  listMockSentMessages,
  resetMockBotState,
} from './mock';
export type { FetchLike } from './http';
