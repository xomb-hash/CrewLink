-- M4 — X (Twitter) hybrid publishing.
--
-- This migration assumes the M1–M3 tables already exist (the repository has no
-- baseline migration yet; see TODO.md). It is written with IF NOT EXISTS guards
-- so it is safe to apply to a database that already received M1–M3 through
-- `prisma db push`.
--
-- It does not touch any data: no tokens, posts or ledger rows are rewritten.

-- X threads: one array entry per post. `text` stays the canonical joined value.
ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "threadParts" JSONB;

-- API-confirmed vs owner-reported publishing.
ALTER TABLE "publications" ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'api';
ALTER TABLE "publications" ADD COLUMN IF NOT EXISTS "externalIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "publications" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);

-- Manual publications have no platform connection.
ALTER TABLE "publications" ALTER COLUMN "connectionId" DROP NOT NULL;

-- Keep the cascade behaviour when the foreign key did not exist yet.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'publications_connectionId_fkey'
  ) THEN
    ALTER TABLE "publications"
      ADD CONSTRAINT "publications_connectionId_fkey"
      FOREIGN KEY ("connectionId") REFERENCES "platform_connections"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- One row per X publication attempt that may be billed. Prices are stored with
-- the row so a later price change cannot rewrite history.
CREATE TABLE IF NOT EXISTS "x_usage_ledger" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "platformId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "costMicros" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" TEXT NOT NULL DEFAULT 'reserved',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "x_usage_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "x_usage_ledger_publicationId_key"
  ON "x_usage_ledger"("publicationId");
CREATE INDEX IF NOT EXISTS "x_usage_ledger_platformId_createdAt_idx"
  ON "x_usage_ledger"("platformId", "createdAt");
CREATE INDEX IF NOT EXISTS "x_usage_ledger_projectId_createdAt_idx"
  ON "x_usage_ledger"("projectId", "createdAt");
