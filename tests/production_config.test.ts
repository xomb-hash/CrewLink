import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import {
  ProductionConfigError,
  validateProductionConfig,
} from '../src/config/production';

const secret = (letter: string) => letter.repeat(40);

function base(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'production',
    APP_URL: 'https://crewlink.example',
    SESSION_SECRET: secret('s'),
    ENCRYPTION_SECRET_V1: secret('e'),
    DATABASE_URL: 'postgresql://user:pass@db.example:5432/crewlink',
    PUBLISHING_TRANSPORT: 'live',
    DISCORD_BOT_TOKEN: 'test-discord-bot-token',
    AI_PROVIDER: 'unconfigured',
    ...overrides,
  };
}

test('production config is skipped outside production and during build', () => {
  assert.deepEqual(validateProductionConfig({ NODE_ENV: 'development' }).warnings, []);
  assert.deepEqual(
    validateProductionConfig({
      NODE_ENV: 'production',
      NEXT_PHASE: 'phase-production-build',
    }).warnings,
    []
  );
});

test('a complete production configuration passes', () => {
  const result = validateProductionConfig(base());
  assert.deepEqual(result.warnings, []);
});

test('unsafe or missing critical values fail closed', async (t) => {
  await t.test('missing and insecure app URL', () => {
    assert.throws(
      () => validateProductionConfig(base({ APP_URL: '' })),
      (error) => error instanceof ProductionConfigError
    );
    assert.throws(
      () => validateProductionConfig(base({ APP_URL: 'http://crewlink.example' })),
      (error) => error instanceof ProductionConfigError
    );
    assert.throws(
      () => validateProductionConfig(base({ APP_URL: 'https://localhost:3100' })),
      (error) => error instanceof ProductionConfigError
    );
  });

  await t.test('default or short secrets are rejected without echoing them', () => {
    try {
      validateProductionConfig(
        base({
          SESSION_SECRET: 'crewlink-dev-secret-key-change-in-production-32chars',
        })
      );
      assert.fail('expected a configuration error');
    } catch (error) {
      assert.ok(error instanceof ProductionConfigError);
      assert.equal(error.message.includes('crewlink-dev-secret-key'), false);
    }
    assert.throws(
      () => validateProductionConfig(base({ ENCRYPTION_SECRET_V1: 'short' })),
      (error) => error instanceof ProductionConfigError
    );
  });

  await t.test('file-backed database and implicit transport are rejected', () => {
    assert.throws(
      () => validateProductionConfig(base({ DATABASE_URL: '' })),
      (error) => error instanceof ProductionConfigError
    );
    assert.throws(
      () => validateProductionConfig(base({ DATABASE_URL: 'file:./data/crewlink.json' })),
      (error) => error instanceof ProductionConfigError
    );
    assert.throws(
      () => validateProductionConfig(base({ PUBLISHING_TRANSPORT: undefined })),
      (error) => error instanceof ProductionConfigError
    );
    assert.throws(
      () => validateProductionConfig(base({ PUBLISHING_TRANSPORT: 'auto' })),
      (error) => error instanceof ProductionConfigError
    );
  });

  await t.test('gcp providers require their configuration', () => {
    assert.throws(
      () => validateProductionConfig(base({ CREDENTIAL_PROVIDER: 'gcp' })),
      (error) => error instanceof ProductionConfigError
    );
    assert.throws(
      () => validateProductionConfig(base({ SECRETS_PROVIDER: 'gcp' })),
      (error) => error instanceof ProductionConfigError
    );
  });

  await t.test('configured AI and research providers require keys', () => {
    assert.throws(
      () => validateProductionConfig(base({ AI_PROVIDER: 'openai' })),
      (error) => error instanceof ProductionConfigError
    );
    assert.throws(
      () => validateProductionConfig(base({ AI_PROVIDER: 'anthropic' })),
      (error) => error instanceof ProductionConfigError
    );
    assert.throws(
      () => validateProductionConfig(base({ AI_PROVIDER: 'gemini' })),
      (error) => error instanceof ProductionConfigError
    );
    assert.throws(
      () => validateProductionConfig(
        base({ AI_RESEARCH_PROVIDER: 'brave', AI_PROVIDER: 'mock' })
      ),
      (error) => error instanceof ProductionConfigError
    );
    assert.throws(
      () => validateProductionConfig(
        base({ AI_RESEARCH_PROVIDER: 'reddit', AI_PROVIDER: 'mock' })
      ),
      (error) => error instanceof ProductionConfigError
    );
  });

  await t.test('scheduler token and lease are validated', () => {
    assert.throws(
      () => validateProductionConfig(
        base({ ANALYTICS_SCHEDULER_TOKEN: 'too-short' })
      ),
      (error) => error instanceof ProductionConfigError
    );
    assert.throws(
      () => validateProductionConfig(
        base({
          ANALYTICS_SYNC_LEASE_MS: '20000',
          ANALYTICS_SYNC_TIMEOUT_MS: '20000',
        })
      ),
      (error) => error instanceof ProductionConfigError
    );
  });
});

test('explicit mock mode is allowed but warned about', () => {
  const result = validateProductionConfig(
    base({ PUBLISHING_TRANSPORT: 'mock', AI_PROVIDER: 'mock' })
  );
  assert.equal(result.warnings.length >= 2, true);
  assert.ok(result.warnings.some((line) => line.includes('PUBLISHING_TRANSPORT=mock')));
  assert.ok(result.warnings.some((line) => line.includes('AI_PROVIDER=mock')));
});

test('live transport with no platform credentials warns without inventing success', () => {
  const result = validateProductionConfig(
    base({ PUBLISHING_TRANSPORT: 'live', DISCORD_BOT_TOKEN: undefined })
  );
  assert.ok(result.warnings.some((line) => line.includes('no platform credentials')));
});
