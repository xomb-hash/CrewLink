-- M9 production hardening — database-backed analytics sync leases.
--
-- This table replaces the per-process analytics mutex for multi-instance
-- deployments. Each row is a short lease for one project/platform. Acquisition
-- is a unique insert or a conditional update of an expired row; release also
-- matches the owner token. No transaction is held during external API calls.
--
-- Additive only and safe to reapply.

CREATE TABLE IF NOT EXISTS "analytics_sync_locks" (
  "key" TEXT NOT NULL,
  "ownerToken" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "platformId" TEXT NOT NULL,
  "connectionId" TEXT,
  "acquiredAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "analytics_sync_locks_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "analytics_sync_locks_expiresAt_idx"
  ON "analytics_sync_locks"("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'analytics_sync_locks_projectId_fkey'
  ) THEN
    ALTER TABLE "analytics_sync_locks"
      ADD CONSTRAINT "analytics_sync_locks_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
