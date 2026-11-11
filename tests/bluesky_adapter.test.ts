import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import {
  AdapterError,
  BlueskyClient,
  MockBlueskyClient,
  resetMockBlueskyState,
  resetBlueskyRefreshStateForTests,
  type FetchLike,
} from '../src/posting/adapters/index';

const code = (err: unknown) => (err instanceof AdapterError ? err.code : 'unexpected');

type Reply = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  throws?: boolean;
};

function fakeFetch(handler: (url: string, init?: RequestInit) => Reply) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const reply = handler(url, init);
    if (reply.throws) throw new Error('network down');
    return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json', ...(reply.headers || {}) },
    });
  };
  return { fetchImpl, calls };
}

function jwt(expSeconds: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `header.${payload}.signature`;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 60;

const sessionBody = (overrides: Record<string, unknown> = {}) => ({
  accessJwt: jwt(future()),
  refreshJwt: 'refresh-jwt-value',
  did: 'did:plc:creator',
  handle: 'creator.test',
  ...overrides,
});

function bodyText(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
}

function headerValue(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.[name];
}

test('Bluesky createSession signs in with an app password and parses the session', async () => {
  // Pin the JWT once: recomputing it later can cross a one-second expiry boundary.
  const accessJwt = jwt(future());
  const { fetchImpl, calls } = fakeFetch(() => ({ body: sessionBody({ accessJwt }) }));
  const client = new BlueskyClient({ fetchImpl, serviceUrl: 'https://bsky.test' });

  const session = await client.createSession('@creator.test', 'app-password-value');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://bsky.test/xrpc/com.atproto.server.createSession');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(bodyText(calls[0].init), {
    identifier: '@creator.test',
    password: 'app-password-value',
  });

  assert.equal(session.account.externalAccountId, 'did:plc:creator');
  assert.equal(session.account.externalAccountName, 'creator.test');
  assert.equal(session.tokens.accessToken, accessJwt);
  assert.equal(session.tokens.refreshToken, 'refresh-jwt-value');
  assert.ok(session.tokens.tokenExpiresAt);
  assert.ok(new Date(session.tokens.tokenExpiresAt!).getTime() > Date.now());
});

test('Bluesky createSession maps rejected credentials and incomplete sessions', async (t) => {
  await t.test('invalid credentials become auth_failed', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 401,
      body: { error: 'AuthenticationRequired' },
    }));
    const client = new BlueskyClient({ fetchImpl });
    await assert.rejects(
      () => client.createSession('creator.test', 'wrong'),
      (err) => code(err) === 'auth_failed'
    );
  });

  await t.test('server errors become instance_error', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 500, body: { error: 'Internal' } }));
    const client = new BlueskyClient({ fetchImpl });
    await assert.rejects(
      () => client.createSession('creator.test', 'app-password'),
      (err) => code(err) === 'instance_error'
    );
  });

  await t.test('empty input is rejected without a request', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: sessionBody() }));
    const client = new BlueskyClient({ fetchImpl });
    await assert.rejects(
      () => client.createSession('', ''),
      (err) => code(err) === 'invalid_input'
    );
    assert.equal(calls.length, 0);
  });

  await t.test('a session without a DID is incomplete', async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: sessionBody({ did: '' }) }));
    const client = new BlueskyClient({ fetchImpl });
    await assert.rejects(
      () => client.createSession('creator.test', 'app-password'),
      (err) => code(err) === 'instance_error'
    );
  });
});

