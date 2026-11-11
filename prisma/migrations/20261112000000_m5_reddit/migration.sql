-- M5 — Reddit publishing.
--
-- This migration assumes the M1–M4 tables already exist. The repository still
-- has no baseline migration, so the chain is not independently deployable yet
-- (see TODO.md). Every statement is guarded so it is safe to apply to a database
-- that already received the earlier milestones through `prisma db push`.
--
-- It does not touch existing rows: no tokens, drafts or publications are
-- rewritten.

-- Reddit submissions are defined by more than the body. `text` remains the
-- self-post body and the value shown in the composer.
ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "subreddit" TEXT;
ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "submissionType" TEXT;
ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "linkUrl" TEXT;

-- Owner-facing destination and permalink for a published submission.
ALTER TABLE "publications" ADD COLUMN IF NOT EXISTS "targetName" TEXT;
ALTER TABLE "publications" ADD COLUMN IF NOT EXISTS "externalUrl" TEXT;
