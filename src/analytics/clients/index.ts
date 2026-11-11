import { config } from '../../config/index';
import type { AnalyticsPlatformId } from '../types';
import { MockAnalyticsClient } from './mock';
import {
  BlueskyAnalyticsClient,
  DiscordAnalyticsClient,
  LinkedInAnalyticsClient,
  MastodonAnalyticsClient,
  RedditAnalyticsClient,
  SlackAnalyticsClient,
  TelegramAnalyticsClient,
  UnsupportedAnalyticsClient,
  XAnalyticsClient,
} from './live';
import type { AnalyticsClient } from './types';

const overrides: Partial<Record<AnalyticsPlatformId, AnalyticsClient>> = {};

// Tests inject a fake client; production never calls this.
export function setAnalyticsClientForTests(
  platform: AnalyticsPlatformId,
  client: AnalyticsClient | null
): void {
  if (client) overrides[platform] = client;
  else delete overrides[platform];
}

export function resetAnalyticsClientsForTests(): void {
  for (const platform of Object.keys(overrides) as AnalyticsPlatformId[]) {
    delete overrides[platform];
  }
}

// Mock by default, matching the publishing transport. A live client only exists
// when PUBLISHING_TRANSPORT=live; a misconfigured deployment therefore cannot
// make an accidental analytics call.
export function getAnalyticsClient(platformId: AnalyticsPlatformId): AnalyticsClient {
  const override = overrides[platformId];
  if (override) return override;

  if (platformId === 'whatsapp') return new UnsupportedAnalyticsClient('whatsapp');

  if (config.publishingTransport !== 'live') return new MockAnalyticsClient(platformId);

  switch (platformId) {
    case 'x':
      return new XAnalyticsClient();
    case 'linkedin':
      return new LinkedInAnalyticsClient();
    case 'reddit':
      return new RedditAnalyticsClient();
    case 'bluesky':
      return new BlueskyAnalyticsClient();
    case 'mastodon':
      return new MastodonAnalyticsClient();
    case 'discord':
      return new DiscordAnalyticsClient();
    case 'telegram':
      return new TelegramAnalyticsClient();
    case 'slack':
      return new SlackAnalyticsClient();
    default:
      return new UnsupportedAnalyticsClient(platformId);
  }
}

export * from './types';
export { MockAnalyticsClient } from './mock';
export {
  BlueskyAnalyticsClient,
  DiscordAnalyticsClient,
  LinkedInAnalyticsClient,
  MastodonAnalyticsClient,
  RedditAnalyticsClient,
  SlackAnalyticsClient,
  TelegramAnalyticsClient,
  UnsupportedAnalyticsClient,
  XAnalyticsClient,
} from './live';
