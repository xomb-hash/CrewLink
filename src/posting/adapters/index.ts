import { config } from '../../config/index';
import { BlueskyClient, MockBlueskyClient } from './bluesky';
import { LinkedInClient, MockLinkedInClient } from './linkedin';
import { MastodonClient, MockMastodonClient } from './mastodon';
import { RedditClient, MockRedditClient } from './reddit';
import { SlackClient, MockSlackClient } from './slack';
import { XClient, MockXClient } from './x';
import type {
  BlueskyClientLike,
  LinkedInClientLike,
  MastodonClientLike,
  OAuthPlatform,
  RedditClientLike,
  SlackClientLike,
  XClientLike,
} from './types';

const overrides: {
  bluesky?: BlueskyClientLike;
  mastodon?: MastodonClientLike;
  x?: XClientLike;
  reddit?: RedditClientLike;
  linkedin?: LinkedInClientLike;
  slack?: SlackClientLike;
} = {};

export function setOAuthClientForTests(
  platform: OAuthPlatform,
  client:
    | BlueskyClientLike
    | MastodonClientLike
    | XClientLike
    | RedditClientLike
    | LinkedInClientLike
    | SlackClientLike
    | null
): void {
  if (!client) {
    delete overrides[platform];
    return;
  }
  if (platform === 'bluesky') {
    overrides.bluesky = client as BlueskyClientLike;
  } else if (platform === 'mastodon') {
    overrides.mastodon = client as MastodonClientLike;
  } else if (platform === 'reddit') {
    overrides.reddit = client as RedditClientLike;
  } else if (platform === 'linkedin') {
    overrides.linkedin = client as LinkedInClientLike;
  } else if (platform === 'slack') {
    overrides.slack = client as SlackClientLike;
  } else {
    overrides.x = client as XClientLike;
  }
}

export function resetOAuthClientsForTests(): void {
  delete overrides.bluesky;
  delete overrides.mastodon;
  delete overrides.x;
  delete overrides.reddit;
  delete overrides.linkedin;
  delete overrides.slack;
}

// Mock by default, matching the Discord/Telegram transport. A live client is only
// used when PUBLISHING_TRANSPORT=live, so a misconfigured deployment cannot make
// accidental Bluesky or Mastodon calls.
export function getBlueskyClient(): BlueskyClientLike {
  if (overrides.bluesky) return overrides.bluesky;
  return config.publishingTransport === 'live'
    ? new BlueskyClient({ serviceUrl: config.blueskyServiceUrl })
    : new MockBlueskyClient();
}

export function getMastodonClient(): MastodonClientLike {
  if (overrides.mastodon) return overrides.mastodon;
  return config.publishingTransport === 'live'
    ? new MastodonClient()
    : new MockMastodonClient();
}

export function getXClient(): XClientLike {
  if (overrides.x) return overrides.x;
  return config.publishingTransport === 'live' ? new XClient() : new MockXClient();
}

export function getRedditClient(): RedditClientLike {
  if (overrides.reddit) return overrides.reddit;
  return config.publishingTransport === 'live'
    ? new RedditClient()
    : new MockRedditClient();
}

export function getLinkedInClient(): LinkedInClientLike {
  if (overrides.linkedin) return overrides.linkedin;
  return config.publishingTransport === 'live'
    ? new LinkedInClient()
    : new MockLinkedInClient();
}

export function getSlackClient(): SlackClientLike {
  if (overrides.slack) return overrides.slack;
  return config.publishingTransport === 'live'
    ? new SlackClient()
    : new MockSlackClient();
}

export * from './types';
export {
  BlueskyClient,
  MockBlueskyClient,
  BLUESKY_GRAPHEME_LIMIT,
  BLUESKY_BYTE_LIMIT,
  resetMockBlueskyState,
  resetBlueskyRefreshStateForTests,
} from './bluesky';
export {
  MastodonClient,
  MockMastodonClient,
  normalizeMastodonInstanceUrl,
  MASTODON_SCOPES,
  MASTODON_SCOPE_STRING,
  DEFAULT_MASTODON_LIMIT,
  resetMockMastodonState,
} from './mastodon';
export {
  XClient,
  MockXClient,
  mockXClient,
  resetMockXState,
  X_SCOPES,
  X_SCOPE_STRING,
  X_DEFAULT_TIMEOUT_MS,
} from './x';
export {
  RedditClient,
  MockRedditClient,
  mockRedditClient,
  resetMockRedditState,
  REDDIT_SCOPES,
  REDDIT_SCOPE_STRING,
  REDDIT_DEFAULT_TIMEOUT_MS,
  REDDIT_SUBREDDIT_PATTERN,
} from './reddit';
export {
  defaultLookup,
  isPublicAddress,
  resolvePublicAddresses,
  type LookupFn,
  type ResolvedAddress,
} from './ssrf';
export {
  LinkedInClient,
  MockLinkedInClient,
  mockLinkedInClient,
  resetMockLinkedInState,
  LINKEDIN_DEFAULT_TIMEOUT_MS,
} from './linkedin';
export {
  SlackClient,
  MockSlackClient,
  mockSlackClient,
  resetMockSlackState,
  SlackError,
  SLACK_DEFAULT_TIMEOUT_MS,
} from './slack';
export {
  SLACK_SCOPES,
  SLACK_SCOPE_STRING,
  SLACK_MESSAGE_LIMIT,
  SLACK_CALLBACK_PATH,
  isSlackConfigured,
  slackRedirectUri,
} from '../slack/config';
export {
  LINKEDIN_SCOPES,
  LINKEDIN_SCOPE_STRING,
  LINKEDIN_ORGANIZATION_SCOPE,
  LINKEDIN_POST_LIMIT,
  LINKEDIN_DEFAULT_API_VERSION,
  LINKEDIN_LATEST_DOCUMENTED_VERSION,
  LINKEDIN_CALLBACK_PATH,
  LINKEDIN_RESTLI_PROTOCOL_VERSION,
  LinkedInConfigError,
  isLinkedInConfigured,
  linkedInApiHeaders,
  linkedInMemberUrn,
  linkedInPostUrlFromUrn,
  linkedInPostsUrl,
  linkedInRedirectUri,
  linkedInUserInfoUrl,
  resolveLinkedInApiVersion,
  resolveLinkedInCredentials,
  validateLinkedInApiVersion,
} from '../linkedin/config';
export type { FetchLike } from './http';
