import test from 'node:test';
import assert from 'node:assert/strict';
import { SlackClient, SlackError } from '../src/posting/adapters/slack';
import { AdapterError } from '../src/posting/adapters/types';
import { SLACK_MESSAGE_LIMIT, SLACK_SCOPE_STRING } from '../src/posting/slack/config';

interface FakeResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function fakeFetch(responses: FakeResponse[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return new Response(
      next.body === undefined ? '' : JSON.stringify(next.body),
      { status: next.status ?? 200, headers: next.headers }
    );
  };
  return { fetchImpl, calls };
}

function client(responses: FakeResponse[]) {
  const fake = fakeFetch(responses);
  const instance = new SlackClient({
    authorizeUrl: 'https://slack.test/oauth/v2/authorize',
    tokenUrl: 'https://slack.test/api/oauth.v2.access',
    apiBaseUrl: 'https://slack.test/api/',
    fetchImpl: fake.fetchImpl,
    timeoutMs: 1_000,
  });
  return { instance, ...fake };
}

function formOf(init?: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init?.body || ''));
}

async function expectSlackError(
  promise: Promise<unknown>,
  expected: { slackError: string; code: AdapterError['code']; retryAfterSeconds?: number }
) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof SlackError);
    assert.equal(err.slackError, expected.slackError);
    assert.equal(err.code, expected.code);
    if (expected.retryAfterSeconds !== undefined) {
      assert.equal(err.retryAfterSeconds, expected.retryAfterSeconds);
    }
    return true;
  });
}

const TOKENS = { accessToken: 'xoxb-test-token' };

test('Slack authorization asks only for the bot scopes', () => {
  const { instance } = client([]);
  const url = new URL(
    instance.authorizationUrl({
      clientId: 'client-1',
      redirectUri: 'https://crewlink.test/api/platforms/slack/callback',
      state: 'state-1',
    })
  );
  assert.equal(url.origin + url.pathname, 'https://slack.test/oauth/v2/authorize');
  assert.equal(url.searchParams.get('client_id'), 'client-1');
  assert.equal(url.searchParams.get('scope'), SLACK_SCOPE_STRING);
  assert.equal(url.searchParams.get('scope'), 'chat:write,channels:read,groups:read');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://crewlink.test/api/platforms/slack/callback'
  );
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.equal(url.searchParams.has('user_scope'), false);
});

test('Slack exchanges the code server-side and verifies the bot identity', async (t) => {
  await t.test('posts the code and stores only safe summary fields', async () => {
    const { instance, calls } = client([
      {
        body: {
          ok: true,
          access_token: 'xoxb-real',
          token_type: 'bot',
          scope: 'chat:write,channels:read,groups:read',
          bot_user_id: 'U_BOT',
          app_id: 'A_APP',
          team: { id: 'T_TEAM', name: 'Crew Workspace' },
          authed_user: { id: 'U_USER' },
        },
      },
      {
        body: {
          ok: true,
          team_id: 'T_TEAM',
          team: 'Crew Workspace',
          user_id: 'U_BOT',
          user: 'Crewlink',
          bot_id: 'B_BOT',
        },
      },
    ]);

    const session = await instance.exchangeCode({
      clientId: 'client-1',
      clientSecret: 'secret-1',
      code: 'code-1',
      redirectUri: 'https://crewlink.test/callback',
    });

    assert.equal(session.tokens.accessToken, 'xoxb-real');
    assert.equal(session.tokens.refreshToken, undefined);
    assert.equal(session.workspace.id, 'T_TEAM');
    assert.equal(session.workspace.name, 'Crew Workspace');
    assert.equal(session.botUserId, 'U_BOT');
    assert.equal(session.account.externalAccountName, 'Crewlink');
    assert.deepEqual(session.scopes, ['chat:write', 'channels:read', 'groups:read']);

    const form = formOf(calls[0].init);
    assert.equal(form.get('code'), 'code-1');
    assert.equal(form.get('client_id'), 'client-1');
    assert.equal(form.get('client_secret'), 'secret-1');
    assert.equal(form.get('redirect_uri'), 'https://crewlink.test/callback');
    assert.equal(calls[1].url, 'https://slack.test/api/auth.test');
    assert.equal(
      (calls[1].init?.headers as Record<string, string>).authorization,
      'Bearer xoxb-real'
    );
  });

  await t.test('requires the workspace and bot identity', async () => {
    const missingTeam = client([
      { body: { ok: true, access_token: 'xoxb', bot_user_id: 'U_BOT' } },
    ]).instance;
    await expectSlackError(
      missingTeam.exchangeCode({
        clientId: 'c',
        clientSecret: 's',
        code: 'code',
        redirectUri: 'r',
      }),
      { slackError: 'missing_team', code: 'instance_error' }
    );

    const missingBot = client([
      {
        body: {
          ok: true,
          access_token: 'xoxb',
          team: { id: 'T' },
        },
      },
    ]).instance;
    await expectSlackError(
      missingBot.exchangeCode({
        clientId: 'c',
        clientSecret: 's',
        code: 'code',
        redirectUri: 'r',
      }),
      { slackError: 'missing_bot_user', code: 'auth_failed' }
    );
  });

  await t.test('maps an installation rejection to auth_failed', async () => {
    const { instance } = client([{ body: { ok: false, error: 'invalid_code' } }]);
    await expectSlackError(
      instance.exchangeCode({
        clientId: 'c',
        clientSecret: 's',
        code: 'bad',
        redirectUri: 'r',
      }),
      { slackError: 'invalid_code', code: 'auth_failed' }
    );
  });
});

