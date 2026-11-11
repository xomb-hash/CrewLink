import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import './setup';
import { prisma } from '../src/lib/prisma';
import { storage } from '../src/lib/storage';
import type { StoredPlatformConnection } from '../src/types/index';

// These tests mock the Prisma delegates so the Prisma branch of every new
// Milestone 3 storage operation is exercised without a database. No connection
// is opened and no schema change is applied.

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
};

(process.env as Record<string, string | undefined>).NODE_ENV = 'development';
(process.env as Record<string, string | undefined>).DATABASE_URL =
  'postgresql://user:pass@localhost:5432/crewlink';

type PrismaMock = Record<string, unknown>;

function patchPrisma(mocks: PrismaMock): () => void {
  const restores: Array<() => void> = [];
  for (const [key, value] of Object.entries(mocks)) {
    const own = Object.getOwnPropertyDescriptor(prisma, key);
    Object.defineProperty(prisma, key, { value, configurable: true });
    restores.push(() => {
      if (own) Object.defineProperty(prisma, key, own);
      else delete (prisma as unknown as Record<string, unknown>)[key];
    });
  }
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

const connectionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'pcn_one',
  userId: '1',
  projectId: 'prj_one',
  platformId: 'mastodon',
  externalAccountId: '42',
  externalAccountName: 'alice',
  serverId: null,
  serverName: null,
  channelId: null,
  channelName: null,
  instanceUrl: 'https://mastodon.test',
  status: 'active',
  scopes: ['read:accounts', 'write:statuses'],
  tokenExpiresAt: null,
  accessTokenCiphertext: 'cipher-old',
  refreshTokenCiphertext: null,
  credentialProvider: 'local',
  keyRef: 'local:v1',
  oauthStateHash: null,
  oauthStateExpiresAt: null,
  pendingOAuthCiphertext: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
});