test('Bluesky getSession and refreshSession map revoked and incomplete sessions', async (t) => {
  await t.test('getSession returns the verified account', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      body: { did: 'did:plc:creator', handle: '@creator.test' },
    }));
    const client = new BlueskyClient({ fetchImpl });
    const account = await client.getSession('access-token-value');
    assert.equal(account.externalAccountId, 'did:plc:creator');
    assert.equal(account.externalAccountName, 'creator.test');
    assert.equal(calls[0].url.endsWith('/com.atproto.server.getSession'), true);
    assert.equal(headerValue(calls[0].init, 'authorization'), 'Bearer access-token-value');
  });

  await t.test('getSession maps 401 to revoked', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 401, body: {} }));
    const client = new BlueskyClient({ fetchImpl });
    await assert.rejects(
      () => client.getSession('access-token-value'),
      (err) => code(err) === 'revoked'
    );
  });

  await t.test('refreshSession returns a fresh session', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: sessionBody() }));
    const client = new BlueskyClient({ fetchImpl });
    const session = await client.refreshSession('refresh-token-value');
    assert.equal(session.account.externalAccountName, 'creator.test');
    assert.equal(calls[0].url.endsWith('/com.atproto.server.refreshSession'), true);
    assert.equal(headerValue(calls[0].init, 'authorization'), 'Bearer refresh-token-value');
  });

  await t.test('refreshSession maps 401 to revoked', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 401, body: {} }));
    const client = new BlueskyClient({ fetchImpl });
    await assert.rejects(
      () => client.refreshSession('refresh-token-value'),
      (err) => code(err) === 'revoked'
    );
  });
});

test('Bluesky sendPost records a post and returns its URI', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({
    body: { uri: 'at://did:plc:creator/app.bsky.feed.post/abc123', cid: 'cid' },
  }));
  const client = new BlueskyClient({ fetchImpl, serviceUrl: 'https://bsky.test' });

  const result = await client.sendPost({
    tokens: { accessToken: 'access-token-value' },
    account: { externalAccountId: 'did:plc:creator', externalAccountName: 'creator.test' },
    text: 'Join the crew',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://bsky.test/xrpc/com.atproto.repo.createRecord');
  assert.equal(headerValue(calls[0].init, 'authorization'), 'Bearer access-token-value');

  const body = bodyText(calls[0].init) as {
    repo: string;
    collection: string;
    record: Record<string, unknown>;
  };
  assert.equal(body.repo, 'did:plc:creator');
  assert.equal(body.collection, 'app.bsky.feed.post');
  assert.equal(body.record.$type, 'app.bsky.feed.post');
  assert.equal(body.record.text, 'Join the crew');

  assert.equal(result.externalId, 'at://did:plc:creator/app.bsky.feed.post/abc123');
  assert.equal(
    result.externalUrl,
    'https://bsky.app/profile/creator.test/post/abc123'
  );
});

test('Bluesky sendPost enforces grapheme and byte limits before any request', async (t) => {
  const { fetchImpl, calls } = fakeFetch(() => ({ body: {} }));
  const client = new BlueskyClient({ fetchImpl });
  const account = { externalAccountId: 'did:plc:creator', externalAccountName: 'creator.test' };
  const tokens = { accessToken: 'access-token-value' };

  await t.test('empty text', async () => {
    await assert.rejects(
      () => client.sendPost({ tokens, account, text: '   ' }),
      (err) => code(err) === 'validation_error'
    );
  });

  await t.test('more than 300 grapheme clusters', async () => {
    await assert.rejects(
      () => client.sendPost({ tokens, account, text: 'a'.repeat(301) }),
      (err) => code(err) === 'validation_error'
    );
  });

  await t.test('more than 3000 bytes even when graphemes fit', async () => {
    const cluster = 'a' + '\u0301'.repeat(200);
    const heavy = cluster.repeat(8);
    assert.ok(Buffer.byteLength(heavy, 'utf8') > 3000);
    await assert.rejects(
      () => client.sendPost({ tokens, account, text: heavy }),
      (err) => code(err) === 'validation_error'
    );
  });

  assert.equal(calls.length, 0);
});

