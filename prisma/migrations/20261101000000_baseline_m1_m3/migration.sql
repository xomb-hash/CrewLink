-- Baseline — M1–M3 schema.
--
-- This is the missing baseline that allows a fresh PostgreSQL database to be
-- built with `prisma migrate deploy` instead of `prisma db push`. It captures
-- the core tables plus the M1 credential/connection schema and M3 OAuth state
-- columns. M4, M5, M8, M9 and the M9 hardening migration apply above it.
--
-- Existing databases created with `prisma db push` must mark this migration as
-- applied (see docs/PRODUCTION-READINESS.md), never re-run it.
--
-- Generated from the pre-M4 Prisma schema; reviewed for additive deployment.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicRepos" INTEGER NOT NULL DEFAULT 0,
    "accessToken" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerLogin" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "ownerAvatar" TEXT,
    "repoFullName" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "repoOwner" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "joinMode" TEXT NOT NULL DEFAULT 'referral',
    "screeningUrl" TEXT,
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" TEXT NOT NULL,
    "description" TEXT,
    "creatorNote" TEXT,
    "requireResume" BOOLEAN NOT NULL DEFAULT false,
    "requireGithubLink" BOOLEAN NOT NULL DEFAULT false,
    "requireLinkedinLink" BOOLEAN NOT NULL DEFAULT false,
    "referralCode" TEXT,
    "referralCodeCreatedAt" TIMESTAMP(3),
    "referralCodeExpiresAt" TIMESTAMP(3),
    "referralCodeUsageLimit" INTEGER,
    "referralCodeRevokedAt" TIMESTAMP(3),
    "referralCodeUsedAt" TIMESTAMP(3),
    "logoPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafts" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'drafted',
    "approvedText" TEXT,
    "approvedHash" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicants" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userLogin" TEXT NOT NULL,
    "userAvatar" TEXT,
    "accountAge" TEXT NOT NULL,
    "publicRepoCount" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "githubUrl" TEXT,
    "linkedinUrl" TEXT,
    "resumeFileName" TEXT,
    "resumePath" TEXT,
    "referralCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invitationSent" BOOLEAN NOT NULL DEFAULT false,
    "invitationDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applicants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "externalAccountId" TEXT,
    "externalAccountName" TEXT,
    "serverId" TEXT,
    "serverName" TEXT,
    "channelId" TEXT,
    "channelName" TEXT,
    "instanceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenExpiresAt" TIMESTAMP(3),
    "accessTokenCiphertext" TEXT NOT NULL,
    "refreshTokenCiphertext" TEXT,
    "oauthStateHash" TEXT,
    "oauthStateExpiresAt" TIMESTAMP(3),
    "pendingOAuthCiphertext" TEXT,
    "credentialProvider" TEXT NOT NULL,
    "keyRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sending',
    "contentHash" TEXT NOT NULL,
    "externalId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_login_key" ON "users"("login");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "projects_referralCode_key" ON "projects"("referralCode");

-- CreateIndex
CREATE INDEX "projects_ownerLogin_idx" ON "projects"("ownerLogin");

-- CreateIndex
CREATE INDEX "projects_ownerId_idx" ON "projects"("ownerId");

-- CreateIndex
CREATE INDEX "drafts_projectId_idx" ON "drafts"("projectId");

-- CreateIndex
CREATE INDEX "applicants_projectId_idx" ON "applicants"("projectId");

-- CreateIndex
CREATE INDEX "applicants_projectId_referralCode_idx" ON "applicants"("projectId", "referralCode");

-- CreateIndex
CREATE INDEX "applicants_userId_idx" ON "applicants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "applicants_projectId_userId_key" ON "applicants"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_connections_oauthStateHash_key" ON "platform_connections"("oauthStateHash");

-- CreateIndex
CREATE INDEX "platform_connections_userId_idx" ON "platform_connections"("userId");

-- CreateIndex
CREATE INDEX "platform_connections_projectId_idx" ON "platform_connections"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_connections_userId_platformId_projectId_key" ON "platform_connections"("userId", "platformId", "projectId");

-- CreateIndex
CREATE INDEX "publications_projectId_idx" ON "publications"("projectId");

-- CreateIndex
CREATE INDEX "publications_userId_idx" ON "publications"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "publications_draftId_platformId_key" ON "publications"("draftId", "platformId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicants" ADD CONSTRAINT "applicants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_connections" ADD CONSTRAINT "platform_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_connections" ADD CONSTRAINT "platform_connections_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "platform_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