const input: StoredPlatformConnection = {
  id: 'pcn_one',
  userId: '1',
  projectId: 'prj_one',
  platformId: 'mastodon',
  externalAccountId: '42',
  externalAccountName: 'alice',
  instanceUrl: 'https://mastodon.test',
  status: 'active',
  scopes: ['read:accounts', 'write:statuses'],
  accessTokenCiphertext: 'cipher-old',
  credentialProvider: 'local',
  keyRef: 'local:v1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

test('Prisma OAuth state reads and atomic claims match the file-backed contract', async (t) => {
  await t.test('findPlatformConnectionByOAuthState maps the stored row', async () => {
    let where: unknown;
    const restore = patchPrisma({
      platformConnection: {
        async findUnique(args: { where: unknown }) {
          where = args.where;
          return connectionRow({ oauthStateHash: 'hash-value', status: 'pending' });
        },
      },
    });
    try {
      const found = await storage.findPlatformConnectionByOAuthState('hash-value');
      assert.deepEqual(where, { oauthStateHash: 'hash-value' });
      assert.equal(found?.id, 'pcn_one');
      assert.equal(found?.oauthStateHash, 'hash-value');
      assert.equal(found?.updatedAt, '2026-01-02T00:00:00.000Z');
    } finally {
      restore();
    }
  });

  await t.test('claimOAuthState consumes exactly one hash', async () => {
    let args: unknown;
    const restore = patchPrisma({
      platformConnection: {
        async updateMany(input: unknown) {
          args = input;
          return { count: 1 };
        },
      },
    });
    try {
      assert.equal(await storage.claimOAuthState('hash-value'), true);
      assert.deepEqual(args, {
        where: { oauthStateHash: 'hash-value' },
        data: {
          oauthStateHash: null,
          oauthStateExpiresAt: null,
          pendingOAuthCiphertext: null,
        },
      });
    } finally {
      restore();
    }

    const restoreLost = patchPrisma({
      platformConnection: { async updateMany() { return { count: 0 }; } },
    });
    try {
      assert.equal(await storage.claimOAuthState('hash-value'), false);
    } finally {
      restoreLost();
    }
  });

  await t.test('finishOAuthFailure only disconnects the consumed pending row', async () => {
    let args: unknown;
    const restore = patchPrisma({
      platformConnection: {
        async updateMany(input: unknown) {
          args = input;
          return { count: 1 };
        },
      },
    });
    try {
      assert.equal(await storage.finishOAuthFailure('pcn_one'), true);
      assert.deepEqual(args, {
        where: { id: 'pcn_one', status: 'pending', oauthStateHash: null },
        data: { status: 'disconnected' },
      });
    } finally {
      restore();
    }
  });
});

test('Prisma metadata and token updates never write the wrong fields', async (t) => {
  await t.test('account metadata updates exclude token columns', async () => {
    let args: { where: unknown; data: Record<string, unknown> } | undefined;
    const restore = patchPrisma({
      platformConnection: {
        async update(input: typeof args) {
          args = input;
          return connectionRow(input?.data);
        },
      },
    });
    try {
      const saved = await storage.updatePlatformConnectionAccount('pcn_one', {
        externalAccountId: '99',
        externalAccountName: 'bob',
        instanceUrl: 'https://social.example',
      });
      assert.deepEqual(args?.where, { id: 'pcn_one' });
      assert.deepEqual(args?.data, {
        externalAccountId: '99',
        externalAccountName: 'bob',
        instanceUrl: 'https://social.example',
      });
      assert.equal(saved?.externalAccountName, 'bob');
    } finally {
      restore();
    }
  });

  await t.test('a missing connection maps P2025 to null', async () => {
    const restore = patchPrisma({
      platformConnection: {
        async update() {
          throw Object.assign(new Error('not found'), { code: 'P2025' });
        },
      },
    });
    try {
      assert.equal(
        await storage.updatePlatformConnectionAccount('pcn_missing', {
          externalAccountId: '1',
          externalAccountName: 'nobody',
        }),
        null
      );
    } finally {
      restore();
    }
  });

  await t.test('token persistence is a compare-and-set on the active row', async () => {
    let where: unknown;
    let data: Record<string, unknown> | undefined;
    let findCalls = 0;
    const restore = patchPrisma({
      platformConnection: {
        async updateMany(args: { where: unknown; data: Record<string, unknown> }) {
          where = args.where;
          data = args.data;
          return { count: 1 };
        },
        async findUnique() {
          findCalls += 1;
          return connectionRow({ accessTokenCiphertext: 'cipher-new' });
        },
      },
    });
    try {
      const saved = await storage.updatePlatformConnectionTokens({
        id: 'pcn_one',
        expectedAccessTokenCiphertext: 'cipher-old',
        accessTokenCiphertext: 'cipher-new',
        refreshTokenCiphertext: 'cipher-refresh',
        tokenExpiresAt: '2026-02-01T00:00:00.000Z',
        credentialProvider: 'local',
        keyRef: 'local:v1',
      });
      assert.deepEqual(where, {
        id: 'pcn_one',
        status: 'active',
        accessTokenCiphertext: 'cipher-old',
      });
      assert.equal(data?.accessTokenCiphertext, 'cipher-new');
      assert.equal(data?.refreshTokenCiphertext, 'cipher-refresh');
      assert.ok(data?.tokenExpiresAt instanceof Date);
      assert.equal(findCalls, 1);
      assert.equal(saved?.accessTokenCiphertext, 'cipher-new');
    } finally {
      restore();
    }
  });

  await t.test('a lost compare-and-set returns null without reading a row', async () => {
    let findCalls = 0;
    const restore = patchPrisma({
      platformConnection: {
        async updateMany() {
          return { count: 0 };
        },
        async findUnique() {
          findCalls += 1;
          return connectionRow();
        },
      },
    });
    try {
      const saved = await storage.updatePlatformConnectionTokens({
        id: 'pcn_one',
        expectedAccessTokenCiphertext: 'cipher-stale',
        accessTokenCiphertext: 'cipher-new',
        credentialProvider: 'local',
        keyRef: 'local:v1',
      });
      assert.equal(saved, null);
      assert.equal(findCalls, 0);
    } finally {
      restore();
    }
  });

  await t.test('a null refresh token and expiry clear the columns', async () => {
    let data: Record<string, unknown> | undefined;
    const restore = patchPrisma({
      platformConnection: {
        async updateMany(args: { data: Record<string, unknown> }) {
          data = args.data;
          return { count: 1 };
        },
        async findUnique() {
          return connectionRow({ refreshTokenCiphertext: null, tokenExpiresAt: null });
        },
      },
    });
    try {
      await storage.updatePlatformConnectionTokens({
        id: 'pcn_one',
        expectedAccessTokenCiphertext: 'cipher-old',
        accessTokenCiphertext: 'cipher-new',
        refreshTokenCiphertext: null,
        tokenExpiresAt: null,
        credentialProvider: 'local',
        keyRef: 'local:v1',
      });
      assert.equal(data?.refreshTokenCiphertext, null);
      assert.equal(data?.tokenExpiresAt, null);
    } finally {
      restore();
    }
  });
});

test('Prisma upsert, disconnect and approval invalidation match the file store', async (t) => {
  await t.test('upsert clears undefined optional columns instead of leaving stale values', async () => {
    let args: { create: Record<string, unknown>; update: Record<string, unknown> } | undefined;
    const restore = patchPrisma({
      platformConnection: {
        async upsert(input: typeof args) {
          args = input;
          return connectionRow({ accessTokenCiphertext: 'cipher-old' });
        },
      },
    });
    try {
      await storage.upsertPlatformConnection(input);
      for (const data of [args!.create, args!.update]) {
        assert.equal(data.instanceUrl, 'https://mastodon.test');
        assert.equal(data.oauthStateHash, null);
        assert.equal(data.oauthStateExpiresAt, null);
        assert.equal(data.pendingOAuthCiphertext, null);
        assert.equal(data.refreshTokenCiphertext, null);
        assert.equal(data.serverId, null);
        assert.equal(data.channelId, null);
      }
      assert.equal(args!.create.userId, '1');
      assert.equal(args!.create.platformId, 'mastodon');
    } finally {
      restore();
    }
  });

  await t.test('upsert preserves a pending handshake in the update payload', async () => {
    let update: Record<string, unknown> | undefined;
    const restore = patchPrisma({
      platformConnection: {
        async upsert(args: { update: Record<string, unknown> }) {
          update = args.update;
          return connectionRow({ status: 'pending' });
        },
      },
    });
    try {
      await storage.upsertPlatformConnection({
        ...input,
        status: 'pending',
        oauthStateHash: 'hash-value',
        oauthStateExpiresAt: '2026-03-01T00:00:00.000Z',
        pendingOAuthCiphertext: '{"ciphertext":"x"}',
      });
      assert.equal(update?.oauthStateHash, 'hash-value');
      assert.ok(update?.oauthStateExpiresAt instanceof Date);
      assert.equal(update?.pendingOAuthCiphertext, '{"ciphertext":"x"}');
    } finally {
      restore();
    }
  });

  await t.test('disconnecting wipes token and handshake columns', async () => {
    let data: Record<string, unknown> | undefined;
    const restore = patchPrisma({
      platformConnection: {
        async findUnique() {
          return connectionRow();
        },
        async update(args: { data: Record<string, unknown> }) {
          data = args.data;
          return connectionRow({ status: 'disconnected' });
        },
      },
    });
    try {
      assert.equal(await storage.disconnectPlatformConnection('pcn_one'), true);
      assert.deepEqual(data, {
        status: 'disconnected',
        accessTokenCiphertext: '',
        refreshTokenCiphertext: null,
        tokenExpiresAt: null,
        keyRef: '',
        oauthStateHash: null,
        oauthStateExpiresAt: null,
        pendingOAuthCiphertext: null,
      });
    } finally {
      restore();
    }
  });

  await t.test('disconnecting an unknown connection does not write', async () => {
    let updates = 0;
    const restore = patchPrisma({
      platformConnection: {
        async findUnique() {
          return null;
        },
        async update() {
          updates += 1;
          return connectionRow();
        },
      },
    });
    try {
      assert.equal(await storage.disconnectPlatformConnection('pcn_missing'), false);
      assert.equal(updates, 0);
    } finally {
      restore();
    }
  });

  await t.test('destination changes reset only the approved platform drafts', async () => {
    let args: unknown;
    const restore = patchPrisma({
      draft: {
        async updateMany(input: unknown) {
          args = input;
          return { count: 2 };
        },
      },
    });
    try {
      assert.equal(await storage.invalidateDraftApprovals('prj_one', 'mastodon'), 2);
      assert.deepEqual(args, {
        where: { projectId: 'prj_one', platformId: 'mastodon', status: 'approved' },
        data: {
          status: 'drafted',
          approvedText: null,
          approvedHash: null,
          approvedAt: null,
          approvedBy: null,
        },
      });
    } finally {
      restore();
    }
  });
});

const publicationRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'pub_one',
  userId: '1',
  projectId: 'prj_one',
  draftId: 'draft_one',
  connectionId: 'pcn_one',
  platformId: 'mastodon',
  status: 'sending',
  mode: 'api',
  contentHash: 'hash',
  externalId: null,
  externalIds: [],
  confirmedAt: null,
  errorCode: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
});

