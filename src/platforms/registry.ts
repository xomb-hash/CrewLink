import type { Platform } from '../types/index';

// Platform metadata only. Posting integrations intentionally do not live here.
export const platforms: Platform[] = [
  { id: 'discord', name: 'Discord', characterLimit: 2000, mode: 'auto' },
  { id: 'telegram', name: 'Telegram', characterLimit: 4096, mode: 'auto' },
  { id: 'bluesky', name: 'Bluesky', characterLimit: 300, mode: 'auto', count: 'graphemes' },
  // Mastodon instances can configure a different limit; 500 is Mastodon's documented default.
  { id: 'mastodon', name: 'Mastodon', characterLimit: 500, mode: 'auto', note: 'Default; instances may vary.' },
  { id: 'linkedin', name: 'LinkedIn', characterLimit: 3000, mode: 'auto' },
  // WhatsApp has no public Channel-update text limit in its current help docs; use this conservative product limit.
  { id: 'whatsapp', name: 'WhatsApp', characterLimit: 1000, mode: 'manual' },
];

export const byId = (id: string): Platform | undefined =>
  platforms.find((platform) => platform.id === id);

export default { platforms, byId };