test('Bluesky sendPost maps rate limits, validation errors and revoked tokens', async (t) => {
  const account = { externalAccountId: 'did:plc:creator', externalAccountName: 'creator.test' };
  const tokens = { accessToken: 'access-token-value' };

  await t.test('429 carries a retry hint', async () => {
    const reset = Math.ceil(Date.now() / 1000) + 45;
    const { fetchImpl } = fakeFetch(() => ({
      status: 429,
      headers: { 'ratelimit-reset': String(reset) },
      body: {},
    }));
    const client = new BlueskyClient({ fetchImpl });
    await assert.rejects(
      () => client.sendPost({ tokens, account, text: 'hello' }),
      (err) => code(err) === 'rate_limited' && (err as AdapterError).retryAfterSeconds! >= 30
    );
  });

  await t.test('400 names the text as rejected', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 400, body: { error: 'InvalidRequest' } }));
    const client = new BlueskyClient({ fetchImpl });
    await assert.rejects(
      () => client.sendPost({ tokens, account, text: 'hello' }),
      (err) => code(err) === 'validation_error'
    );
  });

  await t.test('401 without an expiry marker means revoked', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 401,
      body: { error: 'AuthRequired' },
    }));
    const client = new BlueskyClient({ fetchImpl });
    await assert.rejects(
      () => client.sendPost({ tokens, account, text: 'hello' }),
      (err) => code(err) === 'revoked'
    );
  });

  await t.test('a network failure is uncertain, never retried', async () => {
    const { fetchImpl } = fakeFetch(() => ({ throws: true }));
    const client = new BlueskyClient({ fetchImpl });
    await assert.rejects(
      () => client.sendPost({ tokens, account, text: 'hello' }),
      (err) => code(err) === 'uncertain'
    );
  });
});

test('Bluesky refreshes an expiring session before sending', async () => {
  const { fetchImpl, calls } = fakeFetch((url) => {
    if (url.endsWith('/com.atproto.server.refreshSession')) {
      return {
        body: {
          accessJwt: 'new-access-token',
          refreshJwt: 'new-refresh-token',
          did: 'did:plc:creator',
          handle: 'creator.test',
        },
      };
    }
    return { body: { uri: 'at://did:plc:creator/app.bsky.feed.post/one' } };
  });
  const client = new BlueskyClient({ fetchImpl });

  const result = await client.sendPost({
    tokens: {
      accessToken: 'expired-access-token',
      refreshToken: 'old-refresh-token',
      tokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    },
    account: { externalAccountId: 'did:plc:creator', externalAccountName: 'creator.test' },
    text: 'hello',
  });

  assert.equal(calls[0].url.endsWith('/com.atproto.server.refreshSession'), true);
  const postCall = calls.find((call) => call.url.endsWith('/com.atproto.repo.createRecord'));
  assert.equal(headerValue(postCall?.init, 'authorization'), 'Bearer new-access-token');
  assert.equal(result.tokens?.accessToken, 'new-access-token');
  assert.equal(result.tokens?.refreshToken, 'new-refresh-token');
});

test('Bluesky retries once after an ExpiredToken response', async () => {
  let postAttempts = 0;
  const { fetchImpl, calls } = fakeFetch((url) => {
    if (url.endsWith('/com.atproto.server.refreshSession')) {
      return {
        body: {
          accessJwt: 'fresh-access-token',
          refreshJwt: 'fresh-refresh-token',
          did: 'did:plc:creator',
          handle: 'creator.test',
        },
      };
    }
    postAttempts += 1;
    if (postAttempts === 1) return { status: 401, body: { error: 'ExpiredToken' } };
    return { body: { uri: 'at://did:plc:creator/app.bsky.feed.post/two' } };
  });
  const client = new BlueskyClient({ fetchImpl });

  const result = await client.sendPost({
    tokens: { accessToken: 'stale-access-token', refreshToken: 'refresh-token' },
    account: { externalAccountId: 'did:plc:creator', externalAccountName: 'creator.test' },
    text: 'hello',
  });

  assert.equal(postAttempts, 2);
  assert.ok(calls.some((call) => call.url.endsWith('/com.atproto.server.refreshSession')));
  const posts = calls.filter((call) => call.url.endsWith('/com.atproto.repo.createRecord'));
  assert.equal(headerValue(posts[0].init, 'authorization'), 'Bearer stale-access-token');
  assert.equal(headerValue(posts[1].init, 'authorization'), 'Bearer fresh-access-token');
  assert.equal(result.externalId, 'at://did:plc:creator/app.bsky.feed.post/two');
  assert.equal(result.tokens?.accessToken, 'fresh-access-token');
});

