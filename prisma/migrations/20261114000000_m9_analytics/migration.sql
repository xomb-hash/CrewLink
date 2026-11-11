-- M9 — platform analytics and optimization.
--
-- Timestamp note: 20261114000000 is intentionally later than M8's
-- 20261113000000 so Prisma applies this migration after M8, even though the
-- 2026-11-11 implementation date was earlier. It had never been applied when the
-- ordering was chosen. Do not rename an applied migration; see
-- docs/PRODUCTION-READINESS.md for the deployment order.
--
-- Additive only: five new tables and their indexes/foreign keys. No existing
-- column is changed and no data is rewritten. Written with IF NOT EXISTS guards
-- so it is safe to apply to a database that received M1–M8 through `db push`
-- (the M1–M3 baseline migration is still outstanding; see TODO.md).
--
-- These tables store numeric platform metrics, snapshots and AI output. They
-- never store OAuth tokens, ciphertext or post bodies.

CREATE TABLE IF NOT EXISTS "analytics_accounts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "platformId" TEXT NOT NULL,
  "externalAccountId" TEXT,
  "externalAccountName" TEXT,
  "metrics" JSONB,
  "availableMetrics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "unavailableMetrics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'pending',
  "note" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "analytics_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "analytics_accounts_connectionId_key"
  ON "analytics_accounts"("connectionId");
CREATE INDEX IF NOT EXISTS "analytics_accounts_userId_idx"
  ON "analytics_accounts"("userId");
CREATE INDEX IF NOT EXISTS "analytics_accounts_projectId_idx"
  ON "analytics_accounts"("projectId");
CREATE INDEX IF NOT EXISTS "analytics_accounts_platformId_idx"
  ON "analytics_accounts"("platformId");

CREATE TABLE IF NOT EXISTS "analytics_posts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "campaignId" TEXT,
  "platformId" TEXT NOT NULL,
  "externalId" TEXT,
  "externalUrl" TEXT,
  "publishedAt" TIMESTAMP(3) NOT NULL,
  "contentType" TEXT NOT NULL DEFAULT 'text',
  "topic" TEXT,
  "metrics" JSONB,
  "availableMetrics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "unavailableMetrics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "engagement" DOUBLE PRECISION,
  "engagementRate" DOUBLE PRECISION,
  "engagementRateBasis" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "note" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "analytics_posts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "analytics_posts_publicationId_key"
  ON "analytics_posts"("publicationId");
CREATE INDEX IF NOT EXISTS "analytics_posts_projectId_publishedAt_idx"
  ON "analytics_posts"("projectId", "publishedAt");
CREATE INDEX IF NOT EXISTS "analytics_posts_campaignId_idx"
  ON "analytics_posts"("campaignId");
CREATE INDEX IF NOT EXISTS "analytics_posts_platformId_idx"
  ON "analytics_posts"("platformId");
CREATE INDEX IF NOT EXISTS "analytics_posts_userId_idx"
  ON "analytics_posts"("userId");

CREATE TABLE IF NOT EXISTS "analytics_snapshots" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "platformId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "analyticsPostId" TEXT,
  "analyticsAccountId" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "metrics" JSONB NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'api',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "analytics_snapshots_dedupeKey_key"
  ON "analytics_snapshots"("dedupeKey");
CREATE INDEX IF NOT EXISTS "analytics_snapshots_analyticsPostId_capturedAt_idx"
  ON "analytics_snapshots"("analyticsPostId", "capturedAt");
CREATE INDEX IF NOT EXISTS "analytics_snapshots_analyticsAccountId_capturedAt_idx"
  ON "analytics_snapshots"("analyticsAccountId", "capturedAt");
CREATE INDEX IF NOT EXISTS "analytics_snapshots_projectId_capturedAt_idx"
  ON "analytics_snapshots"("projectId", "capturedAt");

CREATE TABLE IF NOT EXISTS "analytics_syncs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "platformId" TEXT NOT NULL,
  "trigger" TEXT NOT NULL DEFAULT 'manual',
  "status" TEXT NOT NULL DEFAULT 'running',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "postsRequested" INTEGER NOT NULL DEFAULT 0,
  "postsUpdated" INTEGER NOT NULL DEFAULT 0,
  "snapshotsWritten" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_syncs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "analytics_syncs_projectId_platformId_startedAt_idx"
  ON "analytics_syncs"("projectId", "platformId", "startedAt");
CREATE INDEX IF NOT EXISTS "analytics_syncs_userId_idx"
  ON "analytics_syncs"("userId");

CREATE TABLE IF NOT EXISTS "analytics_insights" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "campaignId" TEXT,
  "scope" TEXT NOT NULL DEFAULT 'project',
  "periodStart" TEXT NOT NULL,
  "periodEnd" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'new',
  "sampleSize" INTEGER NOT NULL DEFAULT 0,
  "promptTokens" INTEGER NOT NULL DEFAULT 0,
  "completionTokens" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  CONSTRAINT "analytics_insights_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "analytics_insights_projectId_createdAt_idx"
  ON "analytics_insights"("projectId", "createdAt");
CREATE INDEX IF NOT EXISTS "analytics_insights_campaignId_idx"
  ON "analytics_insights"("campaignId");
CREATE INDEX IF NOT EXISTS "analytics_insights_userId_idx"
  ON "analytics_insights"("userId");

-- Foreign keys. Guarded so reapplying the migration cannot fail on an existing
-- constraint (for example after a `db push` created it).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_accounts_projectId_fkey') THEN
    ALTER TABLE "analytics_accounts" ADD CONSTRAINT "analytics_accounts_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_accounts_connectionId_fkey') THEN
    ALTER TABLE "analytics_accounts" ADD CONSTRAINT "analytics_accounts_connectionId_fkey"
      FOREIGN KEY ("connectionId") REFERENCES "platform_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_posts_projectId_fkey') THEN
    ALTER TABLE "analytics_posts" ADD CONSTRAINT "analytics_posts_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_posts_publicationId_fkey') THEN
    ALTER TABLE "analytics_posts" ADD CONSTRAINT "analytics_posts_publicationId_fkey"
      FOREIGN KEY ("publicationId") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_posts_campaignId_fkey') THEN
    ALTER TABLE "analytics_posts" ADD CONSTRAINT "analytics_posts_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "ai_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_snapshots_projectId_fkey') THEN
    ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_snapshots_analyticsPostId_fkey') THEN
    ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_analyticsPostId_fkey"
      FOREIGN KEY ("analyticsPostId") REFERENCES "analytics_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_snapshots_analyticsAccountId_fkey') THEN
    ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_analyticsAccountId_fkey"
      FOREIGN KEY ("analyticsAccountId") REFERENCES "analytics_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_syncs_projectId_fkey') THEN
    ALTER TABLE "analytics_syncs" ADD CONSTRAINT "analytics_syncs_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_insights_projectId_fkey') THEN
    ALTER TABLE "analytics_insights" ADD CONSTRAINT "analytics_insights_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_insights_campaignId_fkey') THEN
    ALTER TABLE "analytics_insights" ADD CONSTRAINT "analytics_insights_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "ai_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
