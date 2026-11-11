import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import {
  AdapterError,
  DEFAULT_MASTODON_LIMIT,
  MASTODON_SCOPE_STRING,
  MastodonClient,
  MockMastodonClient,
  normalizeMastodonInstanceUrl,
  type FetchLike,
  type LookupFn,
} from '../src/posting/adapters/index';

const code = (err: unknown) => (err instanceof AdapterError ? err.code : 'unexpected');

// Every call is screened through DNS before it leaves the process; tests pin a
// public address so the suite never performs a real lookup.
const publicLookup: LookupFn = async () => [{ address: '93.184.216.34', family: 4 }];

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

function formBody(init?: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init?.body || ''));
}

const INSTANCE = 'https://mastodon.test';
const REDIRECT = 'https://crewlink.test/api/platforms/mastodon/callback';

test('Mastodon instance URLs are normalized and unsafe hosts are rejected', async (t) => {
  await t.test('accepts bare and full HTTPS origins', () => {
    assert.equal(normalizeMastodonInstanceUrl('mastodon.test'), 'https://mastodon.test');
    assert.equal(normalizeMastodonInstanceUrl('https://mastodon.test'), 'https://mastodon.test');
    assert.equal(normalizeMastodonInstanceUrl('https://Mastodon.Test/'), 'https://mastodon.test');
    assert.equal(
      normalizeMastodonInstanceUrl('https://social.example.co.uk'),
      'https://social.example.co.uk'
    );
  });

  await t.test('rejects non-HTTPS, credentials, paths and local names', () => {
    const rejected = [
      '',
      'http://mastodon.test',
      'ftp://mastodon.test',
      'https://user:secret@mastodon.test',
      'https://mastodon.test/about',
      'https://mastodon.test?query=1',
      'https://mastodon.test#fragment',
      'https://localhost',
      'https://app.localhost',
      'https://mastodon.local',
      'https://service.internal',
      'https://mastodon',
      'https://[::1]',
      'https://8.8.8.8',
      'https://127.0.0.1',
      'https://10.0.0.5',
      'https://172.16.0.9',
      'https://192.168.1.4',
      'https://169.254.1.1',
      'https://0.0.0.0',
      'https://224.0.0.1',
    ];
    for (const value of rejected) {
      assert.throws(
        () => normalizeMastodonInstanceUrl(value),
        (err) => code(err) === 'invalid_input',
        `expected rejection for ${value || '(empty)'}`
      );
    }
  });
});