const publicationInput = {
  id: 'pub_one',
  userId: '1',
  projectId: 'prj_one',
  draftId: 'draft_one',
  connectionId: 'pcn_one',
  platformId: 'mastodon',
  status: 'sending' as const,
  mode: 'api' as const,
  contentHash: 'hash',
  externalIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

test('Prisma publication operations keep the atomic claim contract', async (t) => {
  await t.test('a unique violation returns the existing attempt instead of creating', async () => {
    let reads = 0;
    const restore = patchPrisma({
      publication: {
        async create() {
          throw Object.assign(new Error('unique violation'), { code: 'P2002' });
        },
        async findUnique() {
          reads += 1;
          return publicationRow({ status: 'sending' });
        },
      },
    });
    try {
      const claim = await storage.createPublicationIfAbsent(publicationInput);
      assert.equal(claim.created, false);
      assert.equal(claim.publication.id, 'pub_one');
      assert.equal(reads, 1);
    } finally {
      restore();
    }
  });

  await t.test('create stores only the content hash, never the post body', async () => {
    let data: Record<string, unknown> = {};
    const restore = patchPrisma({
      publication: {
        async create(input: { data: Record<string, unknown> }) {
          data = input.data;
          return publicationRow();
        },
      },
    });
    try {
      const claim = await storage.createPublicationIfAbsent(publicationInput);
      assert.equal(claim.created, true);
      assert.equal(data.contentHash, 'hash');
      assert.deepEqual(Object.keys(data).sort(), [
        'confirmedAt',
        'connectionId',
        'contentHash',
        'draftId',
        'errorCode',
        'externalId',
        'externalIds',
        'id',
        'mode',
        'platformId',
        'projectId',
        'status',
        'userId',
      ]);
    } finally {
      restore();
    }
  });

  await t.test('a retry claims only a failed row with no external id', async () => {
    let args: { where?: unknown; data?: unknown } = {};
    const restore = patchPrisma({
      publication: {
        async updateMany(input: { where: unknown; data: unknown }) {
          args = input;
          return { count: 1 };
        },
        async findUnique() {
          return publicationRow({ status: 'sending', errorCode: null });
        },
      },
    });
    try {
      const claimed = await storage.claimFailedPublication('pub_one');
      assert.deepEqual(args.where, { id: 'pub_one', status: 'failed', externalId: null });
      assert.deepEqual(args.data, { status: 'sending', errorCode: null });
      assert.equal(claimed?.status, 'sending');
    } finally {
      restore();
    }
  });

  await t.test('losing the retry claim returns null', async () => {
    const restore = patchPrisma({
      publication: {
        async updateMany() {
          return { count: 0 };
        },
      },
    });
    try {
      assert.equal(await storage.claimFailedPublication('pub_one'), null);
    } finally {
      restore();
    }
  });
});

const draftRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'draft_one',
  projectId: 'prj_one',
  platformId: 'x',
  text: 'First\n\nSecond',
  threadParts: ['First', 'Second'],
  status: 'drafted',
  approvedText: null,
  approvedHash: null,
  approvedAt: null,
  approvedBy: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
});

const usageRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'xuse_one',
  userId: '1',
  projectId: 'prj_one',
  draftId: 'draft_one',
  publicationId: 'pub_one',
  platformId: 'x',
  mode: 'api',
  requestCount: 1,
  costMicros: 15_000,
  currency: 'USD',
  status: 'reserved',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...overrides,
});

const usageInput = {
  id: 'xuse_one',
  userId: '1',
  projectId: 'prj_one',
  draftId: 'draft_one',
  publicationId: 'pub_one',
  platformId: 'x',
  mode: 'api' as const,
  requestCount: 1,
  costMicros: 15_000,
  currency: 'USD',
  status: 'reserved' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

test('Prisma X thread parts and the usage ledger match the file store', async (t) => {
  await t.test('draft thread parts are stored as JSON and read back intact', async () => {
    let data: Record<string, unknown> = {};
    const restore = patchPrisma({
      draft: {
        async create(input: { data: Record<string, unknown> }) {
          data = input.data;
          return draftRow();
        },
      },
    });
    try {
      const draft = await storage.createDraft({
        projectId: 'prj_one',
        platformId: 'x',
        text: 'First\n\nSecond',
        threadParts: ['First', 'Second'],
      });
      assert.deepEqual(data.threadParts, ['First', 'Second']);
      assert.deepEqual(draft.threadParts, ['First', 'Second']);
    } finally {
      restore();
    }
  });

  await t.test('editing without thread parts clears the column with DbNull', async () => {
    let data: Record<string, unknown> = {};
    const restore = patchPrisma({
      draft: {
        async update(input: { data: Record<string, unknown> }) {
          data = input.data;
          return draftRow({ text: 'Single post', threadParts: null, status: 'edited' });
        },
      },
    });
    try {
      const draft = await storage.updateDraft('draft_one', 'Single post');
      assert.equal(data.threadParts, Prisma.DbNull);
      assert.equal(draft?.threadParts, undefined);
    } finally {
      restore();
    }
  });

  await t.test('a unique publication key returns the existing ledger row', async () => {
    const restore = patchPrisma({
      usageLedgerEntry: {
        async create() {
          throw Object.assign(new Error('unique violation'), { code: 'P2002' });
        },
        async findUnique() {
          return usageRow({ status: 'committed' });
        },
      },
    });
    try {
      const result = await storage.createUsageEntryIfAbsent(usageInput);
      assert.equal(result.created, false);
      assert.equal(result.entry.status, 'committed');
      assert.equal(result.entry.costMicros, 15_000);
    } finally {
      restore();
    }
  });

  await t.test('the ledger status update writes only the status', async () => {
    let args: { where: unknown; data: unknown } | undefined;
    const restore = patchPrisma({
      usageLedgerEntry: {
        async update(input: { where: unknown; data: unknown }) {
          args = input;
          return usageRow({ status: 'released' });
        },
      },
    });
    try {
      const updated = await storage.updateUsageEntryStatus('xuse_one', 'released');
      assert.deepEqual(args, { where: { id: 'xuse_one' }, data: { status: 'released' } });
      assert.equal(updated?.status, 'released');
    } finally {
      restore();
    }
  });

  await t.test('the monthly sum counts reserved and committed rows only', async () => {
    let args: unknown;
    const restore = patchPrisma({
      usageLedgerEntry: {
        async aggregate(input: unknown) {
          args = input;
          return { _sum: { costMicros: 30_000 } };
        },
      },
    });
    const since = new Date('2026-11-01T00:00:00.000Z');
    try {
      assert.equal(await storage.sumUsageSince('x', since), 30_000);
      assert.deepEqual(args, {
        where: {
          platformId: 'x',
          createdAt: { gte: since },
          status: { in: ['reserved', 'committed'] },
        },
        _sum: { costMicros: true },
      });
    } finally {
      restore();
    }
  });

  await t.test('a publication maps manual mode, ids and confirmation', async () => {
    const restore = patchPrisma({
      publication: {
        async findUnique() {
          return publicationRow({
            mode: 'manual',
            connectionId: null,
            externalId: null,
            externalIds: [],
            confirmedAt: new Date('2026-01-03T00:00:00.000Z'),
            status: 'published',
          });
        },
      },
    });
    try {
      const found = await storage.getPublication('draft_one', 'mastodon');
      assert.equal(found?.mode, 'manual');
      assert.equal(found?.connectionId, undefined);
      assert.deepEqual(found?.externalIds, []);
      assert.equal(found?.confirmedAt, '2026-01-03T00:00:00.000Z');
    } finally {
      restore();
    }
  });

  await t.test('the file store keeps thread parts and ledger sums in parity', async () => {
    const env = process.env as Record<string, string | undefined>;
    const original = env.DATABASE_URL;
    env.DATABASE_URL = '';
    storage.reset();
    try {
      const draft = await storage.createDraft({
        projectId: 'prj_file',
        platformId: 'x',
        text: 'One\n\nTwo',
        threadParts: ['One', 'Two'],
      });
      assert.deepEqual(draft.threadParts, ['One', 'Two']);
      const edited = await storage.updateDraft(draft.id, 'One only');
      assert.equal(edited?.threadParts, undefined);

      const since = new Date('2026-11-01T00:00:00.000Z');
      await storage.createUsageEntryIfAbsent({
        ...usageInput,
        createdAt: '2026-12-01T00:00:00.000Z',
      });
      await storage.createUsageEntryIfAbsent({
        ...usageInput,
        id: 'xuse_released',
        publicationId: 'pub_released',
        status: 'released',
        createdAt: '2026-12-01T00:00:00.000Z',
      });
      assert.equal(await storage.sumUsageSince('x', since), 15_000);
      assert.equal(
        (await storage.createUsageEntryIfAbsent(usageInput)).created,
        false
      );
    } finally {
      env.DATABASE_URL = original;
      storage.reset();
    }
  });
});

test.after(() => {
  const env = process.env as Record<string, string | undefined>;
  if (originalEnv.NODE_ENV === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = originalEnv.NODE_ENV;
  if (originalEnv.DATABASE_URL === undefined) delete env.DATABASE_URL;
  else env.DATABASE_URL = originalEnv.DATABASE_URL;
});