test('Slack channel discovery uses the bot token and follows cursors', async () => {
  const { instance, calls } = client([
    {
      body: {
        ok: true,
        channels: [
          { id: 'C_ZETA', name: 'zeta' },
          { id: 'C_ALPHA', name: 'alpha', is_member: true },
        ],
        response_metadata: { next_cursor: 'page-2' },
      },
    },
    {
      body: {
        ok: true,
        channels: [
          { id: 'G_BETA', name: 'beta', is_private: true, is_member: true },
          { id: 'C_ZETA', name: 'zeta-duplicate' },
          { id: 'C0ARCHIVED', name: 'old', is_archived: true },
        ],
        response_metadata: { next_cursor: '' },
      },
    },
  ]);

  const channels = await instance.listChannels('xoxb-list-token');
  assert.deepEqual(
    channels.map((channel) => channel.id),
    ['C_ALPHA', 'G_BETA', 'C0ARCHIVED', 'C_ZETA']
  );
  const beta = channels.find((channel) => channel.id === 'G_BETA');
  assert.equal(beta?.isPrivate, true);
  assert.equal(beta?.isMember, true);

  assert.equal(calls.length, 2);
  const first = formOf(calls[0].init);
  assert.equal(first.get('exclude_archived'), 'true');
  assert.equal(first.get('types'), 'public_channel,private_channel');
  assert.equal(first.get('cursor'), null);
  const second = formOf(calls[1].init);
  assert.equal(second.get('cursor'), 'page-2');
  for (const call of calls) {
    assert.equal(
      (call.init?.headers as Record<string, string>).authorization,
      'Bearer xoxb-list-token'
    );
  }
});

test('Slack getChannel rejects a missing channel', async () => {
  const { instance } = client([{ body: { ok: false, error: 'channel_not_found' } }]);
  await expectSlackError(instance.getChannel('token', 'C0MISSING'), {
    slackError: 'channel_not_found',
    code: 'validation_error',
  });
});

test('Slack sends through chat.postMessage and requires a timestamp', async (t) => {
  await t.test('sends the stored channel and text with previews enabled', async () => {
    const { instance, calls } = client([
      { body: { ok: true, channel: 'C0GENERAL', ts: '1700000000.000100' } },
    ]);
    const sent = await instance.sendMessage({
      tokens: TOKENS,
      channelId: 'C0GENERAL',
      text: 'Join the crew https://crewlink.test/join/rocket',
    });
    assert.equal(sent.externalId, '1700000000.000100');

    const form = formOf(calls[0].init);
    assert.equal(form.get('channel'), 'C0GENERAL');
    assert.equal(form.get('text'), 'Join the crew https://crewlink.test/join/rocket');
    assert.equal(form.get('unfurl_links'), 'true');
    assert.equal(form.get('unfurl_media'), 'true');
    assert.equal(calls[0].url, 'https://slack.test/api/chat.postMessage');
  });

  await t.test('an accepted send without ts is uncertain', async () => {
    const { instance } = client([{ body: { ok: true, channel: 'C0GENERAL' } }]);
    await expectSlackError(
      instance.sendMessage({ tokens: TOKENS, channelId: 'C0GENERAL', text: 'hello' }),
      { slackError: 'missing_ts', code: 'uncertain' }
    );
  });

  await t.test('empty and over-limit text is rejected before any request', async () => {
    const { instance, calls } = client([]);
    await expectSlackError(
      instance.sendMessage({ tokens: TOKENS, channelId: 'C0GENERAL', text: '   ' }),
      { slackError: 'no_text', code: 'validation_error' }
    );
    await expectSlackError(
      instance.sendMessage({
        tokens: TOKENS,
        channelId: 'C0GENERAL',
        text: 'a'.repeat(SLACK_MESSAGE_LIMIT + 1),
      }),
      { slackError: 'msg_too_long', code: 'validation_error' }
    );
    assert.equal(calls.length, 0);
  });
});

