import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import {
  DiscordBotClient,
  computeDiscordPermissions,
  hasDiscordPostingPermission,
  VIEW_CHANNEL,
  SEND_MESSAGES,
  ADMINISTRATOR,
} from '../src/posting/bots/discord';
import { TelegramBotClient } from '../src/posting/bots/telegram';
import { BotError } from '../src/posting/bots/types';
import type { FetchLike } from '../src/posting/bots/http';
import {
  MockDiscordClient,
  MockTelegramClient,
  MOCK_CHANNEL_OUTCOMES,
  listMockSentMessages,
  resetMockBotState,
} from '../src/posting/bots/mock';

const code = (err: unknown) => (err instanceof BotError ? err.code : 'unexpected');

type Reply = { status?: number; body?: unknown };

function fakeFetch(handler: (url: string, init?: RequestInit) => Reply) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body = {} } = handler(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, calls };
}

const GUILD_ID = '900000000000000001';
const CHANNEL_ID = '910000000000000123';
const BOT_ID = '920000000000000001';
const BOT_ROLE = '930000000000000001';

function discordRoutes(overrides: Record<string, () => Reply> = {}) {
  return fakeFetch((url) => {
    for (const [fragment, handler] of Object.entries(overrides)) {
      if (url.includes(fragment)) return handler();
    }
    if (url.endsWith(`/channels/${CHANNEL_ID}`)) {
      return {
        body: {
          id: CHANNEL_ID,
          type: 0,
          name: 'build-in-public',
          guild_id: GUILD_ID,
          permission_overwrites: [
            { id: GUILD_ID, type: 0, allow: '0', deny: String(SEND_MESSAGES) },
            { id: BOT_ROLE, type: 0, allow: String(SEND_MESSAGES), deny: '0' },
          ],
        },
      };
    }
    if (url.endsWith(`/guilds/${GUILD_ID}`)) {
      return { body: { id: GUILD_ID, name: 'Crewlink Test', owner_id: '950000000000000001' } };
    }
    if (url.endsWith('/users/@me')) return { body: { id: BOT_ID, bot: true } };
    if (url.endsWith(`/guilds/${GUILD_ID}/members/${BOT_ID}`)) {
      return { body: { roles: [BOT_ROLE] } };
    }
    if (url.endsWith(`/guilds/${GUILD_ID}/roles`)) {
      return {
        body: [
          { id: GUILD_ID, permissions: String(VIEW_CHANNEL) },
          { id: BOT_ROLE, permissions: String(SEND_MESSAGES) },
        ],
      };
    }
    if (url.endsWith(`/channels/${CHANNEL_ID}/messages`)) {
      return { body: { id: '940000000000000001' } };
    }
    return { status: 404, body: { message: 'Unknown route' } };
  });
}

test('discord: permission math applies base, overwrites and administrator', () => {
  const base = computeDiscordPermissions({
    guildId: GUILD_ID,
    botUserId: BOT_ID,
    memberRoleIds: [BOT_ROLE],
    roles: [
      { id: GUILD_ID, permissions: String(VIEW_CHANNEL) },
      { id: BOT_ROLE, permissions: String(SEND_MESSAGES) },
    ],
    overwrites: [],
  });
  assert.ok(hasDiscordPostingPermission(base));

  const denied = computeDiscordPermissions({
    guildId: GUILD_ID,
    botUserId: BOT_ID,
    memberRoleIds: [BOT_ROLE],
    roles: [
      { id: GUILD_ID, permissions: String(VIEW_CHANNEL) },
      { id: BOT_ROLE, permissions: String(SEND_MESSAGES) },
    ],
    overwrites: [{ id: BOT_ID, type: 1, allow: '0', deny: String(VIEW_CHANNEL) }],
  });
  assert.ok(!hasDiscordPostingPermission(denied));

  const admin = computeDiscordPermissions({
    guildId: GUILD_ID,
    botUserId: BOT_ID,
    memberRoleIds: [],
    roles: [{ id: GUILD_ID, permissions: String(ADMINISTRATOR) }],
    overwrites: [{ id: GUILD_ID, type: 0, allow: '0', deny: String(SEND_MESSAGES) }],
  });
  assert.ok(hasDiscordPostingPermission(admin));

  const owner = computeDiscordPermissions({
    guildId: GUILD_ID,
    guildOwnerId: BOT_ID,
    botUserId: BOT_ID,
    memberRoleIds: [],
    roles: [],
    overwrites: [],
  });
  assert.ok(hasDiscordPostingPermission(owner));
});