test('Mastodon app registration requests only account identity and status publishing', async () => {
  const { fetchImpl, calls } = fakeFetch(() => ({
    body: {
      client_id: 'client-id-value',
      client_secret: 'client-secret-value',
      redirect_uri: REDIRECT,
    },
  }));
  const client = new MastodonClient({ fetchImpl, lookup: publicLookup });

  const app = await client.registerApp(INSTANCE, REDIRECT);

  assert.equal(app.clientId, 'client-id-value');
  assert.equal(app.clientSecret, 'client-secret-value');
  assert.equal(app.redirectUri, REDIRECT);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${INSTANCE}/api/v1/apps`);
  assert.equal(calls[0].init?.method, 'POST');
  const form = formBody(calls[0].init);
  assert.equal(form.get('client_name'), 'Crewlink');
  assert.equal(form.get('redirect_uris'), REDIRECT);
  assert.equal(form.get('scopes'), MASTODON_SCOPE_STRING);
  assert.equal(MASTODON_SCOPE_STRING, 'read:accounts write:statuses');
});

test('Mastodon app registration maps instance errors', async (t) => {
  await t.test('a rejection is invalid_input', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 422, body: {} }));
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    await assert.rejects(
      () => client.registerApp(INSTANCE, REDIRECT),
      (err) => code(err) === 'invalid_input'
    );
  });

  await t.test('a server error is instance_error', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 500, body: {} }));
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    await assert.rejects(
      () => client.registerApp(INSTANCE, REDIRECT),
      (err) => code(err) === 'instance_error'
    );
  });
});

test('Mastodon authorization URL carries the minimal scopes and state', () => {
  const client = new MastodonClient({
    fetchImpl: async () => new Response('{}'),
    lookup: publicLookup,
  });
  const url = new URL(
    client.authorizationUrl({
      instanceUrl: 'mastodon.test',
      clientId: 'client-id-value',
      redirectUri: REDIRECT,
      state: 'state-value',
    })
  );

  assert.equal(url.origin, INSTANCE);
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), 'client-id-value');
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(url.searchParams.get('scope'), MASTODON_SCOPE_STRING);
  assert.equal(url.searchParams.get('state'), 'state-value');
});

test('Mastodon authorization code exchange and account verification', async (t) => {
  await t.test('exchangeCode posts the code and client secret', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      body: { access_token: 'access-token-value', scope: 'read:accounts write:statuses' },
    }));
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    const exchanged = await client.exchangeCode({
      instanceUrl: INSTANCE,
      clientId: 'client-id-value',
      clientSecret: 'client-secret-value',
      code: 'authorization-code',
      redirectUri: REDIRECT,
    });

    assert.equal(exchanged.accessToken, 'access-token-value');
    assert.deepEqual(exchanged.scopes, ['read:accounts', 'write:statuses']);

    assert.equal(calls[0].url, `${INSTANCE}/oauth/token`);
    const form = formBody(calls[0].init);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(form.get('code'), 'authorization-code');
    assert.equal(form.get('client_id'), 'client-id-value');
    assert.equal(form.get('client_secret'), 'client-secret-value');
    assert.equal(form.get('redirect_uri'), REDIRECT);
  });

  await t.test('a rejected code is auth_failed', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    await assert.rejects(
      () =>
        client.exchangeCode({
          instanceUrl: INSTANCE,
          clientId: 'client-id-value',
          clientSecret: 'client-secret-value',
          code: 'bad-code',
          redirectUri: REDIRECT,
        }),
      (err) => code(err) === 'auth_failed'
    );
  });

  await t.test('verifyAccount returns the instance-scoped identity', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      body: { id: '42', acct: 'alice@mastodon.test', username: 'alice' },
    }));
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    const account = await client.verifyAccount(INSTANCE, 'access-token-value');

    assert.deepEqual(account, {
      externalAccountId: '42',
      externalAccountName: 'alice@mastodon.test',
      instanceUrl: INSTANCE,
      instanceName: 'mastodon.test',
    });
    assert.equal(calls[0].url, `${INSTANCE}/api/v1/accounts/verify_credentials`);
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer access-token-value');
  });

  await t.test('a revoked token is reported as revoked', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 401, body: {} }));
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    await assert.rejects(
      () => client.verifyAccount(INSTANCE, 'access-token-value'),
      (err) => code(err) === 'revoked'
    );
  });
});

test('Mastodon reads the connected instance character limit and falls back to v1', async (t) => {
  await t.test('v2 configuration wins and is cached per instance', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      body: { configuration: { statuses: { max_characters: 321 } } },
    }));
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    assert.equal(await client.getStatusCharacterLimit(INSTANCE), 321);
    assert.equal(await client.getStatusCharacterLimit(INSTANCE), 321);
    assert.equal(calls.filter((call) => call.url.endsWith('/api/v2/instance')).length, 1);
  });

  await t.test('older instances expose the limit through v1', async () => {
    const { fetchImpl, calls } = fakeFetch((url) => {
      if (url.endsWith('/api/v2/instance')) return { status: 404, body: {} };
      return { body: { max_toot_chars: 250 } };
    });
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    assert.equal(await client.getStatusCharacterLimit(INSTANCE), 250);
    assert.equal(calls.filter((call) => call.url.endsWith('/api/v1/instance')).length, 1);
  });

  await t.test('an unreachable instance reports no limit', async () => {
    const { fetchImpl } = fakeFetch(() => ({ throws: true }));
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    assert.equal(await client.getStatusCharacterLimit(INSTANCE), null);
  });
});

test('Mastodon sendStatus uses the instance limit and an idempotency key', async (t) => {
  await t.test('publishes within the instance limit', async () => {
    const { fetchImpl, calls } = fakeFetch((url) => {
      if (url.endsWith('/api/v2/instance')) {
        return { body: { configuration: { statuses: { max_characters: 120 } } } };
      }
      return { body: { id: '900', url: 'https://mastodon.test/@alice/900' } };
    });
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    const result = await client.sendStatus({
      instanceUrl: INSTANCE,
      accessToken: 'access-token-value',
      text: 'x'.repeat(120),
      idempotencyKey: 'pub_123',
    });

    assert.equal(result.externalId, '900');
    assert.equal(result.externalUrl, 'https://mastodon.test/@alice/900');

    const statusCall = calls.find((call) => call.url.endsWith('/api/v1/statuses'));
    assert.ok(statusCall);
    const headers = statusCall.init?.headers as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer access-token-value');
    assert.equal(headers['idempotency-key'], 'pub_123');
  });

  await t.test('rejects text over the instance limit without posting', async () => {
    const { fetchImpl, calls } = fakeFetch((url) => {
      if (url.endsWith('/api/v2/instance')) {
        return { body: { configuration: { statuses: { max_characters: 120 } } } };
      }
      return { body: { id: '900' } };
    });
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    await assert.rejects(
      () =>
        client.sendStatus({
          instanceUrl: INSTANCE,
          accessToken: 'access-token-value',
          text: 'x'.repeat(121),
        }),
      (err) => code(err) === 'validation_error'
    );
    assert.equal(calls.filter((call) => call.url.endsWith('/api/v1/statuses')).length, 0);
  });

  await t.test('falls back to the documented default when no limit is reported', async () => {
    const { fetchImpl } = fakeFetch((url) => {
      if (url.endsWith('/api/v1/statuses')) return { body: { id: '901' } };
      return { status: 404, body: {} };
    });
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    await assert.rejects(
      () =>
        client.sendStatus({
          instanceUrl: INSTANCE,
          accessToken: 'access-token-value',
          text: 'x'.repeat(DEFAULT_MASTODON_LIMIT + 1),
        }),
      (err) => code(err) === 'validation_error'
    );
  });
});

test('Mastodon sendStatus maps rate limits, server errors and ambiguous outcomes', async (t) => {
  const limitReply = () => ({ body: { configuration: { statuses: { max_characters: 500 } } } });

  await t.test('429 carries the instance retry hint', async () => {
    const { fetchImpl } = fakeFetch((url) => {
      if (url.endsWith('/api/v2/instance')) return limitReply();
      return { status: 429, headers: { 'retry-after': '12' }, body: {} };
    });
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    await assert.rejects(
      () => client.sendStatus({ instanceUrl: INSTANCE, accessToken: 't', text: 'hello' }),
      (err) => code(err) === 'rate_limited' && (err as AdapterError).retryAfterSeconds === 12
    );
  });

  await t.test('400 means the instance rejected the status text', async () => {
    const { fetchImpl } = fakeFetch((url) => {
      if (url.endsWith('/api/v2/instance')) return limitReply();
      return { status: 422, body: {} };
    });
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    await assert.rejects(
      () => client.sendStatus({ instanceUrl: INSTANCE, accessToken: 't', text: 'hello' }),
      (err) => code(err) === 'validation_error'
    );
  });

  await t.test('500 is an instance error', async () => {
    const { fetchImpl } = fakeFetch((url) => {
      if (url.endsWith('/api/v2/instance')) return limitReply();
      return { status: 500, body: {} };
    });
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    await assert.rejects(
      () => client.sendStatus({ instanceUrl: INSTANCE, accessToken: 't', text: 'hello' }),
      (err) => code(err) === 'instance_error'
    );
  });

  await t.test('a network failure is uncertain', async () => {
    const { fetchImpl } = fakeFetch((url) => {
      if (url.endsWith('/api/v2/instance')) return limitReply();
      return { throws: true };
    });
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    await assert.rejects(
      () => client.sendStatus({ instanceUrl: INSTANCE, accessToken: 't', text: 'hello' }),
      (err) => code(err) === 'uncertain'
    );
  });

  await t.test('a response without an id is uncertain', async () => {
    const { fetchImpl } = fakeFetch((url) => {
      if (url.endsWith('/api/v2/instance')) return limitReply();
      return { body: { url: 'https://mastodon.test/@alice/1' } };
    });
    const client = new MastodonClient({ fetchImpl, lookup: publicLookup });
    await assert.rejects(
      () => client.sendStatus({ instanceUrl: INSTANCE, accessToken: 't', text: 'hello' }),
      (err) => code(err) === 'uncertain'
    );
  });
});

test('Mastodon mock client is deterministic and never contacts the network', async (t) => {
  const client = new MockMastodonClient();
  const instance = 'https://mastodon.test';

  await t.test('registers a mock app and builds an authorization URL', async () => {
    const app = await client.registerApp(instance, REDIRECT);
    assert.equal(app.clientId, 'mock-mastodon-client');
    assert.equal(app.clientSecret, 'mock-mastodon-secret');
    const url = new URL(
      client.authorizationUrl({
        instanceUrl: instance,
        clientId: app.clientId,
        redirectUri: app.redirectUri,
        state: 'state-value',
      })
    );
    assert.equal(url.searchParams.get('state'), 'state-value');
  });

  await t.test('rejects a denied code', async () => {
    await assert.rejects(
      () =>
        client.exchangeCode({
          instanceUrl: instance,
          clientId: 'c',
          clientSecret: 's',
          code: 'denied',
          redirectUri: REDIRECT,
        }),
      (err) => code(err) === 'auth_failed'
    );
  });

  await t.test('verifies a mock account and rejects a revoked token', async () => {
    const account = await client.verifyAccount(instance, 'mock-mastodon-access-code');
    assert.deepEqual(account, {
      externalAccountId: 'mock-mastodon-account',
      externalAccountName: 'mockuser',
      instanceUrl: instance,
      instanceName: 'mastodon.test',
    });
    await assert.rejects(
      () => client.verifyAccount(instance, 'mock-mastodon-access-revoked'),
      (err) => code(err) === 'revoked'
    );
  });

  await t.test('publishes, enforces the default limit and handles failure markers', async () => {
    const result = await client.sendStatus({
      instanceUrl: instance,
      accessToken: 'mock-mastodon-access-code',
      text: 'hello',
    });
    assert.ok(result.externalId.startsWith('mock-mastodon-'));

    await assert.rejects(
      () =>
        client.sendStatus({
          instanceUrl: instance,
          accessToken: 'mock-mastodon-access-code',
          text: 'x'.repeat(DEFAULT_MASTODON_LIMIT + 1),
        }),
      (err) => code(err) === 'validation_error'
    );

    for (const [marker, expected] of [
      ['[mock-uncertain]', 'uncertain'],
      ['[mock-rate-limit]', 'rate_limited'],
      ['[mock-fail]', 'instance_error'],
    ]) {
      await assert.rejects(
        () =>
          client.sendStatus({
            instanceUrl: instance,
            accessToken: 'mock-mastodon-access-code',
            text: marker,
          }),
        (err) => code(err) === expected
      );
    }
  });
});
