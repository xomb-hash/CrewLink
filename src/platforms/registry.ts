import type { Platform } from '../types/index';

// Platform metadata only. Posting integrations intentionally do not live here.
// auth describes how Crewlink is allowed to post:
// - oauth: the creator authorises Crewlink for their own account.
// - bot: Crewlink's official bot/app is added to the creator's channel or server.
// - manual: Crewlink prepares the text and the creator posts it.
export const platforms: Platform[] = [
  {
    id: 'discord',
    name: 'Discord',
    characterLimit: 2000,
    mode: 'auto',
    auth: 'bot',
    note: "Uses Crewlink's official Discord app; the owner chooses one channel.",
  },
  {
    id: 'telegram',
    name: 'Telegram',
    characterLimit: 4096,
    mode: 'auto',
    auth: 'bot',
    note: "Uses Crewlink's official Telegram bot; the owner chooses one channel.",
  },
  { id: 'bluesky', name: 'Bluesky', characterLimit: 300, mode: 'auto', count: 'graphemes', auth: 'oauth' },
  // Mastodon instances can configure a different limit; 500 is Mastodon's documented default.
  {
    id: 'mastodon',
    name: 'Mastodon',
    characterLimit: 500,
    mode: 'auto',
    auth: 'oauth',
    note: 'Default; instances may vary.',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    characterLimit: 3000,
    mode: 'auto',
    auth: 'oauth',
    note: "Publishes a member text post through LinkedIn's versioned Posts API. Organization pages need separate approval and are not supported.",
  },
  // WhatsApp has no public Channel-update text limit in its current help docs; use this conservative product limit.
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    characterLimit: 1000,
    mode: 'manual',
    auth: 'manual',
    note: 'WhatsApp has no official Channel posting API yet; copy the draft and post it yourself.',
  },
  {
    id: 'x',
    name: 'X',
    characterLimit: 280,
    mode: 'auto',
    auth: 'oauth',
    // Optional and off by default: X charges for every published post.
    defaultEnabled: false,
    costNote:
      'X charges per published post ($0.015, or $0.200 when the post contains a link). Crewlink asks for confirmation before every post and never retries automatically.',
  },
  {
    id: 'reddit',
    name: 'Reddit',
    // Reddit titles are capped at 300 characters; self-post bodies allow 40,000.
    characterLimit: 40000,
    titleLimit: 300,
    mode: 'auto',
    auth: 'oauth',
    note: 'Posts a text or link submission to a subreddit you can submit to; titles are limited to 300 characters.',
  },
  {
    id: 'slack',
    name: 'Slack',
    characterLimit: 4000,
    mode: 'auto',
    auth: 'oauth',
    note: "Uses Crewlink's app installed in the owner's workspace.",
  },
];

export const byId = (id: string): Platform | undefined =>
  platforms.find((platform) => platform.id === id);

export default { platforms, byId };