test('discord: verification accepts a permitted channel and returns its metadata', async () => {
  const { fetchImpl, calls } = discordRoutes();
  const client = new DiscordBotClient({ fetchImpl });

  const channel = await client.verifyChannel('bot-secret-token', CHANNEL_ID);
  assert.deepEqual(channel, {
    serverId: GUILD_ID,
    serverName: 'Crewlink Test',
    channelId: CHANNEL_ID,
    channelName: 'build-in-public',
  });
  assert.ok(calls.every((call) => !call.url.includes('bot-secret-token')));
  const auth = (calls[0].init?.headers as Record<string, string>).authorization;
  assert.equal(auth, 'Bot bot-secret-token');
});

test('discord: verification fails closed for missing channel, permission or membership', async () => {
  const missing = new DiscordBotClient({
    fetchImpl: discordRoutes({ [`/channels/${CHANNEL_ID}`]: () => ({ status: 404, body: {} }) })
      .fetchImpl,
  });
  await assert.rejects(() => missing.verifyChannel('token', CHANNEL_ID), (err) => code(err) === 'chat_not_found');

  const noPermission = new DiscordBotClient({
    fetchImpl: discordRoutes({
      [`/guilds/${GUILD_ID}/roles`]: () => ({ body: [{ id: GUILD_ID, permissions: '0' }] }),
    }).fetchImpl,
  });
  await assert.rejects(
    () => noPermission.verifyChannel('token', CHANNEL_ID),
    (err) => code(err) === 'missing_permissions'
  );

  const notMember = new DiscordBotClient({
    fetchImpl: discordRoutes({
      [`/members/${BOT_ID}`]: () => ({ status: 404, body: {} }),
    }).fetchImpl,
  });
  await assert.rejects(
    () => notMember.verifyChannel('token', CHANNEL_ID),
    (err) => code(err) === 'bot_not_member'
  );

  const voice = new DiscordBotClient({
    fetchImpl: discordRoutes({
      [`/channels/${CHANNEL_ID}`]: () => ({ body: { id: CHANNEL_ID, type: 2, guild_id: GUILD_ID } }),
    }).fetchImpl,
  });
  await assert.rejects(
    () => voice.verifyChannel('token', CHANNEL_ID),
    (err) => code(err) === 'unsupported_channel'
  );

  const client = new DiscordBotClient({ fetchImpl: discordRoutes().fetchImpl });
  await assert.rejects(() => client.verifyChannel('token', 'not-a-snowflake'), (err) => code(err) === 'invalid_input');
});

test('discord: send posts the approved text without mentions and maps errors', async () => {
  const { fetchImpl, calls } = discordRoutes();
  const client = new DiscordBotClient({ fetchImpl });

  const sent = await client.sendMessage('bot-secret-token', CHANNEL_ID, 'Join us');
  assert.equal(sent.externalId, '940000000000000001');

  const post = calls.at(-1);
  assert.equal(post?.init?.method, 'POST');
  const body = JSON.parse(String(post?.init?.body));
  assert.deepEqual(body, { content: 'Join us', allowed_mentions: { parse: [] } });

  const unauthorized = new DiscordBotClient({
    fetchImpl: fakeFetch(() => ({ status: 401, body: {} })).fetchImpl,
  });
  await assert.rejects(
    () => unauthorized.sendMessage('super-secret', CHANNEL_ID, 'hi'),
    (err) => code(err) === 'bot_unauthorized' && !(err as BotError).message.includes('super-secret')
  );

  const limited = new DiscordBotClient({
    fetchImpl: fakeFetch(() => ({ status: 429, body: { retry_after: 1.7 } })).fetchImpl,
  });
  await assert.rejects(
    () => limited.sendMessage('token', CHANNEL_ID, 'hi'),
    (err) => code(err) === 'rate_limited' && (err as BotError).retryAfterSeconds === 2
  );
});

function telegramRoutes(overrides: Record<string, () => Reply> = {}) {
  return fakeFetch((url) => {
    for (const [fragment, handler] of Object.entries(overrides)) {
      if (url.includes(fragment)) return handler();
    }
    if (url.endsWith('/getMe')) return { body: { ok: true, result: { id: 42, is_bot: true } } };
    if (url.endsWith('/getChat')) {
      return { body: { ok: true, result: { id: -1001234567890, type: 'channel', title: 'Crewlink' } } };
    }
    if (url.endsWith('/getChatMember')) {
      return {
        body: {
          ok: true,
          result: { status: 'administrator', can_post_messages: true },
        },
      };
    }
    if (url.endsWith('/sendMessage')) {
      return { body: { ok: true, result: { message_id: 321 } } };
    }
    return { status: 404, body: { ok: false, error_code: 404, description: 'Not Found' } };
  });
}

