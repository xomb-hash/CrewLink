import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import './setup';

const migrationsDir = path.resolve(process.cwd(), 'prisma', 'migrations');

function migrationDirs(): string[] {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

test('migration chain has a baseline first and M9 hardening last', () => {
  const dirs = migrationDirs();
  assert.deepEqual(dirs, [
    '20261101000000_baseline_m1_m3',
    '20261111000000_m4_x_publishing',
    '20261112000000_m5_reddit',
    '20261113000000_m8_ai_workspace',
    '20261114000000_m9_analytics',
    '20261115000000_m9_production_hardening',
  ]);
  assert.ok(dirs[0].includes('baseline'));
  assert.ok(dirs[dirs.length - 1].includes('hardening'));
});

test('baseline creates the M1–M3 core and does not skip ahead to analytics', () => {
  const sql = fs.readFileSync(
    path.join(migrationsDir, '20261101000000_baseline_m1_m3', 'migration.sql'),
    'utf8'
  );
  for (const table of ['users', 'sessions', 'projects', 'drafts', 'applicants', 'platform_connections', 'publications']) {
    assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.equal(sql.includes('analytics_posts'), false);
  assert.equal(sql.includes('ai_campaigns'), false);
  assert.match(sql, /platform_connections_oauthStateHash_key/);
});

test('M9 migrations are additive and do not rewrite or delete data', () => {
  for (const dir of [
    '20261114000000_m9_analytics',
    '20261115000000_m9_production_hardening',
  ]) {
    const sql = fs.readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8');
    assert.equal(/\bDROP\s+(TABLE|COLUMN|CONSTRAINT)\b/i.test(sql), false);
    assert.equal(/\bDELETE\s+FROM\b/i.test(sql), false);
    assert.equal(/\bTRUNCATE\b/i.test(sql), false);
    assert.equal(/\bUPDATE\s+"[a-z_]+"\s+SET\b/i.test(sql), false);
  }
  const m9 = fs.readFileSync(
    path.join(migrationsDir, '20261114000000_m9_analytics', 'migration.sql'),
    'utf8'
  );
  assert.match(m9, /CREATE TABLE IF NOT EXISTS "analytics_posts"/);
  assert.match(m9, /20261114000000 is intentionally later/);
  const hardening = fs.readFileSync(
    path.join(migrationsDir, '20261115000000_m9_production_hardening', 'migration.sql'),
    'utf8'
  );
  assert.match(hardening, /CREATE TABLE IF NOT EXISTS "analytics_sync_locks"/);
  assert.match(hardening, /analytics_sync_locks_projectId_fkey/);
});

test('production environment example has no real secrets and documents new flags', () => {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf8');
  for (const key of [
    'ANALYTICS_SYNC_LEASE_MS',
    'ANALYTICS_SCHEDULER_TOKEN',
    'ANALYTICS_MAX_POSTS_PER_SYNC',
    'LINKEDIN_ANALYTICS_ENABLED',
  ]) {
    assert.match(env, new RegExp(`^${key}=`, 'm'));
  }
  assert.match(env, /Production startup REQUIRES/);
  assert.equal(/sk-[A-Za-z0-9]{20,}/.test(env), false);
  // The example database URL is a local placeholder, not a deployable credential.
  assert.match(env, /DATABASE_URL=postgresql:\/\/postgres:password@localhost/);
});
