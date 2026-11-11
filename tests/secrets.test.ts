import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import {
  EnvSecretStore,
  GcpSecretStore,
  SecretStoreError,
  normalizeSecretName,
  getSecretStore,
  resetSecretStoreForTests,
  type SecretManagerClientLike,
} from '../src/posting/secrets';

test('secret names', async (t) => {
  await t.test('accepts env-style names only', () => {
    assert.equal(normalizeSecretName('TELEGRAM_BOT_TOKEN'), 'TELEGRAM_BOT_TOKEN');
    assert.throws(() => normalizeSecretName('projects/p/secrets/x'), SecretStoreError);
    assert.throws(() => normalizeSecretName('has-dash'), SecretStoreError);
    assert.throws(() => normalizeSecretName(''), SecretStoreError);
  });
});

test('EnvSecretStore', async (t) => {
  await t.test('reads values from the environment', async () => {
    const store = new EnvSecretStore({ GITHUB_CLIENT_SECRET: 'shh' });
    assert.equal(await store.get('GITHUB_CLIENT_SECRET'), 'shh');
    assert.equal(store.provider, 'env');
  });

  await t.test('returns null for missing or empty values', async () => {
    const store = new EnvSecretStore({ EMPTY_SECRET: '' });
    assert.equal(await store.get('MISSING_SECRET'), null);
    assert.equal(await store.get('EMPTY_SECRET'), null);
  });
});

test('GcpSecretStore', async (t) => {
  function fakeClient(overrides: Partial<SecretManagerClientLike> = {}) {
    const calls: string[] = [];
    const client: SecretManagerClientLike = {
      async accessSecretVersion(request) {
        calls.push(request.name);
        return [{ payload: { data: Buffer.from(`value-for:${request.name}`) } }];
      },
      ...overrides,
    };
    return { client, calls };
  }

  await t.test('normalises the secret name into the configured prefix and latest version', async () => {
    const { client, calls } = fakeClient();
    const store = new GcpSecretStore({ project: 'demo-project', prefix: 'crewlink-', client });

    const value = await store.get('TELEGRAM_BOT_TOKEN');
    assert.equal(value, 'value-for:projects/demo-project/secrets/crewlink-telegram-bot-token/versions/latest');
    assert.deepEqual(calls, [
      'projects/demo-project/secrets/crewlink-telegram-bot-token/versions/latest',
    ]);
    assert.equal(store.provider, 'gcp');
  });

  await t.test('caches values until the TTL expires', async () => {
    const { client, calls } = fakeClient();
    let now = 1_000;
    const store = new GcpSecretStore({
      project: 'demo-project',
      prefix: 'crewlink-',
      client,
      cacheTtlMs: 5_000,
      now: () => now,
    });

    await store.get('X_CLIENT_SECRET');
    await store.get('X_CLIENT_SECRET');
    assert.equal(calls.length, 1);

    now += 6_000;
    await store.get('X_CLIENT_SECRET');
    assert.equal(calls.length, 2);
  });

  await t.test('decodes string payloads', async () => {
    const { client } = fakeClient({
      async accessSecretVersion() {
        return [{ payload: { data: 'plain-string-secret' } }];
      },
    });
    const store = new GcpSecretStore({ project: 'demo-project', prefix: 'crewlink-', client });
    assert.equal(await store.get('SLACK_CLIENT_SECRET'), 'plain-string-secret');
  });

  await t.test('fails closed and never falls back to environment variables', async () => {
    const { client } = fakeClient({
      async accessSecretVersion() {
        throw new Error('permission denied');
      },
    });
    process.env.X_CLIENT_SECRET = 'env-value-must-not-be-used';
    try {
      const store = new GcpSecretStore({ project: 'demo-project', prefix: 'crewlink-', client });
      await assert.rejects(() => store.get('X_CLIENT_SECRET'), SecretStoreError);
    } finally {
      delete process.env.X_CLIENT_SECRET;
    }
  });

  await t.test('requires a Google Cloud project', async () => {
    const { client } = fakeClient();
    const store = new GcpSecretStore({ project: '', prefix: 'crewlink-', client });
    await assert.rejects(() => store.get('SLACK_CLIENT_SECRET'), SecretStoreError);
  });
});

test('secret store factory', async (t) => {
  await t.test('uses the env provider in tests', () => {
    resetSecretStoreForTests();
    assert.equal(getSecretStore().provider, 'env');
    resetSecretStoreForTests();
  });
});
