import { config } from '../../config/index';

// Slack OAuth v2 and the Web API both live under slack.com. The bot scopes are
// deliberately narrow: post messages, read public channel names, and read the
// private channels the bot has actually been invited to. No user scopes are
// requested, so Crewlink never receives a person's Slack identity or history.
export const SLACK_SCOPES = ['chat:write', 'channels:read', 'groups:read'] as const;
export const SLACK_SCOPE_STRING = SLACK_SCOPES.join(',');

// chat.postMessage documents a 4,000-character text limit.
export const SLACK_MESSAGE_LIMIT = 4000;
export const SLACK_DEFAULT_TIMEOUT_MS = 15_000;
export const SLACK_CALLBACK_PATH = '/api/platforms/slack/callback';

export function isSlackConfigured(): boolean {
  return Boolean(config.slackClientId && config.slackClientSecret);
}

export function slackRedirectUri(appUrl: string = config.appUrl): string {
  return `${appUrl.replace(/\/+$/, '')}${SLACK_CALLBACK_PATH}`;
}

export default {
  SLACK_SCOPES,
  SLACK_SCOPE_STRING,
  SLACK_MESSAGE_LIMIT,
  SLACK_DEFAULT_TIMEOUT_MS,
  SLACK_CALLBACK_PATH,
  isSlackConfigured,
  slackRedirectUri,
};
