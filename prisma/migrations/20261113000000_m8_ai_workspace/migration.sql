-- M8 — AI workspace.
--
-- This migration is additive. It creates campaign metadata tables and adds two
-- optional columns to "drafts". It does not touch tokens, existing drafts,
-- approvals or publications. Every statement is guarded so it can be applied to
-- a database that already received earlier milestones through `prisma db push`.
--
-- Nothing here has been applied. Do not run `prisma migrate` or `db push`
-- against a shared or production database without explicit approval.

ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;
ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "contentIdeaId" TEXT;
CREATE INDEX IF NOT EXISTS "drafts_campaignId_idx" ON "drafts"("campaignId");

CREATE TABLE IF NOT EXISTS "ai_campaigns" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "brief" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT '',
  "objective" TEXT NOT NULL DEFAULT '',
  "audience" TEXT NOT NULL DEFAULT '',
  "platforms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "durationDays" INTEGER NOT NULL DEFAULT 7,
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "startDate" TEXT NOT NULL DEFAULT '',
  "redditSubreddit" TEXT,
  "themes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "postingFrequency" TEXT NOT NULL DEFAULT '',
  "desiredOutcomes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'queued',
  "strategyNotes" TEXT,
  "research" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_campaigns_projectId_idx" ON "ai_campaigns"("projectId");
CREATE INDEX IF NOT EXISTS "ai_campaigns_ownerId_idx" ON "ai_campaigns"("ownerId");

CREATE TABLE IF NOT EXISTS "ai_campaign_tasks" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "detail" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_campaign_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_campaign_tasks_campaignId_idx" ON "ai_campaign_tasks"("campaignId");

CREATE TABLE IF NOT EXISTS "ai_research_sources" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "publisher" TEXT,
  "publishedAt" TIMESTAMP(3),
  "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "summary" TEXT,
  "provider" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ai_research_sources_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_research_sources_campaignId_idx" ON "ai_research_sources"("campaignId");

CREATE TABLE IF NOT EXISTS "ai_brand_profiles" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "brandName" TEXT NOT NULL DEFAULT '',
  "description" TEXT NOT NULL DEFAULT '',
  "audience" TEXT NOT NULL DEFAULT '',
  "tone" TEXT NOT NULL DEFAULT '',
  "vocabulary" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "style" TEXT NOT NULL DEFAULT '',
  "avoidTopics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "avoidWords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "ctas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "examplePosts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_brand_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_brand_profiles_projectId_key" ON "ai_brand_profiles"("projectId");

CREATE TABLE IF NOT EXISTS "ai_content_ideas" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "day" INTEGER NOT NULL,
  "platformId" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "angle" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'planned',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_content_ideas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_content_ideas_campaignId_idx" ON "ai_content_ideas"("campaignId");

CREATE TABLE IF NOT EXISTS "ai_generated_posts" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "ideaId" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "platformId" TEXT NOT NULL,
  "variationIndex" INTEGER NOT NULL DEFAULT 0,
  "quality" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_generated_posts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_generated_posts_draftId_key" ON "ai_generated_posts"("draftId");
CREATE INDEX IF NOT EXISTS "ai_generated_posts_campaignId_idx" ON "ai_generated_posts"("campaignId");
CREATE INDEX IF NOT EXISTS "ai_generated_posts_ideaId_idx" ON "ai_generated_posts"("ideaId");

CREATE TABLE IF NOT EXISTS "ai_campaign_schedules" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "platformId" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'suggested',
  "reason" TEXT,
  "source" TEXT NOT NULL DEFAULT 'ai',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_campaign_schedules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_campaign_schedules_draftId_key" ON "ai_campaign_schedules"("draftId");
CREATE INDEX IF NOT EXISTS "ai_campaign_schedules_campaignId_idx" ON "ai_campaign_schedules"("campaignId");

CREATE TABLE IF NOT EXISTS "ai_agent_executions" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "promptTokens" INTEGER NOT NULL DEFAULT 0,
  "completionTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "costMicros" INTEGER,
  "latencyMs" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_executions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_agent_executions_campaignId_idx" ON "ai_agent_executions"("campaignId");

CREATE TABLE IF NOT EXISTS "ai_campaign_analytics" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "metrics" JSONB NOT NULL,
  "unavailable" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "note" TEXT NOT NULL DEFAULT '',
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_campaign_analytics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_campaign_analytics_campaignId_key" ON "ai_campaign_analytics"("campaignId");
CREATE INDEX IF NOT EXISTS "ai_campaign_analytics_projectId_idx" ON "ai_campaign_analytics"("projectId");

-- Foreign keys are added only if missing, so repeated runs are safe.
DO $$ BEGIN
  ALTER TABLE "ai_campaigns" ADD CONSTRAINT "ai_campaigns_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_campaign_tasks" ADD CONSTRAINT "ai_campaign_tasks_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "ai_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_research_sources" ADD CONSTRAINT "ai_research_sources_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "ai_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_brand_profiles" ADD CONSTRAINT "ai_brand_profiles_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_content_ideas" ADD CONSTRAINT "ai_content_ideas_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "ai_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_generated_posts" ADD CONSTRAINT "ai_generated_posts_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "ai_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_generated_posts" ADD CONSTRAINT "ai_generated_posts_ideaId_fkey"
    FOREIGN KEY ("ideaId") REFERENCES "ai_content_ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_campaign_schedules" ADD CONSTRAINT "ai_campaign_schedules_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "ai_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_agent_executions" ADD CONSTRAINT "ai_agent_executions_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "ai_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_campaign_analytics" ADD CONSTRAINT "ai_campaign_analytics_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "ai_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