test('Bluesky refuses to retry an expired session without a refresh token', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({ status: 401, body: { error: 'ExpiredToken' } }));
  const client = new BlueskyClient({ fetchImpl });
  await assert.rejects(
    () =>
      client.sendPost({
        tokens: { accessToken: 'stale-access-token' },
        account: { externalAccountId: 'did:plc:creator', externalAccountName: 'creator.test' },
        text: 'hello',
      }),
    (err) => code(err) === 'token_expired'
  );
  assert.equal(
    calls.filter((call) => call.url.endsWith('/com.atproto.repo.createRecord')).length,
    1
  );
});

// --- Concurrent refresh safety ---
function jsonReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('Concurrent refreshes share one rotation and reuse it briefly', async () => {
  resetBlueskyRefreshStateForTests();
  let refreshCalls = 0;
  const fetchImpl: FetchLike = async (url) => {
    if (url.endsWith('/com.atproto.server.refreshSession')) {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return jsonReply({
        accessJwt: 'shared-access-token',
        refreshJwt: 'shared-refresh-token',
        did: 'did:plc:creator',
        handle: 'creator.test',
      });
    }
    throw new Error('unexpected request');
  };
  const client = new BlueskyClient({ fetchImpl });

  const [first, second] = await Promise.all([
    client.refreshSession('old-refresh-token', 'pcn_same'),
    client.refreshSession('old-refresh-token', 'pcn_same'),
  ]);
  assert.equal(refreshCalls, 1);
  assert.equal(first.tokens.accessToken, 'shared-access-token');
  assert.equal(second.tokens.accessToken, 'shared-access-token');

  // A second caller within the reuse window does not rotate the session again.
  const third = await client.refreshSession('old-refresh-token', 'pcn_same');
  assert.equal(refreshCalls, 1);
  assert.equal(third.tokens.refreshToken, 'shared-refresh-token');
});

test('A changed refresh token never reuses a cached session for the connection', async () => {
  resetBlueskyRefreshStateForTests();
  let refreshCalls = 0;
  const fetchImpl: FetchLike = async (url) => {
    if (url.endsWith('/com.atproto.server.refreshSession')) {
      refreshCalls += 1;
      return jsonReply({
        accessJwt: `access-${refreshCalls}`,
        refreshJwt: `refresh-${refreshCalls}`,
        did: 'did:plc:creator',
        handle: 'creator.test',
      });
    }
    throw new Error('unexpected request');
  };
  const client = new BlueskyClient({ fetchImpl });

  await client.refreshSession('first-refresh-token', 'pcn_switch');
  // A rotated or replaced token must not hit the old connection cache entry.
  const second = await client.refreshSession('second-refresh-token', 'pcn_switch');
  assert.equal(refreshCalls, 2);
  assert.equal(second.tokens.accessToken, 'access-2');
});

test('A revoked refresh stops the send without attempting the post', async () => {
  resetBlueskyRefreshStateForTests();
  let postCalls = 0;
  const fetchImpl: FetchLike = async (url) => {
    if (url.endsWith('/com.atproto.server.refreshSession')) {
      return jsonReply({ error: 'InvalidToken' }, 401);
    }
    postCalls += 1;
    return jsonReply({ uri: 'at://did:plc:creator/app.bsky.feed.post/one' });
  };
  const client = new BlueskyClient({ fetchImpl });

  await assert.rejects(
    () =>
      client.sendPost({
        tokens: {
          accessToken: 'expired-access-token',
          refreshToken: 'revoked-refresh-token',
          tokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        },
        account: { externalAccountId: 'did:plc:creator', externalAccountName: 'creator.test' },
        text: 'hello',
      }),
    (err) => code(err) === 'revoked'
  );
  assert.equal(postCalls, 0);
});