test('telegram: verification requires admin rights and channel posting permission', async () => {
  const { fetchImpl, calls } = telegramRoutes();
  const client = new TelegramBotClient({ fetchImpl });

  const channel = await client.verifyChannel('123:secret', '-1001234567890');
  assert.equal(channel.channelId, '-1001234567890');
  assert.equal(channel.channelName, 'Crewlink');
  const memberBody = JSON.parse(
    String(calls.find((call) => call.url.endsWith('/getChatMember'))?.init?.body)
  );
  assert.equal(memberBody.user_id, 42);

  const noPost = new TelegramBotClient({
    fetchImpl: telegramRoutes({
      '/getChatMember': () => ({
        body: { ok: true, result: { status: 'administrator', can_post_messages: false } },
      }),
    }).fetchImpl,
  });
  await assert.rejects(
    () => noPost.verifyChannel('123:secret', '-1001234567890'),
    (err) => code(err) === 'missing_permissions'
  );

  const notAdmin = new TelegramBotClient({
    fetchImpl: telegramRoutes({
      '/getChatMember': () => ({ body: { ok: true, result: { status: 'member' } } }),
    }).fetchImpl,
  });
  await assert.rejects(
    () => notAdmin.verifyChannel('123:secret', '-1001234567890'),
    (err) => code(err) === 'bot_not_member'
  );

  const notChannel = new TelegramBotClient({
    fetchImpl: telegramRoutes({
      '/getChat': () => ({ body: { ok: true, result: { id: 1, type: 'private', title: 'DM' } } }),
    }).fetchImpl,
  });
  await assert.rejects(
    () => notChannel.verifyChannel('123:secret', '-1001234567890'),
    (err) => code(err) === 'unsupported_channel'
  );

  await assert.rejects(
    () => client.verifyChannel('123:secret', 'not a chat'),
    (err) => code(err) === 'invalid_input'
  );
});

test('telegram: send uses the approved text and never leaks the token in errors', async () => {
  const { fetchImpl, calls } = telegramRoutes();
  const client = new TelegramBotClient({ fetchImpl });

  const sent = await client.sendMessage('123:secret-token', '@crewlink', 'Join us');
  assert.equal(sent.externalId, '321');
  const post = calls.at(-1);
  const body = JSON.parse(String(post?.init?.body));
  assert.deepEqual(body, { chat_id: '@crewlink', text: 'Join us' });

  const unauthorized = new TelegramBotClient({
    fetchImpl: fakeFetch(() => ({
      status: 401,
      body: { ok: false, error_code: 401, description: 'Unauthorized' },
    })).fetchImpl,
  });
  await assert.rejects(
    () => unauthorized.sendMessage('123:secret-token', '@crewlink', 'hi'),
    (err) =>
      code(err) === 'bot_unauthorized' &&
      !(err as BotError).message.includes('secret-token') &&
      !(err as BotError).message.includes('api.telegram.org')
  );

  const limited = new TelegramBotClient({
    fetchImpl: fakeFetch(() => ({
      status: 429,
      body: { ok: false, error_code: 429, parameters: { retry_after: 3 } },
    })).fetchImpl,
  });
  await assert.rejects(
    () => limited.sendMessage('123:secret-token', '@crewlink', 'hi'),
    (err) => code(err) === 'rate_limited' && (err as BotError).retryAfterSeconds === 3
  );

  const unreachable = new TelegramBotClient({
    fetchImpl: (async () => {
      throw new Error('socket hang up');
    }) as FetchLike,
  });
  await assert.rejects(
    () => unreachable.sendMessage('123:secret-token', '@crewlink', 'hi'),
    (err) => code(err) === 'transport_error' && !(err as BotError).message.includes('secret-token')
  );
});

test('mock transports cover success and every failure path without a network call', async () => {
  resetMockBotState();
  const discord = new MockDiscordClient();
  const telegram = new MockTelegramClient();

  const verified = await discord.verifyChannel('', '1234567890');
  assert.equal(verified.channelId, '1234567890');

  const sent = await discord.sendMessage('', '1234567890', 'Approved text');
  assert.ok(sent.externalId.startsWith('mock-discord-'));
  const sentTelegram = await telegram.sendMessage('', '@crewlink', 'Approved text');
  assert.ok(sentTelegram.externalId.startsWith('mock-telegram-'));
  assert.equal(listMockSentMessages().length, 2);

  const outcomes: Array<[string, string]> = [
    [MOCK_CHANNEL_OUTCOMES.notFound, 'chat_not_found'],
    [MOCK_CHANNEL_OUTCOMES.notMember, 'bot_not_member'],
    [MOCK_CHANNEL_OUTCOMES.missingPermissions, 'missing_permissions'],
    [MOCK_CHANNEL_OUTCOMES.unsupported, 'unsupported_channel'],
    [MOCK_CHANNEL_OUTCOMES.rateLimited, 'rate_limited'],
  ];
  for (const [channelId, expected] of outcomes) {
    await assert.rejects(
      () => discord.verifyChannel('', channelId),
      (err) => code(err) === expected
    );
  }

  await assert.rejects(
    () => discord.sendMessage('', MOCK_CHANNEL_OUTCOMES.sendFails, 'text'),
    (err) => code(err) === 'transport_error'
  );
});