test('Slack HTTP-200 failures map to specific codes', async (t) => {
  const cases: Array<{
    error: string;
    slackError: string;
    code: AdapterError['code'];
    headers?: Record<string, string>;
    retryAfterSeconds?: number;
  }> = [
    { error: 'not_in_channel', slackError: 'not_in_channel', code: 'validation_error' },
    { error: 'channel_not_found', slackError: 'channel_not_found', code: 'validation_error' },
    { error: 'is_archived', slackError: 'is_archived', code: 'validation_error' },
    { error: 'restricted_action', slackError: 'restricted_action', code: 'validation_error' },
    { error: 'missing_scope', slackError: 'missing_scope', code: 'auth_failed' },
    { error: 'msg_too_long', slackError: 'msg_too_long', code: 'validation_error' },
    {
      error: 'ratelimited',
      slackError: 'ratelimited',
      code: 'rate_limited',
      headers: { 'retry-after': '7' },
      retryAfterSeconds: 7,
    },
    {
      error: 'token_revoked',
      slackError: 'token_revoked',
      code: 'revoked',
    },
  ];

  for (const item of cases) {
    await t.test(item.error, async () => {
      const { instance } = client([
        { status: 200, body: { ok: false, error: item.error }, headers: item.headers },
      ]);
      await expectSlackError(
        instance.sendMessage({ tokens: TOKENS, channelId: 'C0GENERAL', text: 'hello' }),
        {
          slackError: item.slackError,
          code: item.code,
          retryAfterSeconds: item.retryAfterSeconds,
        }
      );
    });
  }
});

test('Slack transport and server failures keep the outcome safe', async (t) => {
  await t.test('HTTP 429 becomes a rate limit with Retry-After', async () => {
    const { instance } = client([
      { status: 429, body: { ok: false, error: 'ratelimited' }, headers: { 'retry-after': '11' } },
    ]);
    await expectSlackError(
      instance.sendMessage({ tokens: TOKENS, channelId: 'C0GENERAL', text: 'hello' }),
      { slackError: 'ratelimited', code: 'rate_limited', retryAfterSeconds: 11 }
    );
  });

  await t.test('HTTP 500 during a send is uncertain', async () => {
    const { instance } = client([{ status: 500, body: {} }]);
    await expectSlackError(
      instance.sendMessage({ tokens: TOKENS, channelId: 'C0GENERAL', text: 'hello' }),
      { slackError: 'server_error', code: 'uncertain' }
    );
  });

  await t.test('HTTP 401 is a revoked credential', async () => {
    const { instance } = client([{ status: 401, body: {} }]);
    await expectSlackError(
      instance.sendMessage({ tokens: TOKENS, channelId: 'C0GENERAL', text: 'hello' }),
      { slackError: 'invalid_auth', code: 'revoked' }
    );
  });

  await t.test('a lost response is uncertain, never a definite failure', async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error('socket closed');
    };
    const instance = new SlackClient({
      authorizeUrl: 'https://slack.test/authorize',
      tokenUrl: 'https://slack.test/token',
      apiBaseUrl: 'https://slack.test/api',
      fetchImpl,
      timeoutMs: 1_000,
    });
    await assert.rejects(
      instance.sendMessage({ tokens: TOKENS, channelId: 'C0GENERAL', text: 'hello' }),
      (err: unknown) => err instanceof AdapterError && err.code === 'uncertain'
    );
  });
});

test('Slack revoke uses auth.revoke and surfaces a revoked token', async (t) => {
  await t.test('revoke calls the API with the bot token', async () => {
    const { instance, calls } = client([{ body: { ok: true, revoked: true } }]);
    await instance.revoke('xoxb-revoke-token');
    assert.equal(calls[0].url, 'https://slack.test/api/auth.revoke');
    assert.equal(
      (calls[0].init?.headers as Record<string, string>).authorization,
      'Bearer xoxb-revoke-token'
    );
  });

  await t.test('an already revoked token is reported as revoked', async () => {
    const { instance } = client([{ body: { ok: false, error: 'token_revoked' } }]);
    await expectSlackError(instance.revoke('xoxb-old'), {
      slackError: 'token_revoked',
      code: 'revoked',
    });
  });
});