test('A failed send after a refresh carries the rotated tokens', async () => {
  resetBlueskyRefreshStateForTests();
  const fetchImpl: FetchLike = async (url) => {
    if (url.endsWith('/com.atproto.server.refreshSession')) {
      return jsonReply({
        accessJwt: 'rotated-access-token',
        refreshJwt: 'rotated-refresh-token',
        did: 'did:plc:creator',
        handle: 'creator.test',
      });
    }
    return jsonReply({ error: 'InvalidRequest' }, 400);
  };
  const client = new BlueskyClient({ fetchImpl });

  await assert.rejects(
    () =>
      client.sendPost({
        tokens: {
          accessToken: 'expired-access-token',
          refreshToken: 'old-refresh-token',
          tokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        },
        account: { externalAccountId: 'did:plc:creator', externalAccountName: 'creator.test' },
        text: 'hello',
      }),
    (err) =>
      code(err) === 'validation_error' &&
      (err as AdapterError).tokens?.accessToken === 'rotated-access-token' &&
      (err as AdapterError).tokens?.refreshToken === 'rotated-refresh-token'
  );
});

test('An ambiguous send after a refresh still carries the rotated tokens', async () => {
  resetBlueskyRefreshStateForTests();
  const fetchImpl: FetchLike = async (url) => {
    if (url.endsWith('/com.atproto.server.refreshSession')) {
      return jsonReply({
        accessJwt: 'rotated-access-token',
        refreshJwt: 'rotated-refresh-token',
        did: 'did:plc:creator',
        handle: 'creator.test',
      });
    }
    throw new Error('network down');
  };
  const client = new BlueskyClient({ fetchImpl });

  await assert.rejects(
    () =>
      client.sendPost({
        tokens: {
          accessToken: 'expired-access-token',
          refreshToken: 'old-refresh-token',
          tokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        },
        account: { externalAccountId: 'did:plc:creator', externalAccountName: 'creator.test' },
        text: 'hello',
      }),
    (err) =>
      code(err) === 'uncertain' &&
      (err as AdapterError).tokens?.accessToken === 'rotated-access-token'
  );
});


test('Bluesky mock client is deterministic and never contacts the network', async (t) => {
  resetMockBlueskyState();
  const client = new MockBlueskyClient();

  await t.test('rejects an empty or explicitly wrong password', async () => {
    await assert.rejects(
      () => client.createSession('creator.test', 'wrong-password'),
      (err) => code(err) === 'auth_failed'
    );
  });

  await t.test('round-trips the handle through mock tokens', async () => {
    const session = await client.createSession('@creator.test', 'app-password');
    assert.equal(session.account.externalAccountName, 'creator.test');
    assert.equal(session.account.externalAccountId, 'did:plc:creatortest');

    const account = await client.getSession(session.tokens.accessToken);
    assert.deepEqual(account, session.account);

    const refreshed = await client.refreshSession(session.tokens.refreshToken!);
    assert.deepEqual(refreshed.account, session.account);
  });

  await t.test('revoked mock tokens are rejected', async () => {
    await assert.rejects(
      () => client.getSession('mock-bsky-access.revoked'),
      (err) => code(err) === 'revoked'
    );
    await assert.rejects(
      () => client.refreshSession('mock-bsky-refresh.revoked'),
      (err) => code(err) === 'revoked'
    );
  });

  await t.test('posts return a stable URI and failure markers', async () => {
    const result = await client.sendPost({
      tokens: { accessToken: 'mock-bsky-access.Y3JlYXRvci50ZXN0' },
      account: { externalAccountId: 'did:plc:creatortest', externalAccountName: 'creator.test' },
      text: 'hello',
    });
    assert.equal(result.externalId, 'at://did:plc:creatortest/app.bsky.feed.post/mock1');
    assert.equal(
      result.externalUrl,
      'https://bsky.app/profile/creator.test/post/mock1'
    );

    const account = { externalAccountId: 'did:plc:creatortest', externalAccountName: 'creator.test' };
    await assert.rejects(
      () => client.sendPost({ tokens: { accessToken: 'x' }, account, text: '[mock-uncertain]' }),
      (err) => code(err) === 'uncertain'
    );
    await assert.rejects(
      () => client.sendPost({ tokens: { accessToken: 'x' }, account, text: '[mock-rate-limit]' }),
      (err) => code(err) === 'rate_limited' && (err as AdapterError).retryAfterSeconds === 5
    );
    await assert.rejects(
      () => client.sendPost({ tokens: { accessToken: 'x' }, account, text: '[mock-fail]' }),
      (err) => code(err) === 'instance_error'
    );
  });
});
