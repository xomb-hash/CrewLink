import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from './prisma';
import { encryptSecret, decryptSecret, isEncrypted } from './crypto';
import { logger } from './logger';
import { generateReferralCode, normalizeReferralCode } from '../projects/referral';
import type {
  User,
  Project,
  Applicant,
  Session,
  Draft,
  DraftStatus,
  JoinMode,
  ReferralSettings,
  PlatformConnectionStatus,
  StoredPlatformConnection,
  Publication,
  PublicationStatus,
  UsageEntryStatus,
  UsageLedgerEntry,
} from '../types/index';
import type {
  AnalyticsAccount,
  AnalyticsPost,
  AnalyticsSnapshot,
  AnalyticsSync,
  AnalyticsInsight,
  AnalyticsPostStatus,
  AnalyticsSyncStatus,
  AnalyticsInsightScope,
  AnalyticsInsightStatus,
  AnalyticsSyncLock,
  MetricSet,
} from '../analytics/types';
import { isMetricKey, type MetricKey } from '../analytics/metricsKeys';
import { sanitizeStoredMetrics } from '../analytics/metrics';
import type {
  AgentExecution,
  BrandProfile,
  Campaign,
  CampaignAnalytics,
  CampaignSchedule,
  CampaignTask,
  CampaignTaskKind,
  CampaignTaskStatus,
  ContentIdea,
  ContentIdeaStatus,
  GeneratedPost,
  QualityResult,
  ResearchResult,
  ResearchSource,
  ScheduleSource,
  ScheduleStatus,
} from '../ai/types';
import type {
  Project as DbProject,
  Applicant as DbApplicant,
  Draft as DbDraft,
  PlatformConnection as DbPlatformConnection,
  Publication as DbPublication,
  UsageLedgerEntry as DbUsageLedgerEntry,
  Campaign as DbCampaign,
  CampaignTask as DbCampaignTask,
  ResearchSource as DbResearchSource,
  BrandProfile as DbBrandProfile,
  ContentIdea as DbContentIdea,
  GeneratedPost as DbGeneratedPost,
  CampaignSchedule as DbCampaignSchedule,
  AgentExecution as DbAgentExecution,
  CampaignAnalytics as DbCampaignAnalytics,
  AnalyticsAccount as DbAnalyticsAccount,
  AnalyticsPost as DbAnalyticsPost,
  AnalyticsSnapshot as DbAnalyticsSnapshot,
  AnalyticsSync as DbAnalyticsSync,
  AnalyticsInsight as DbAnalyticsInsight,
  AnalyticsSyncLock as DbAnalyticsSyncLock,
} from '@prisma/client';
import { Prisma } from '@prisma/client';

interface StorageData {
  projects: Project[];
  applicants: Applicant[];
  users: Record<string, User>;
  sessions: Record<string, Session>;
  drafts: Draft[];
  platformConnections: StoredPlatformConnection[];
  publications: Publication[];
  usageLedger: UsageLedgerEntry[];
  campaigns: Campaign[];
  campaignTasks: CampaignTask[];
  researchSources: ResearchSource[];
  brandProfiles: BrandProfile[];
  contentIdeas: ContentIdea[];
  generatedPosts: GeneratedPost[];
  campaignSchedules: CampaignSchedule[];
  agentExecutions: AgentExecution[];
  campaignAnalytics: CampaignAnalytics[];
  analyticsAccounts: AnalyticsAccount[];
  analyticsPosts: AnalyticsPost[];
  analyticsSnapshots: AnalyticsSnapshot[];
  analyticsSyncs: AnalyticsSync[];
  analyticsInsights: AnalyticsInsight[];
  analyticsSyncLocks: AnalyticsSyncLock[];
}

function toProject(p: DbProject): Project {
  return {
    id: p.id,
    slug: p.slug,
    ownerLogin: p.ownerLogin,
    ownerId: p.ownerId,
    ownerAvatar: p.ownerAvatar ?? undefined,
    repoFullName: p.repoFullName,
    repoName: p.repoName,
    repoOwner: p.repoOwner,
    isPrivate: p.isPrivate,
    joinMode: p.joinMode as JoinMode,
    screeningUrl: p.screeningUrl ?? undefined,
    roles: p.roles,
    title: p.title,
    description: p.description ?? undefined,
    creatorNote: p.creatorNote ?? undefined,
    requireResume: p.requireResume,
    requireGithubLink: p.requireGithubLink,
    requireLinkedinLink: p.requireLinkedinLink,
    referralCode: p.referralCode ?? undefined,
    referralCodeCreatedAt: p.referralCodeCreatedAt?.toISOString(),
    referralCodeExpiresAt: p.referralCodeExpiresAt?.toISOString(),
    referralCodeUsageLimit: p.referralCodeUsageLimit ?? undefined,
    referralCodeRevokedAt: p.referralCodeRevokedAt?.toISOString(),
    referralCodeUsedAt: p.referralCodeUsedAt?.toISOString(),
    logoPath: p.logoPath ?? undefined,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toApplicant(a: DbApplicant): Applicant {
  const details =
    a.invitationDetails && typeof a.invitationDetails === 'object'
      ? (a.invitationDetails as Record<string, unknown>)
      : {};
  return {
    id: a.id,
    projectId: a.projectId,
    userId: a.userId,
    userLogin: a.userLogin,
    userAvatar: a.userAvatar ?? undefined,
    accountAge: a.accountAge,
    publicRepoCount: a.publicRepoCount,
    message: a.message ?? undefined,
    githubUrl: a.githubUrl ?? undefined,
    linkedinUrl:
      a.linkedinUrl ??
      (typeof details.linkedinUrl === 'string' && details.linkedinUrl ? details.linkedinUrl : undefined),
    proofUrl: typeof details.proofUrl === 'string' && details.proofUrl ? details.proofUrl : undefined,
    resumeFileName: a.resumeFileName ?? undefined,
    resumePath: a.resumePath ?? undefined,
    referralCode: a.referralCode ?? undefined,
    status: a.status as Applicant['status'],
    invitationSent: a.invitationSent,
    invitationDetails: a.invitationDetails,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function toStoredConnection(c: DbPlatformConnection): StoredPlatformConnection {
  return {
    id: c.id,
    userId: c.userId,
    projectId: c.projectId,
    platformId: c.platformId,
    externalAccountId: c.externalAccountId ?? undefined,
    externalAccountName: c.externalAccountName ?? undefined,
    serverId: c.serverId ?? undefined,
    serverName: c.serverName ?? undefined,
    channelId: c.channelId ?? undefined,
    channelName: c.channelName ?? undefined,
    instanceUrl: c.instanceUrl ?? undefined,
    status: c.status as PlatformConnectionStatus,
    scopes: c.scopes,
    tokenExpiresAt: c.tokenExpiresAt ? c.tokenExpiresAt.toISOString() : undefined,
    accessTokenCiphertext: c.accessTokenCiphertext,
    refreshTokenCiphertext: c.refreshTokenCiphertext ?? undefined,
    credentialProvider: c.credentialProvider as StoredPlatformConnection['credentialProvider'],
    keyRef: c.keyRef,
    oauthStateHash: c.oauthStateHash ?? undefined,
    oauthStateExpiresAt: c.oauthStateExpiresAt ? c.oauthStateExpiresAt.toISOString() : undefined,
    pendingOAuthCiphertext: c.pendingOAuthCiphertext ?? undefined,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

// File-backed reads hand out a copy so a caller holding a snapshot cannot mutate
// stored state. Prisma already returns a fresh object for every read.
function copyStoredConnection(
  connection: StoredPlatformConnection
): StoredPlatformConnection {
  return { ...connection, scopes: [...connection.scopes] };
}

function toPublication(p: DbPublication): Publication {
  return {
    id: p.id,
    userId: p.userId,
    projectId: p.projectId,
    draftId: p.draftId,
    connectionId: p.connectionId ?? undefined,
    platformId: p.platformId,
    status: p.status as PublicationStatus,
    mode: p.mode === 'manual' ? 'manual' : 'api',
    contentHash: p.contentHash,
    externalId: p.externalId ?? undefined,
    externalIds: Array.isArray(p.externalIds) ? p.externalIds : [],
    ...(p.targetName ? { targetName: p.targetName } : {}),
    ...(p.externalUrl ? { externalUrl: p.externalUrl } : {}),
    errorCode: p.errorCode ?? undefined,
    confirmedAt: p.confirmedAt ? p.confirmedAt.toISOString() : undefined,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toDraft(d: DbDraft): Draft {
  return {
    id: d.id,
    projectId: d.projectId,
    platformId: d.platformId,
    text: d.text,
    threadParts: toThreadParts(d.threadParts),
    title: d.title ?? undefined,
    subreddit: d.subreddit ?? undefined,
    submissionType:
      d.submissionType === 'self' || d.submissionType === 'link'
        ? d.submissionType
        : undefined,
    linkUrl: d.linkUrl ?? undefined,
    campaignId: d.campaignId ?? undefined,
    contentIdeaId: d.contentIdeaId ?? undefined,
    status: d.status as DraftStatus,
    approvedText: d.approvedText ?? undefined,
    approvedHash: d.approvedHash ?? undefined,
    approvedAt: d.approvedAt ? d.approvedAt.toISOString() : undefined,
    approvedBy: d.approvedBy ?? undefined,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function toUsageEntry(e: DbUsageLedgerEntry): UsageLedgerEntry {
  return {
    id: e.id,
    userId: e.userId,
    projectId: e.projectId,
    draftId: e.draftId,
    publicationId: e.publicationId,
    platformId: e.platformId,
    mode: e.mode === 'manual' ? 'manual' : 'api',
    requestCount: e.requestCount,
    costMicros: e.costMicros,
    currency: e.currency,
    status: e.status as UsageEntryStatus,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

function toThreadParts(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value.filter((part): part is string => typeof part === 'string');
  return parts.length ? parts : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

// JSON columns are written by this module only, but a defensive shape check
// keeps an older or hand-edited file from crashing a read.
function toResearchResult(value: unknown): ResearchResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const search = raw.search && typeof raw.search === 'object' ? (raw.search as Record<string, unknown>) : {};
  const status = search.status;
  const findings = Array.isArray(raw.findings)
    ? raw.findings
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          statement: String(item.statement || ''),
          sourceUrls: stringArray(item.sourceUrls),
          verified: item.verified === true,
        }))
        .filter((item) => item.statement)
    : [];
  return {
    summary: String(raw.summary || ''),
    findings,
    opportunities: stringArray(raw.opportunities),
    assumptions: stringArray(raw.assumptions),
    search: {
      status:
        status === 'ok' || status === 'not_configured' || status === 'failed' || status === 'empty'
          ? status
          : 'not_configured',
      providers: stringArray(search.providers),
      message: typeof search.message === 'string' ? search.message : undefined,
    },
    generatedAt: String(raw.generatedAt || new Date(0).toISOString()),
  };
}

function toQualityResult(value: unknown): QualityResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const score = Number(raw.score);
  if (!Number.isFinite(score)) return undefined;
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    verificationStatus: 'unverified',
    disclaimer: String(raw.disclaimer || ''),
    issues: Array.isArray(raw.issues)
      ? raw.issues
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .map<QualityResult['issues'][number]>((item) => ({
            code: String(item.code || 'quality_issue'),
            severity:
              item.severity === 'error' || item.severity === 'warning' ? item.severity : 'info',
            message: String(item.message || ''),
            sourceUrls: stringArray(item.sourceUrls),
          }))
          .filter((item) => item.message)
      : [],
    improvements: stringArray(raw.improvements),
    sourceUrls: stringArray(raw.sourceUrls),
    linkCheck: 'not_checked',
    checkedAt: String(raw.checkedAt || new Date(0).toISOString()),
    provider: String(raw.provider || ''),
    model: String(raw.model || ''),
  };
}

function toCampaign(c: DbCampaign): Campaign {
  return {
    id: c.id,
    projectId: c.projectId,
    ownerId: c.ownerId,
    brief: c.brief,
    name: c.name,
    objective: c.objective,
    audience: c.audience,
    platforms: c.platforms,
    durationDays: c.durationDays,
    timezone: c.timezone,
    startDate: c.startDate,
    redditSubreddit: c.redditSubreddit ?? undefined,
    themes: c.themes,
    postingFrequency: c.postingFrequency,
    desiredOutcomes: c.desiredOutcomes,
    status: c.status as Campaign['status'],
    strategyNotes: c.strategyNotes ?? undefined,
    research: toResearchResult(c.research),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function toCampaignTask(t: DbCampaignTask): CampaignTask {
  return {
    id: t.id,
    campaignId: t.campaignId,
    kind: t.kind as CampaignTaskKind,
    status: t.status as CampaignTaskStatus,
    detail: t.detail ?? undefined,
    errorCode: t.errorCode ?? undefined,
    errorMessage: t.errorMessage ?? undefined,
    startedAt: t.startedAt ? t.startedAt.toISOString() : undefined,
    completedAt: t.completedAt ? t.completedAt.toISOString() : undefined,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function toResearchSource(s: DbResearchSource): ResearchSource {
  return {
    id: s.id,
    campaignId: s.campaignId,
    title: s.title,
    url: s.url,
    publisher: s.publisher ?? undefined,
    publishedAt: s.publishedAt ? s.publishedAt.toISOString() : undefined,
    retrievedAt: s.retrievedAt.toISOString(),
    summary: s.summary ?? undefined,
    provider: s.provider as ResearchSource['provider'],
    verified: s.verified,
  };
}

function toBrandProfile(b: DbBrandProfile): BrandProfile {
  return {
    id: b.id,
    projectId: b.projectId,
    brandName: b.brandName,
    description: b.description,
    audience: b.audience,
    tone: b.tone,
    vocabulary: b.vocabulary,
    style: b.style,
    avoidTopics: b.avoidTopics,
    avoidWords: b.avoidWords,
    ctas: b.ctas,
    examplePosts: b.examplePosts,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

function toContentIdea(i: DbContentIdea): ContentIdea {
  return {
    id: i.id,
    campaignId: i.campaignId,
    day: i.day,
    platformId: i.platformId,
    topic: i.topic,
    angle: i.angle,
    status: i.status as ContentIdeaStatus,
    note: i.note ?? undefined,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

function toGeneratedPost(g: DbGeneratedPost): GeneratedPost {
  return {
    id: g.id,
    campaignId: g.campaignId,
    ideaId: g.ideaId,
    draftId: g.draftId,
    platformId: g.platformId,
    variationIndex: g.variationIndex,
    quality: toQualityResult(g.quality),
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

function toCampaignSchedule(s: DbCampaignSchedule): CampaignSchedule {
  return {
    id: s.id,
    campaignId: s.campaignId,
    draftId: s.draftId,
    platformId: s.platformId,
    scheduledFor: s.scheduledFor.toISOString(),
    timezone: s.timezone,
    status: s.status as ScheduleStatus,
    reason: s.reason ?? undefined,
    source: s.source === 'manual' ? 'manual' : 'ai',
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function toAgentExecution(e: DbAgentExecution): AgentExecution {
  return {
    id: e.id,
    campaignId: e.campaignId,
    projectId: e.projectId,
    userId: e.userId,
    stage: e.stage as AgentExecution['stage'],
    provider: e.provider,
    model: e.model,
    status: e.status as AgentExecution['status'],
    promptTokens: e.promptTokens,
    completionTokens: e.completionTokens,
    totalTokens: e.totalTokens,
    costMicros: e.costMicros ?? undefined,
    latencyMs: e.latencyMs,
    errorCode: e.errorCode ?? undefined,
    createdAt: e.createdAt.toISOString(),
  };
}

function analyticsMetrics(value: unknown): CampaignAnalytics['metrics'] {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const byPlatformRaw =
    raw.byPlatform && typeof raw.byPlatform === 'object'
      ? (raw.byPlatform as Record<string, unknown>)
      : {};
  const byPlatform: Record<string, number> = {};
  for (const [platform, count] of Object.entries(byPlatformRaw)) {
    const parsed = Number(count);
    if (Number.isFinite(parsed) && parsed >= 0) byPlatform[platform] = parsed;
  }
  const count = (key: string) => {
    const parsed = Number(raw[key]);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  return {
    publishedPosts: count('publishedPosts'),
    failedPosts: count('failedPosts'),
    scheduledPosts: count('scheduledPosts'),
    byPlatform,
  };
}

function toCampaignAnalytics(a: DbCampaignAnalytics): CampaignAnalytics {
  return {
    id: a.id,
    campaignId: a.campaignId,
    projectId: a.projectId,
    metrics: analyticsMetrics(a.metrics),
    unavailable: a.unavailable,
    collectedAt: a.collectedAt.toISOString(),
    note: a.note,
  };
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metricList(value: unknown): MetricKey[] {
  return Array.isArray(value) ? value.filter(isMetricKey) : [];
}

function toAnalyticsAccount(a: DbAnalyticsAccount): AnalyticsAccount {
  return {
    id: a.id,
    userId: a.userId,
    projectId: a.projectId,
    connectionId: a.connectionId,
    platformId: a.platformId,
    externalAccountId: a.externalAccountId ?? undefined,
    externalAccountName: a.externalAccountName ?? undefined,
    metrics: sanitizeStoredMetrics(a.metrics),
    availableMetrics: metricList(a.availableMetrics),
    unavailableMetrics: metricList(a.unavailableMetrics),
    status: a.status as AnalyticsAccount['status'],
    note: a.note ?? undefined,
    lastSyncedAt: a.lastSyncedAt?.toISOString(),
    lastErrorCode: a.lastErrorCode ?? undefined,
    lastErrorMessage: a.lastErrorMessage ?? undefined,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function toAnalyticsPost(p: DbAnalyticsPost): AnalyticsPost {
  return {
    id: p.id,
    userId: p.userId,
    projectId: p.projectId,
    publicationId: p.publicationId,
    draftId: p.draftId,
    campaignId: p.campaignId ?? undefined,
    platformId: p.platformId,
    externalId: p.externalId ?? undefined,
    externalUrl: p.externalUrl ?? undefined,
    publishedAt: p.publishedAt.toISOString(),
    contentType: p.contentType as AnalyticsPost['contentType'],
    topic: p.topic ?? undefined,
    metrics: sanitizeStoredMetrics(p.metrics),
    availableMetrics: metricList(p.availableMetrics),
    unavailableMetrics: metricList(p.unavailableMetrics),
    engagement: typeof p.engagement === 'number' ? p.engagement : null,
    engagementRate: typeof p.engagementRate === 'number' ? p.engagementRate : null,
    engagementRateBasis: p.engagementRateBasis ?? undefined,
    status: p.status as AnalyticsPostStatus,
    note: p.note ?? undefined,
    lastSyncedAt: p.lastSyncedAt?.toISOString(),
    lastErrorCode: p.lastErrorCode ?? undefined,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toAnalyticsSnapshot(s: DbAnalyticsSnapshot): AnalyticsSnapshot {
  return {
    id: s.id,
    userId: s.userId,
    projectId: s.projectId,
    platformId: s.platformId,
    scope: s.scope as AnalyticsSnapshot['scope'],
    analyticsPostId: s.analyticsPostId ?? undefined,
    analyticsAccountId: s.analyticsAccountId ?? undefined,
    dedupeKey: s.dedupeKey,
    metrics: sanitizeStoredMetrics(s.metrics),
    capturedAt: s.capturedAt.toISOString(),
    source: 'api',
    createdAt: s.createdAt.toISOString(),
  };
}

function toAnalyticsSync(s: DbAnalyticsSync): AnalyticsSync {
  return {
    id: s.id,
    userId: s.userId,
    projectId: s.projectId,
    platformId: s.platformId,
    trigger: s.trigger as AnalyticsSync['trigger'],
    status: s.status as AnalyticsSyncStatus,
    startedAt: s.startedAt.toISOString(),
    finishedAt: s.finishedAt?.toISOString(),
    postsRequested: s.postsRequested,
    postsUpdated: s.postsUpdated,
    snapshotsWritten: s.snapshotsWritten,
    errorCode: s.errorCode ?? undefined,
    errorMessage: s.errorMessage ?? undefined,
    createdAt: s.createdAt.toISOString(),
  };
}

function analyticsInsightPayload(value: unknown): AnalyticsInsight['payload'] {
  const raw = jsonRecord(value);
  return raw as unknown as AnalyticsInsight['payload'];
}

function toAnalyticsInsight(i: DbAnalyticsInsight): AnalyticsInsight {
  return {
    id: i.id,
    userId: i.userId,
    projectId: i.projectId,
    campaignId: i.campaignId ?? undefined,
    scope: i.scope as AnalyticsInsightScope,
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
    provider: i.provider,
    model: i.model,
    status: i.status as AnalyticsInsightStatus,
    sampleSize: i.sampleSize,
    promptTokens: i.promptTokens,
    completionTokens: i.completionTokens,
    payload: analyticsInsightPayload(i.payload),
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    acceptedAt: i.acceptedAt?.toISOString(),
  };
}

function toAnalyticsSyncLock(lock: DbAnalyticsSyncLock): AnalyticsSyncLock {
  return {
    key: lock.key,
    ownerToken: lock.ownerToken,
    projectId: lock.projectId,
    platformId: lock.platformId,
    connectionId: lock.connectionId ?? undefined,
    acquiredAt: lock.acquiredAt.toISOString(),
    expiresAt: lock.expiresAt.toISOString(),
    updatedAt: lock.updatedAt.toISOString(),
  };
}

export class Storage {
  private data: StorageData;
  private filePath: string;
  private initialized = false;

  constructor() {
    this.filePath = path.resolve(process.cwd(), 'data', 'crewlink.json');
    this.data = {
      projects: [],
      applicants: [],
      users: {},
      sessions: {},
      drafts: [],
      platformConnections: [],
      publications: [],
      usageLedger: [],
      campaigns: [],
      campaignTasks: [],
      researchSources: [],
      brandProfiles: [],
      contentIdeas: [],
      generatedPosts: [],
      campaignSchedules: [],
      agentExecutions: [],
      campaignAnalytics: [],
      analyticsAccounts: [],
      analyticsPosts: [],
      analyticsSnapshots: [],
      analyticsSyncs: [],
      analyticsInsights: [],
      analyticsSyncLocks: [],
    };
    this.ensureLoaded();
  }

  private isPrismaActive(): boolean {
    const dbUrl = process.env.DATABASE_URL;
    return Boolean(
      dbUrl &&
      (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://')) &&
      process.env.NODE_ENV !== 'test'
    );
  }

  ensureLoaded(): void {
    if (this.initialized) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data = {
          projects: parsed.projects || [],
          applicants: parsed.applicants || [],
          users: parsed.users || {},
          sessions: parsed.sessions || {},
          drafts: parsed.drafts || [],
          platformConnections: parsed.platformConnections || [],
          publications: parsed.publications || [],
          usageLedger: parsed.usageLedger || [],
          campaigns: parsed.campaigns || [],
          campaignTasks: parsed.campaignTasks || [],
          researchSources: parsed.researchSources || [],
          brandProfiles: parsed.brandProfiles || [],
          contentIdeas: parsed.contentIdeas || [],
          generatedPosts: parsed.generatedPosts || [],
          campaignSchedules: parsed.campaignSchedules || [],
          agentExecutions: parsed.agentExecutions || [],
          campaignAnalytics: parsed.campaignAnalytics || [],
          analyticsAccounts: parsed.analyticsAccounts || [],
          analyticsPosts: parsed.analyticsPosts || [],
          analyticsSnapshots: parsed.analyticsSnapshots || [],
          analyticsSyncs: parsed.analyticsSyncs || [],
          analyticsInsights: parsed.analyticsInsights || [],
          analyticsSyncLocks: parsed.analyticsSyncLocks || [],
        };
      } else {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        this.save();
      }
    } catch {
      this.data = {
        projects: [],
        applicants: [],
        users: {},
        sessions: {},
        drafts: [],
        platformConnections: [],
        publications: [],
        usageLedger: [],
        campaigns: [],
        campaignTasks: [],
        researchSources: [],
        brandProfiles: [],
        contentIdeas: [],
        generatedPosts: [],
        campaignSchedules: [],
        agentExecutions: [],
        campaignAnalytics: [],
        analyticsAccounts: [],
        analyticsPosts: [],
        analyticsSnapshots: [],
        analyticsSyncs: [],
        analyticsInsights: [],
        analyticsSyncLocks: [],
      };
    }
    this.initialized = true;
  }

  save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err: unknown) {
      logger.error('Storage save error', err);
    }
  }

  reset(): void {
    this.data = {
      projects: [],
      applicants: [],
      users: {},
      sessions: {},
      drafts: [],
      platformConnections: [],
      publications: [],
      usageLedger: [],
      campaigns: [],
      campaignTasks: [],
      researchSources: [],
      brandProfiles: [],
      contentIdeas: [],
      generatedPosts: [],
      campaignSchedules: [],
      agentExecutions: [],
      campaignAnalytics: [],
      analyticsAccounts: [],
      analyticsPosts: [],
      analyticsSnapshots: [],
      analyticsSyncs: [],
      analyticsInsights: [],
      analyticsSyncLocks: [],
    };
    this.save();
  }

  // --- Users ---
  async saveUser(user: Partial<User> & { id: string | number; login: string }): Promise<User> {
    const id = String(user.id);
    // Never re-encrypt an already-encrypted token; encryptSecret always encrypts now.
    const encryptedToken = user.accessToken
      ? isEncrypted(user.accessToken)
        ? user.accessToken
        : encryptSecret(user.accessToken)
      : user.accessToken === null
        ? null
        : undefined;

    if (this.isPrismaActive()) {
      try {
        const result = await prisma.user.upsert({
          where: { id },
          create: {
            id,
            login: user.login,
            name: user.name || null,
            avatarUrl: user.avatarUrl || null,
            accessToken: encryptedToken || null,
            publicRepos: Number(user.publicRepos) || 0,
            createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
          },
          update: {
            login: user.login,
            name: user.name || null,
            avatarUrl: user.avatarUrl || null,
            ...(encryptedToken !== undefined ? { accessToken: encryptedToken } : {}),
            publicRepos: Number(user.publicRepos) || 0,
          },
        });
        return {
          id: result.id,
          login: result.login,
          name: result.name ?? undefined,
          avatarUrl: result.avatarUrl ?? undefined,
          accessToken: result.accessToken ? decryptSecret(result.accessToken) : undefined,
          publicRepos: result.publicRepos,
          createdAt: result.createdAt.toISOString(),
          updatedAt: result.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma saveUser failed', err, { userId: id });
        throw err;
      }
    }

    this.ensureLoaded();
    const existing = this.data.users[id] || {};
    const updated: User = {
      ...existing,
      ...user,
      id,
      updatedAt: new Date().toISOString(),
    };
    this.data.users[id] = updated;
    this.save();
    return updated;
  }

  async getUser(userId: string | number): Promise<User | null> {
    const id = String(userId);

    if (this.isPrismaActive()) {
      try {
        const user = await prisma.user.findUnique({ where: { id } });
        if (!user) return null;
        return {
          id: user.id,
          login: user.login,
          name: user.name ?? undefined,
          avatarUrl: user.avatarUrl ?? undefined,
          accessToken: user.accessToken ? decryptSecret(user.accessToken) : undefined,
          publicRepos: user.publicRepos,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        };
      } catch (err) {
        logger.error('Prisma getUser failed', err, { userId: id });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.users[id] || null;
  }

  // --- Sessions ---
  async createSession(userId: string | number, maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<string> {
    const id = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + maxAgeMs);
    const uId = String(userId);

    if (this.isPrismaActive()) {
      try {
        await prisma.session.create({
          data: {
            id,
            userId: uId,
            expiresAt,
          },
        });
        return id;
      } catch (err) {
        logger.error('Prisma createSession failed', err, { userId: uId });
        throw err;
      }
    }

    this.ensureLoaded();
    this.data.sessions[id] = {
      userId: uId,
      expiresAt: expiresAt.getTime(),
      createdAt: new Date().toISOString(),
    };
    this.save();
    return id;
  }

  async getSession(sessionId?: string): Promise<{ sessionId: string; user: User } | null> {
    if (!sessionId) return null;

    if (this.isPrismaActive()) {
      try {
        const session = await prisma.session.findUnique({
          where: { id: sessionId },
          include: { user: true },
        });
        if (!session) return null;
        if (Date.now() > session.expiresAt.getTime()) {
          await prisma.session.delete({ where: { id: sessionId } });
          return null;
        }
        return {
          sessionId,
          user: {
            id: session.user.id,
            login: session.user.login,
            name: session.user.name ?? undefined,
            avatarUrl: session.user.avatarUrl ?? undefined,
            accessToken: session.user.accessToken ? decryptSecret(session.user.accessToken) : undefined,
            publicRepos: session.user.publicRepos,
            createdAt: session.user.createdAt.toISOString(),
          },
        };
      } catch (err) {
        logger.error('Prisma getSession failed', err, { sessionId });
        throw err;
      }
    }

    this.ensureLoaded();
    const session = this.data.sessions[sessionId];
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      delete this.data.sessions[sessionId];
      this.save();
      return null;
    }
    const user = await this.getUser(session.userId);
    return user ? { sessionId, user } : null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!sessionId) return;

    if (this.isPrismaActive()) {
      try {
        await prisma.session.deleteMany({ where: { id: sessionId } });
        return;
      } catch (err) {
        logger.error('Prisma deleteSession failed', err, { sessionId });
        throw err;
      }
    }

    this.ensureLoaded();
    if (this.data.sessions[sessionId]) {
      delete this.data.sessions[sessionId];
      this.save();
    }
  }

  // --- Projects ---
  async createProject(project: {
    ownerLogin: string;
    ownerId: string | number;
    ownerAvatar?: string;
    repoFullName: string;
    repoName: string;
    repoOwner: string;
    isPrivate?: boolean;
    joinMode?: JoinMode;
    screeningUrl?: string;
    screeningNote?: string;
    roles?: string[];
    title?: string;
    description?: string;
    creatorNote?: string;
    requireResume?: boolean;
    requireGithubLink?: boolean;
    requireLinkedinLink?: boolean;
    referralCode?: string;
    referralCodeCreatedAt?: string;
    referralCodeExpiresAt?: string;
    referralCodeUsageLimit?: number;
    referralCodeRevokedAt?: string;
    referralCodeUsedAt?: string;
    logoPath?: string;
  }): Promise<Project> {
    const id = `prj_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const baseSlug = (project.repoName || 'project')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';
    const slug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;
    const roles = Array.isArray(project.roles)
      ? project.roles.map(String).map((r) => r.trim()).filter(Boolean).slice(0, 10)
      : [];
    const joinMode: JoinMode =
      project.joinMode === 'screening' ? 'screening' : project.joinMode === 'direct' ? 'direct' : 'referral';
    // --- Referral defaults: every referral project gets one unique reusable code ---
    const referralCode =
      joinMode === 'referral'
        ? normalizeReferralCode(project.referralCode) || (await this.generateUniqueReferralCode())
        : '';
    const referralCodeCreatedAt =
      joinMode === 'referral' ? project.referralCodeCreatedAt || new Date().toISOString() : '';
    const referralCodeExpiresAt =
      joinMode === 'referral' ? project.referralCodeExpiresAt || '' : '';
    const referralCodeUsageLimit =
      joinMode === 'referral' && Number(project.referralCodeUsageLimit) > 0
        ? Number(project.referralCodeUsageLimit)
        : 0;
    const referralCodeRevokedAt =
      joinMode === 'referral' ? project.referralCodeRevokedAt || '' : '';
    const referralCodeUsedAt = joinMode === 'referral' ? project.referralCodeUsedAt || '' : '';

    // --- Prisma path (Supabase) ---
    if (this.isPrismaActive()) {
      try {
        const created = await prisma.project.create({
          data: {
            id,
            slug,
            ownerLogin: project.ownerLogin,
            ownerId: String(project.ownerId),
            ownerAvatar: project.ownerAvatar || null,
            repoFullName: project.repoFullName,
            repoName: project.repoName,
            repoOwner: project.repoOwner,
            isPrivate: Boolean(project.isPrivate),
            joinMode,
            screeningUrl: joinMode === 'screening' ? project.screeningUrl || null : null,
            roles,
            title: project.title || project.repoName,
            description: project.description || null,
            creatorNote: project.creatorNote || null,
            requireResume: Boolean(project.requireResume),
            requireGithubLink: Boolean(project.requireGithubLink),
            requireLinkedinLink: Boolean(project.requireLinkedinLink),
            referralCode: referralCode || null,
            referralCodeCreatedAt: referralCodeCreatedAt ? new Date(referralCodeCreatedAt) : null,
            referralCodeExpiresAt: referralCodeExpiresAt ? new Date(referralCodeExpiresAt) : null,
            referralCodeUsageLimit: referralCodeUsageLimit || null,
            referralCodeRevokedAt: referralCodeRevokedAt ? new Date(referralCodeRevokedAt) : null,
            referralCodeUsedAt: referralCodeUsedAt ? new Date(referralCodeUsedAt) : null,
            logoPath: project.logoPath || null,
          },
        });
        return toProject(created);
      } catch (err) {
        logger.error('Prisma createProject failed', err, { repo: project.repoFullName });
        throw err;
      }
    }

    // --- File-backed path (local dev and tests) ---
    this.ensureLoaded();
    const newProject: Project = {
      id,
      slug,
      ownerLogin: project.ownerLogin,
      ownerId: String(project.ownerId),
      ownerAvatar: project.ownerAvatar || '',
      repoFullName: project.repoFullName,
      repoName: project.repoName,
      repoOwner: project.repoOwner,
      isPrivate: Boolean(project.isPrivate),
      joinMode,
      screeningUrl: joinMode === 'screening' ? project.screeningUrl || '' : '',
      roles,
      title: project.title || project.repoName,
      description: project.description || '',
      creatorNote: project.creatorNote || '',
      requireResume: Boolean(project.requireResume),
      requireGithubLink: Boolean(project.requireGithubLink),
      requireLinkedinLink: Boolean(project.requireLinkedinLink),
      referralCode,
      referralCodeCreatedAt,
      referralCodeExpiresAt,
      referralCodeUsageLimit,
      referralCodeRevokedAt,
      referralCodeUsedAt,
      logoPath: project.logoPath || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.data.projects.push(newProject);
    this.save();
    return newProject;
  }

  async getProjectById(id: string): Promise<Project | null> {
    if (this.isPrismaActive()) {
      try {
        const p = await prisma.project.findUnique({ where: { id } });
        if (!p) return null;
        return toProject(p);
      } catch (err) {
        logger.error('Prisma getProjectById failed', err, { projectId: id });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.projects.find((p) => p.id === id) || null;
  }

  async getProjectBySlug(slug: string): Promise<Project | null> {
    if (this.isPrismaActive()) {
      try {
        const p = await prisma.project.findUnique({ where: { slug } });
        if (!p) return null;
        return toProject(p);
      } catch (err) {
        logger.error('Prisma getProjectBySlug failed', err, { slug });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.projects.find((p) => p.slug === slug) || null;
  }

  async getProjectsByOwner(ownerLogin: string): Promise<Project[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.project.findMany({
          where: { ownerLogin: { equals: ownerLogin, mode: 'insensitive' } },
          orderBy: { createdAt: 'desc' },
        });
        return list.map((p) => toProject(p));
      } catch (err) {
        logger.error('Prisma getProjectsByOwner failed', err, { ownerLogin });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.projects.filter(
      (p) => p.ownerLogin.toLowerCase() === String(ownerLogin).toLowerCase()
    );
  }

  // --- Look up a project by its reusable code (case-insensitive) ---
  async getProjectByReferralCode(code: string): Promise<Project | null> {
    const normalized = normalizeReferralCode(code);
    if (!normalized) return null;

    if (this.isPrismaActive()) {
      try {
        const p = await prisma.project.findUnique({ where: { referralCode: normalized } });
        return p ? toProject(p) : null;
      } catch (err) {
        logger.error('Prisma getProjectByReferralCode failed', err);
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.projects.find((p) => normalizeReferralCode(p.referralCode) === normalized) || null;
  }

  // --- Accept either a project slug or a referral code in the join URL ---
  async getProjectBySlugOrReferralCode(identifier: string): Promise<Project | null> {
    const project = await this.getProjectBySlug(identifier);
    if (project) return project;
    return this.getProjectByReferralCode(identifier);
  }

  // --- Retry generation until no other project owns the code ---
  async generateUniqueReferralCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = generateReferralCode();
      const existing = await this.getProjectByReferralCode(code);
      if (!existing) return code;
    }
    throw new Error('Could not generate a unique referral code.');
  }

  // --- Replace the code and reset revocation/expiry/legacy-used state ---
  // --- Usage starts at 0 because applicants keep the old code they used ---
  async updateProjectReferralCode(id: string, referralCode: string): Promise<Project | null> {
    if (this.isPrismaActive()) {
      try {
        await prisma.project.update({
          where: { id },
          data: {
            referralCode: normalizeReferralCode(referralCode),
            referralCodeCreatedAt: new Date(),
            referralCodeExpiresAt: null,
            referralCodeRevokedAt: null,
            referralCodeUsedAt: null,
          },
        });
        return this.getProjectById(id);
      } catch (err) {
        logger.error('Prisma updateProjectReferralCode failed', err, { projectId: id });
        throw err;
      }
    }

    this.ensureLoaded();
    const project = this.data.projects.find((p) => p.id === id);
    if (!project) return null;
    project.referralCode = normalizeReferralCode(referralCode);
    project.referralCodeCreatedAt = new Date().toISOString();
    project.referralCodeExpiresAt = '';
    project.referralCodeRevokedAt = '';
    project.referralCodeUsedAt = '';
    project.updatedAt = new Date().toISOString();
    this.save();
    return project;
  }

  // --- Change only the optional limit and/or expiry; the code stays the same ---
  async updateProjectReferralSettings(
    id: string,
    settings: ReferralSettings
  ): Promise<Project | null> {
    const hasExpiry = Object.prototype.hasOwnProperty.call(settings, 'expiresAt');
    const hasLimit = Object.prototype.hasOwnProperty.call(settings, 'usageLimit');
    const expiresAt = hasExpiry && settings.expiresAt ? new Date(settings.expiresAt) : null;
    const usageLimit =
      hasLimit && Number(settings.usageLimit) > 0 ? Number(settings.usageLimit) : null;

    if (this.isPrismaActive()) {
      const data: {
        referralCodeExpiresAt?: Date | null;
        referralCodeUsageLimit?: number | null;
      } = {};
      if (hasExpiry) data.referralCodeExpiresAt = expiresAt;
      if (hasLimit) data.referralCodeUsageLimit = usageLimit;
      if (!hasExpiry && !hasLimit) return this.getProjectById(id);

      try {
        await prisma.project.update({ where: { id }, data });
        return this.getProjectById(id);
      } catch (err) {
        logger.error('Prisma updateProjectReferralSettings failed', err, { projectId: id });
        throw err;
      }
    }

    this.ensureLoaded();
    const project = this.data.projects.find((p) => p.id === id);
    if (!project) return null;
    if (hasExpiry) project.referralCodeExpiresAt = expiresAt ? expiresAt.toISOString() : '';
    if (hasLimit) project.referralCodeUsageLimit = usageLimit ?? 0;
    project.updatedAt = new Date().toISOString();
    this.save();
    return project;
  }

  // --- Keep the code for the record but mark it unusable immediately ---
  async revokeProjectReferralCode(id: string): Promise<Project | null> {
    if (this.isPrismaActive()) {
      try {
        await prisma.project.update({
          where: { id },
          data: { referralCodeRevokedAt: new Date() },
        });
        return this.getProjectById(id);
      } catch (err) {
        logger.error('Prisma revokeProjectReferralCode failed', err, { projectId: id });
        throw err;
      }
    }

    this.ensureLoaded();
    const project = this.data.projects.find((p) => p.id === id);
    if (!project) return null;
    project.referralCodeRevokedAt = new Date().toISOString();
    project.updatedAt = new Date().toISOString();
    this.save();
    return project;
  }

  // --- Usage count: applicants whose stored code matches the current code ---
  async countApplicantsByReferralCode(projectId: string, code: string): Promise<number> {
    const normalized = normalizeReferralCode(code);
    if (!normalized) return 0;

    if (this.isPrismaActive()) {
      try {
        return await prisma.applicant.count({
          where: { projectId, referralCode: normalized },
        });
      } catch (err) {
        logger.error('Prisma countApplicantsByReferralCode failed', err, { projectId });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.applicants.filter(
      (a) => a.projectId === projectId && normalizeReferralCode(a.referralCode) === normalized
    ).length;
  }

  async deleteProject(id: string): Promise<boolean> {
    if (this.isPrismaActive()) {
      try {
        // Applicants, drafts and platform connections cascade via the schema's onDelete rules.
        await prisma.project.delete({ where: { id } });
        return true;
      } catch (err) {
        logger.error('Prisma deleteProject failed', err, { projectId: id });
        throw err;
      }
    }

    this.ensureLoaded();
    const exists = this.data.projects.some((p) => p.id === id);
    if (!exists) return false;
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    this.data.applicants = this.data.applicants.filter((a) => a.projectId !== id);
    this.data.drafts = this.data.drafts.filter((d) => d.projectId !== id);
    this.data.platformConnections = this.data.platformConnections.filter(
      (c) => c.projectId !== id
    );
    this.data.publications = this.data.publications.filter((p) => p.projectId !== id);
    this.data.analyticsAccounts = this.data.analyticsAccounts.filter((a) => a.projectId !== id);
    this.data.analyticsPosts = this.data.analyticsPosts.filter((p) => p.projectId !== id);
    this.data.analyticsSnapshots = this.data.analyticsSnapshots.filter(
      (s) => s.projectId !== id
    );
    this.data.analyticsSyncs = this.data.analyticsSyncs.filter((s) => s.projectId !== id);
    this.data.analyticsInsights = this.data.analyticsInsights.filter(
      (i) => i.projectId !== id
    );
    this.data.analyticsSyncLocks = this.data.analyticsSyncLocks.filter(
      (lock) => lock.projectId !== id
    );
    this.save();
    return true;
  }

  // Used only by the token-authenticated analytics scheduler. It never exposes
  // connections or tokens; the caller resolves the owner and syncs through the
  // normal owner/project path.
  async listProjectsWithAnalyticsConnections(): Promise<Project[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.project.findMany({
          where: { platformConnections: { some: { status: 'active' } } },
          orderBy: { createdAt: 'asc' },
        });
        return list.map(toProject);
      } catch (err) {
        logger.error('Prisma listProjectsWithAnalyticsConnections failed', err);
        throw err;
      }
    }
    this.ensureLoaded();
    const ids = new Set(
      this.data.platformConnections
        .filter((connection) => connection.status === 'active')
        .map((connection) => connection.projectId)
    );
    return this.data.projects.filter((project) => ids.has(project.id));
  }

  async listProjects(): Promise<Project[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
        return list.map((p) => toProject(p));
      } catch (err) {
        logger.error('Prisma listProjects failed', err);
        throw err;
      }
    }

    this.ensureLoaded();
    return [...this.data.projects];
  }

  // --- Applicants ---
  async createApplicant(applicant: {
    projectId: string;
    userId: string | number;
    userLogin: string;
    userAvatar?: string;
    accountAge: string;
    publicRepoCount: number;
    message?: string;
    githubUrl?: string;
    linkedinUrl?: string;
    proofUrl?: string;
    resumeFileName?: string;
    resumePath?: string;
    referralCode?: string;
  }): Promise<Applicant> {
    const id = `app_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const userId = String(applicant.userId);
    const referralCode = normalizeReferralCode(applicant.referralCode) || null;
    const proofDetails = {
      proofUrl: applicant.proofUrl || null,
      linkedinUrl: applicant.linkedinUrl || null,
    };

    if (this.isPrismaActive()) {
      try {
        const created = await prisma.applicant.create({
          data: {
            id,
            projectId: applicant.projectId,
            userId,
            userLogin: applicant.userLogin,
            userAvatar: applicant.userAvatar || null,
            accountAge: applicant.accountAge || 'Unknown',
            publicRepoCount: Number(applicant.publicRepoCount) || 0,
            message: applicant.message || null,
            githubUrl: applicant.githubUrl || null,
            linkedinUrl: applicant.linkedinUrl || null,
            resumeFileName: applicant.resumeFileName || null,
            resumePath: applicant.resumePath || null,
            referralCode,
            status: 'pending',
            invitationSent: false,
            invitationDetails: proofDetails,
          },
        });
        return toApplicant(created);
      } catch (err) {
        logger.error('Prisma createApplicant failed', err, { projectId: applicant.projectId, userId });
        throw err;
      }
    }

    this.ensureLoaded();
    const newApplicant: Applicant = {
      id,
      projectId: applicant.projectId,
      userId,
      userLogin: applicant.userLogin,
      userAvatar: applicant.userAvatar || '',
      accountAge: applicant.accountAge || 'Unknown',
      publicRepoCount: Number(applicant.publicRepoCount) || 0,
      message: applicant.message || '',
      githubUrl: applicant.githubUrl || '',
      linkedinUrl: applicant.linkedinUrl || '',
      proofUrl: applicant.proofUrl || undefined,
      resumeFileName: applicant.resumeFileName || '',
      resumePath: applicant.resumePath || '',
      referralCode: referralCode ?? undefined,
      status: 'pending',
      invitationSent: false,
      invitationDetails: proofDetails,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.data.applicants.push(newApplicant);
    this.save();
    return newApplicant;
  }

  async getApplicantById(id: string): Promise<Applicant | null> {
    if (this.isPrismaActive()) {
      try {
        const a = await prisma.applicant.findUnique({ where: { id } });
        if (!a) return null;
        return toApplicant(a);
      } catch (err) {
        logger.error('Prisma getApplicantById failed', err, { applicantId: id });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.applicants.find((a) => a.id === id) || null;
  }

  async getApplicantsByProject(projectId: string): Promise<Applicant[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.applicant.findMany({
          where: { projectId },
          orderBy: { createdAt: 'desc' },
        });
        return list.map((a) => toApplicant(a));
      } catch (err) {
        logger.error('Prisma getApplicantsByProject failed', err, { projectId });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.applicants.filter((a) => a.projectId === projectId);
  }

  async getApplicantsByUser(userId: string | number): Promise<Applicant[]> {
    const uId = String(userId);

    if (this.isPrismaActive()) {
      try {
        const list = await prisma.applicant.findMany({
          where: { userId: uId },
          orderBy: { createdAt: 'desc' },
        });
        return list.map((a) => toApplicant(a));
      } catch (err) {
        logger.error('Prisma getApplicantsByUser failed', err, { userId: uId });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.applicants.filter((a) => a.userId === uId);
  }

  async getApplicationsByUserId(userId: string | number): Promise<Array<Applicant & { project: Project }>> {
    const applicants = await this.getApplicantsByUser(userId);
    const withProjects = await Promise.all(
      applicants.map(async (applicant) => {
        const project = await this.getProjectById(applicant.projectId);
        return project ? { ...applicant, project } : null;
      })
    );
    return withProjects
      .filter((item): item is Applicant & { project: Project } => item !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async findApplicant(projectId: string, userId: string | number): Promise<Applicant | null> {
    const uId = String(userId);

    if (this.isPrismaActive()) {
      try {
        const a = await prisma.applicant.findUnique({
          where: { projectId_userId: { projectId, userId: uId } },
        });
        if (!a) return null;
        return toApplicant(a);
      } catch (err) {
        logger.error('Prisma findApplicant failed', err, { projectId, userId: uId });
        throw err;
      }
    }

    this.ensureLoaded();
    return (
      this.data.applicants.find(
        (a) => a.projectId === projectId && a.userId === uId
      ) || null
    );
  }

  async updateApplicantStatus(
    id: string,
    status: 'pending' | 'approved' | 'rejected',
    details: unknown = null
  ): Promise<Applicant | null> {
    if (this.isPrismaActive()) {
      try {
        const existing = await prisma.applicant.findUnique({ where: { id } });
        const existingDetails = (existing?.invitationDetails && typeof existing.invitationDetails === 'object')
          ? (existing.invitationDetails as Record<string, unknown>)
          : {};
        const mergedDetails = details ? { ...existingDetails, invitation: details } : existingDetails;

        const updated = await prisma.applicant.update({
          where: { id },
          data: {
            status,
            invitationDetails: mergedDetails as any,
          },
        });
        return toApplicant(updated);
      } catch (err) {
        logger.error('Prisma updateApplicantStatus failed', err, { applicantId: id, status });
        throw err;
      }
    }

    this.ensureLoaded();
    const app = this.data.applicants.find((a) => a.id === id);
    if (!app) return null;
    app.status = status;
    const existingDetails = (app.invitationDetails && typeof app.invitationDetails === 'object')
      ? (app.invitationDetails as Record<string, unknown>)
      : {};
    app.invitationDetails = details ? { ...existingDetails, invitation: details } : existingDetails;
    app.updatedAt = new Date().toISOString();
    this.save();
    return app;
  }

  // --- Drafts ---
  async createDraft(draft: {
    projectId: string;
    platformId: string;
    text: string;
    threadParts?: string[];
    title?: string;
    subreddit?: string;
    submissionType?: 'self' | 'link';
    linkUrl?: string;
    campaignId?: string;
    contentIdeaId?: string;
  }): Promise<Draft> {
    const id = `drf_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

    if (this.isPrismaActive()) {
      try {
        const created = await prisma.draft.create({
          data: {
            id,
            projectId: draft.projectId,
            platformId: draft.platformId,
            text: draft.text,
            threadParts: draft.threadParts ?? Prisma.DbNull,
            title: draft.title ?? null,
            subreddit: draft.subreddit ?? null,
            submissionType: draft.submissionType ?? null,
            linkUrl: draft.linkUrl ?? null,
            campaignId: draft.campaignId ?? null,
            contentIdeaId: draft.contentIdeaId ?? null,
            status: 'drafted',
          },
        });
        return toDraft(created);
      } catch (err) {
        logger.error('Prisma createDraft failed', err, { projectId: draft.projectId });
        throw err;
      }
    }

    this.ensureLoaded();
    const newDraft: Draft = {
      id,
      projectId: draft.projectId,
      platformId: draft.platformId,
      text: draft.text,
      threadParts: draft.threadParts ? [...draft.threadParts] : undefined,
      title: draft.title,
      subreddit: draft.subreddit,
      submissionType: draft.submissionType,
      linkUrl: draft.linkUrl,
      campaignId: draft.campaignId,
      contentIdeaId: draft.contentIdeaId,
      status: 'drafted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.data.drafts.push(newDraft);
    this.save();
    return newDraft;
  }

  async getDraftsByProject(projectId: string): Promise<Draft[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.draft.findMany({
          where: { projectId },
          orderBy: { createdAt: 'desc' },
        });
        return list.map((d) => toDraft(d));
      } catch (err) {
        logger.error('Prisma getDraftsByProject failed', err, { projectId });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.drafts.filter((d) => d.projectId === projectId);
  }

  async getDraftsByCampaign(campaignId: string): Promise<Draft[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.draft.findMany({
          where: { campaignId },
          orderBy: { createdAt: 'asc' },
        });
        return list.map((d) => toDraft(d));
      } catch (err) {
        logger.error('Prisma getDraftsByCampaign failed', err, { campaignId });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.drafts.filter((d) => d.campaignId === campaignId);
  }

  async getDraftById(id: string): Promise<Draft | null> {
    if (this.isPrismaActive()) {
      try {
        const d = await prisma.draft.findUnique({ where: { id } });
        if (!d) return null;
        return toDraft(d);
      } catch (err) {
        logger.error('Prisma getDraftById failed', err, { id });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.drafts.find((d) => d.id === id) || null;
  }

  async updateDraft(
    id: string,
    text: string,
    threadParts?: string[] | null,
    reddit?: {
      title?: string | null;
      subreddit?: string | null;
      submissionType?: 'self' | 'link' | null;
      linkUrl?: string | null;
    },
    textLimit = 10000
  ): Promise<Draft | null> {
    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.draft.update({
          where: { id },
          data: {
            text: text.slice(0, textLimit),
            threadParts: threadParts ? threadParts : Prisma.DbNull,
            ...(reddit
              ? {
                  title: reddit.title || null,
                  subreddit: reddit.subreddit || null,
                  submissionType: reddit.submissionType || null,
                  linkUrl: reddit.linkUrl || null,
                }
              : {}),
            status: 'edited',
            approvedText: null,
            approvedHash: null,
            approvedAt: null,
            approvedBy: null,
          },
        });
        return {
          ...toDraft(updated),
          status: 'edited',
        };
      } catch (err) {
        logger.error('Prisma updateDraft failed', err, { id });
        throw err;
      }
    }

    this.ensureLoaded();
    const draft = this.data.drafts.find((d) => d.id === id);
    if (!draft) return null;
    draft.text = text.slice(0, textLimit);
    draft.threadParts = threadParts ? [...threadParts] : undefined;
    if (reddit) {
      draft.title = reddit.title || undefined;
      draft.subreddit = reddit.subreddit || undefined;
      draft.submissionType = reddit.submissionType || undefined;
      draft.linkUrl = reddit.linkUrl || undefined;
    }
    draft.status = 'edited';
    delete draft.approvedText;
    delete draft.approvedHash;
    delete draft.approvedAt;
    delete draft.approvedBy;
    draft.updatedAt = new Date().toISOString();
    this.save();
    return draft;
  }

  async approveDraft(
    id: string,
    approvedBy: string,
    approval?: { approvedText?: string; approvedHash?: string }
  ): Promise<Draft | null> {
    const draft = await this.getDraftById(id);
    if (!draft) return null;

    const approvedText = approval?.approvedText ?? draft.text;
    const approvedHash =
      approval?.approvedHash ?? crypto.createHash('sha256').update(draft.text).digest('hex');
    const now = new Date();

    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.draft.update({
          where: { id },
          data: {
            status: 'approved',
            approvedText,
            approvedHash,
            approvedAt: now,
            approvedBy,
          },
        });
        return {
          ...toDraft(updated),
          status: 'approved',
        };
      } catch (err) {
        logger.error('Prisma approveDraft failed', err, { id });
        throw err;
      }
    }

    draft.status = 'approved';
    draft.approvedText = approvedText;
    draft.approvedHash = approvedHash;
    draft.approvedAt = now.toISOString();
    draft.approvedBy = approvedBy;
    draft.updatedAt = now.toISOString();
    this.save();
    return draft;
  }

  async skipDraft(id: string): Promise<Draft | null> {
    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.draft.update({
          where: { id },
          data: { status: 'skipped' },
        });
        return {
          ...toDraft(updated),
          status: 'skipped',
        };
      } catch (err) {
        logger.error('Prisma skipDraft failed', err, { id });
        throw err;
      }
    }

    this.ensureLoaded();
    const draft = this.data.drafts.find((d) => d.id === id);
    if (!draft) return null;
    draft.status = 'skipped';
    draft.updatedAt = new Date().toISOString();
    this.save();
    return draft;
  }

  // --- Platform connections ---
  // Tokens are only ever written already encrypted. Every read here returns the
  // ciphertext envelope; src/posting/connections.ts is the only decrypting caller.

  async findPlatformConnection(
    userId: string,
    projectId: string,
    platformId: string
  ): Promise<StoredPlatformConnection | null> {
    if (this.isPrismaActive()) {
      try {
        const connection = await prisma.platformConnection.findUnique({
          where: { userId_platformId_projectId: { userId, platformId, projectId } },
        });
        return connection ? toStoredConnection(connection) : null;
      } catch (err) {
        logger.error('Prisma findPlatformConnection failed', err, { userId, projectId, platformId });
        throw err;
      }
    }

    this.ensureLoaded();
    // Prisma can hold only one row per (userId, platformId, projectId). Legacy
    // file data may contain duplicates, so prefer the active row instead of
    // letting a stale disconnected one shadow a live connection.
    const matches = this.data.platformConnections.filter(
      (c) => c.userId === userId && c.projectId === projectId && c.platformId === platformId
    );
    const found = matches.find((c) => c.status === 'active') || matches[0];
    return found ? copyStoredConnection(found) : null;
  }

  // OAuth callbacks only carry the raw state; storage holds its sha256 hash.
  async findPlatformConnectionByOAuthState(
    stateHash: string
  ): Promise<StoredPlatformConnection | null> {
    if (this.isPrismaActive()) {
      try {
        const connection = await prisma.platformConnection.findUnique({
          where: { oauthStateHash: stateHash },
        });
        return connection ? toStoredConnection(connection) : null;
      } catch (err) {
        logger.error('Prisma findPlatformConnectionByOAuthState failed', err);
        throw err;
      }
    }

    this.ensureLoaded();
    const found = this.data.platformConnections.find((c) => c.oauthStateHash === stateHash);
    return found ? copyStoredConnection(found) : null;
  }

  async getPlatformConnectionById(id: string): Promise<StoredPlatformConnection | null> {
    if (this.isPrismaActive()) {
      try {
        const connection = await prisma.platformConnection.findUnique({ where: { id } });
        return connection ? toStoredConnection(connection) : null;
      } catch (err) {
        logger.error('Prisma getPlatformConnectionById failed', err, { connectionId: id });
        throw err;
      }
    }

    this.ensureLoaded();
    const found = this.data.platformConnections.find((c) => c.id === id);
    return found ? copyStoredConnection(found) : null;
  }

  async listPlatformConnections(
    userId: string,
    projectId?: string
  ): Promise<StoredPlatformConnection[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.platformConnection.findMany({
          where: { userId, ...(projectId ? { projectId } : {}) },
          orderBy: { platformId: 'asc' },
        });
        return list.map(toStoredConnection);
      } catch (err) {
        logger.error('Prisma listPlatformConnections failed', err, { userId, projectId });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.platformConnections
      .filter((c) => c.userId === userId && (!projectId || c.projectId === projectId))
      .sort((a, b) => a.platformId.localeCompare(b.platformId))
      .map(copyStoredConnection);
  }

  async upsertPlatformConnection(
    connection: StoredPlatformConnection
  ): Promise<StoredPlatformConnection> {
    const now = new Date().toISOString();

    if (this.isPrismaActive()) {
      const data = {
        externalAccountId: connection.externalAccountId || null,
        externalAccountName: connection.externalAccountName || null,
        serverId: connection.serverId || null,
        serverName: connection.serverName || null,
        channelId: connection.channelId || null,
        channelName: connection.channelName || null,
        instanceUrl: connection.instanceUrl || null,
        status: connection.status,
        scopes: connection.scopes,
        tokenExpiresAt: connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt) : null,
        accessTokenCiphertext: connection.accessTokenCiphertext,
        refreshTokenCiphertext: connection.refreshTokenCiphertext || null,
        credentialProvider: connection.credentialProvider,
        keyRef: connection.keyRef,
        oauthStateHash: connection.oauthStateHash || null,
        oauthStateExpiresAt: connection.oauthStateExpiresAt
          ? new Date(connection.oauthStateExpiresAt)
          : null,
        pendingOAuthCiphertext: connection.pendingOAuthCiphertext || null,
      };
      try {
        const saved = await prisma.platformConnection.upsert({
          where: { id: connection.id },
          create: {
            id: connection.id,
            userId: connection.userId,
            projectId: connection.projectId,
            platformId: connection.platformId,
            ...data,
          },
          update: data,
        });
        return toStoredConnection(saved);
      } catch (err) {
        logger.error('Prisma upsertPlatformConnection failed', err, {
          connectionId: connection.id,
        });
        throw err;
      }
    }

    this.ensureLoaded();
    // Prisma keeps one row per (userId, platformId, projectId) via a unique
    // constraint: a reconnect reuses the existing connection. The file store
    // must match, or a duplicate row can shadow the live connection in reads.
    const tupleIndex = this.data.platformConnections.findIndex(
      (c) =>
        c.userId === connection.userId &&
        c.platformId === connection.platformId &&
        c.projectId === connection.projectId
    );
    const index = tupleIndex >= 0
      ? tupleIndex
      : this.data.platformConnections.findIndex((c) => c.id === connection.id);
    const existing =
      index >= 0 ? this.data.platformConnections[index] : undefined;
    const saved: StoredPlatformConnection = {
      ...connection,
      id: index >= 0 ? existing!.id : connection.id,
      createdAt: index >= 0 ? existing!.createdAt : connection.createdAt || now,
      updatedAt: now,
    };
    if (index >= 0) {
      this.data.platformConnections[index] = saved;
    } else {
      this.data.platformConnections.push(saved);
    }
    this.save();
    return copyStoredConnection(saved);
  }

  // Atomically consumes an OAuth state: exactly one caller can clear a given
  // hash. The pending ciphertext is read before this call; the winner is the only
  // request allowed to exchange the authorization code.
  async claimOAuthState(stateHash: string): Promise<boolean> {
    if (this.isPrismaActive()) {
      try {
        const result = await prisma.platformConnection.updateMany({
          where: { oauthStateHash: stateHash },
          data: {
            oauthStateHash: null,
            oauthStateExpiresAt: null,
            pendingOAuthCiphertext: null,
          },
        });
        return result.count === 1;
      } catch (err) {
        logger.error('Prisma claimOAuthState failed', err);
        throw err;
      }
    }

    this.ensureLoaded();
    const connection = this.data.platformConnections.find(
      (c) => c.oauthStateHash === stateHash
    );
    if (!connection) return false;
    delete connection.oauthStateHash;
    delete connection.oauthStateExpiresAt;
    delete connection.pendingOAuthCiphertext;
    connection.updatedAt = new Date().toISOString();
    this.save();
    return true;
  }

  // After a consumed handshake fails, mark a still-pending connection as
  // disconnected. A newer handshake (non-null state hash) or an active
  // connection is left alone, so stale cleanup cannot erase newer state.
  async finishOAuthFailure(connectionId: string): Promise<boolean> {
    if (this.isPrismaActive()) {
      try {
        const result = await prisma.platformConnection.updateMany({
          where: { id: connectionId, status: 'pending', oauthStateHash: null },
          data: { status: 'disconnected' },
        });
        return result.count === 1;
      } catch (err) {
        logger.error('Prisma finishOAuthFailure failed', err, { connectionId });
        throw err;
      }
    }

    this.ensureLoaded();
    const connection = this.data.platformConnections.find((c) => c.id === connectionId);
    if (!connection || connection.status !== 'pending' || connection.oauthStateHash) {
      return false;
    }
    connection.status = 'disconnected';
    connection.updatedAt = new Date().toISOString();
    this.save();
    return true;
  }

  // Metadata-only update used by verification. It never writes token fields, so
  // it cannot clobber a concurrent refresh.
  async updatePlatformConnectionAccount(
    id: string,
    account: { externalAccountId: string; externalAccountName: string; instanceUrl?: string }
  ): Promise<StoredPlatformConnection | null> {
    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.platformConnection.update({
          where: { id },
          data: {
            externalAccountId: account.externalAccountId || null,
            externalAccountName: account.externalAccountName || null,
            ...(account.instanceUrl !== undefined
              ? { instanceUrl: account.instanceUrl || null }
              : {}),
          },
        });
        return toStoredConnection(updated);
      } catch (err) {
        if ((err as { code?: string }).code === 'P2025') return null;
        logger.error('Prisma updatePlatformConnectionAccount failed', err, {
          connectionId: id,
        });
        throw err;
      }
    }

    this.ensureLoaded();
    const connection = this.data.platformConnections.find((c) => c.id === id);
    if (!connection) return null;
    connection.externalAccountId = account.externalAccountId || undefined;
    connection.externalAccountName = account.externalAccountName || undefined;
    if (account.instanceUrl !== undefined) {
      connection.instanceUrl = account.instanceUrl || undefined;
    }
    connection.updatedAt = new Date().toISOString();
    this.save();
    return copyStoredConnection(connection);
  }

  // Channel selection is the publish destination, so it is updated on its own
  // without touching tokens. A disconnected record cannot be re-pointed.
  async updatePlatformConnectionChannel(
    id: string,
    channel: { channelId: string; channelName: string }
  ): Promise<StoredPlatformConnection | null> {
    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.platformConnection.updateMany({
          where: { id, status: 'active' },
          data: {
            channelId: channel.channelId || null,
            channelName: channel.channelName || null,
          },
        });
        if (updated.count !== 1) return null;
        const saved = await prisma.platformConnection.findUnique({ where: { id } });
        return saved ? toStoredConnection(saved) : null;
      } catch (err) {
        logger.error('Prisma updatePlatformConnectionChannel failed', err, {
          connectionId: id,
        });
        throw err;
      }
    }

    this.ensureLoaded();
    const connection = this.data.platformConnections.find((c) => c.id === id);
    if (!connection || connection.status !== 'active') return null;
    connection.channelId = channel.channelId || undefined;
    connection.channelName = channel.channelName || undefined;
    connection.updatedAt = new Date().toISOString();
    this.save();
    return copyStoredConnection(connection);
  }

  // Compare-and-set token persistence. A refresh that started from an older
  // session cannot overwrite tokens another request already saved, and tokens
  // are never restored onto a connection that was disconnected meanwhile.
  async updatePlatformConnectionTokens(input: {
    id: string;
    expectedAccessTokenCiphertext: string;
    accessTokenCiphertext: string;
    refreshTokenCiphertext?: string | null;
    tokenExpiresAt?: string | null;
    credentialProvider: StoredPlatformConnection['credentialProvider'];
    keyRef: string;
  }): Promise<StoredPlatformConnection | null> {
    if (this.isPrismaActive()) {
      try {
        const result = await prisma.platformConnection.updateMany({
          where: {
            id: input.id,
            status: 'active',
            accessTokenCiphertext: input.expectedAccessTokenCiphertext,
          },
          data: {
            accessTokenCiphertext: input.accessTokenCiphertext,
            credentialProvider: input.credentialProvider,
            keyRef: input.keyRef,
            ...(input.refreshTokenCiphertext !== undefined
              ? { refreshTokenCiphertext: input.refreshTokenCiphertext || null }
              : {}),
            ...(input.tokenExpiresAt !== undefined
              ? {
                  tokenExpiresAt: input.tokenExpiresAt
                    ? new Date(input.tokenExpiresAt)
                    : null,
                }
              : {}),
          },
        });
        if (result.count !== 1) return null;
        const updated = await prisma.platformConnection.findUnique({
          where: { id: input.id },
        });
        return updated ? toStoredConnection(updated) : null;
      } catch (err) {
        logger.error('Prisma updatePlatformConnectionTokens failed', err, {
          connectionId: input.id,
        });
        throw err;
      }
    }

    this.ensureLoaded();
    const connection = this.data.platformConnections.find((c) => c.id === input.id);
    if (
      !connection ||
      connection.status !== 'active' ||
      connection.accessTokenCiphertext !== input.expectedAccessTokenCiphertext
    ) {
      return null;
    }
    connection.accessTokenCiphertext = input.accessTokenCiphertext;
    if (input.refreshTokenCiphertext !== undefined) {
      if (input.refreshTokenCiphertext) {
        connection.refreshTokenCiphertext = input.refreshTokenCiphertext;
      } else {
        delete connection.refreshTokenCiphertext;
      }
    }
    if (input.tokenExpiresAt !== undefined) {
      if (input.tokenExpiresAt) {
        connection.tokenExpiresAt = input.tokenExpiresAt;
      } else {
        delete connection.tokenExpiresAt;
      }
    }
    connection.credentialProvider = input.credentialProvider;
    connection.keyRef = input.keyRef;
    connection.updatedAt = new Date().toISOString();
    this.save();
    return copyStoredConnection(connection);
  }

  // Disconnecting wipes the encrypted token material but keeps the record so the
  // same connection can be re-authorised later.
  async disconnectPlatformConnection(id: string): Promise<boolean> {
    if (this.isPrismaActive()) {
      try {
        const existing = await prisma.platformConnection.findUnique({ where: { id } });
        if (!existing) return false;
        await prisma.platformConnection.update({
          where: { id },
          data: {
            status: 'disconnected',
            accessTokenCiphertext: '',
            refreshTokenCiphertext: null,
            tokenExpiresAt: null,
            keyRef: '',
            oauthStateHash: null,
            oauthStateExpiresAt: null,
            pendingOAuthCiphertext: null,
          },
        });
        return true;
      } catch (err) {
        logger.error('Prisma disconnectPlatformConnection failed', err, { connectionId: id });
        throw err;
      }
    }

    this.ensureLoaded();
    const connection = this.data.platformConnections.find((c) => c.id === id);
    if (!connection) return false;
    connection.status = 'disconnected';
    connection.accessTokenCiphertext = '';
    delete connection.refreshTokenCiphertext;
    delete connection.tokenExpiresAt;
    connection.keyRef = '';
    delete connection.oauthStateHash;
    delete connection.oauthStateExpiresAt;
    delete connection.pendingOAuthCiphertext;
    connection.updatedAt = new Date().toISOString();
    this.save();
    return true;
  }

  // --- Publications ---
  // One row per (draft, platform). The unique index is what stops the same
  // approved draft being sent twice to the same destination.

  // Analytics sync reads publications in bulk; publishing itself never needs
  // this listing, so the publish engine is unaffected.
  async listPublicationsByProject(
    projectId: string,
    platformId?: string
  ): Promise<Publication[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.publication.findMany({
          where: { projectId, ...(platformId ? { platformId } : {}) },
          orderBy: { createdAt: 'desc' },
        });
        return list.map(toPublication);
      } catch (err) {
        logger.error('Prisma listPublicationsByProject failed', err, { projectId, platformId });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.publications
      .filter((p) => p.projectId === projectId && (!platformId || p.platformId === platformId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => ({ ...p, externalIds: [...(p.externalIds || [])] }));
  }

  async getPublication(draftId: string, platformId: string): Promise<Publication | null> {
    if (this.isPrismaActive()) {
      try {
        const found = await prisma.publication.findUnique({
          where: { draftId_platformId: { draftId, platformId } },
        });
        return found ? toPublication(found) : null;
      } catch (err) {
        logger.error('Prisma getPublication failed', err, { draftId, platformId });
        throw err;
      }
    }

    this.ensureLoaded();
    return (
      this.data.publications.find((p) => p.draftId === draftId && p.platformId === platformId) ||
      null
    );
  }

  async createPublicationIfAbsent(
    publication: Publication
  ): Promise<{ created: boolean; publication: Publication }> {
    if (this.isPrismaActive()) {
      try {
        const created = await prisma.publication.create({
          data: {
            id: publication.id,
            userId: publication.userId,
            projectId: publication.projectId,
            draftId: publication.draftId,
            connectionId: publication.connectionId ?? null,
            platformId: publication.platformId,
            status: publication.status,
            mode: publication.mode,
            contentHash: publication.contentHash,
            externalId: publication.externalId || null,
            externalIds: publication.externalIds ?? [],
            ...(publication.targetName ? { targetName: publication.targetName } : {}),
            ...(publication.externalUrl ? { externalUrl: publication.externalUrl } : {}),
            errorCode: publication.errorCode || null,
            confirmedAt: publication.confirmedAt ? new Date(publication.confirmedAt) : null,
          },
        });
        return { created: true, publication: toPublication(created) };
      } catch (err) {
        // P2002 = unique violation: another request already claimed this draft.
        if ((err as { code?: string }).code === 'P2002') {
          const existing = await this.getPublication(publication.draftId, publication.platformId);
          if (existing) return { created: false, publication: existing };
        }
        logger.error('Prisma createPublicationIfAbsent failed', err, {
          draftId: publication.draftId,
          platformId: publication.platformId,
        });
        throw err;
      }
    }

    this.ensureLoaded();
    const existing = this.data.publications.find(
      (p) => p.draftId === publication.draftId && p.platformId === publication.platformId
    );
    if (existing) return { created: false, publication: existing };

    this.data.publications.push(publication);
    this.save();
    return { created: true, publication };
  }

  // Atomically takes a failed, never-sent publication back to `sending`. Two
  // concurrent retries (even on different instances) can never both win: the
  // conditional update only matches while the row is still failed and has no
  // external id.
  async claimFailedPublication(id: string): Promise<Publication | null> {
    if (this.isPrismaActive()) {
      try {
        const result = await prisma.publication.updateMany({
          where: { id, status: 'failed', externalId: null },
          data: { status: 'sending', errorCode: null },
        });
        if (result.count !== 1) return null;
        const updated = await prisma.publication.findUnique({ where: { id } });
        return updated ? toPublication(updated) : null;
      } catch (err) {
        logger.error('Prisma claimFailedPublication failed', err, { id });
        throw err;
      }
    }

    this.ensureLoaded();
    const publication = this.data.publications.find((p) => p.id === id);
    if (!publication || publication.status !== 'failed' || publication.externalId) return null;
    publication.status = 'sending';
    publication.errorCode = undefined;
    publication.updatedAt = new Date().toISOString();
    this.save();
    return publication;
  }

  // Changing the destination is a publishing-options change: every approved
  // draft for that project and platform must be approved again.
  async invalidateDraftApprovals(projectId: string, platformId: string): Promise<number> {
    if (this.isPrismaActive()) {
      try {
        const result = await prisma.draft.updateMany({
          where: { projectId, platformId, status: 'approved' },
          data: {
            status: 'drafted',
            approvedText: null,
            approvedHash: null,
            approvedAt: null,
            approvedBy: null,
          },
        });
        return result.count;
      } catch (err) {
        logger.error('Prisma invalidateDraftApprovals failed', err, { projectId, platformId });
        throw err;
      }
    }

    this.ensureLoaded();
    let count = 0;
    for (const draft of this.data.drafts) {
      if (draft.projectId !== projectId || draft.platformId !== platformId) continue;
      if (draft.status !== 'approved') continue;
      draft.status = 'drafted';
      delete draft.approvedText;
      delete draft.approvedHash;
      delete draft.approvedAt;
      delete draft.approvedBy;
      draft.updatedAt = new Date().toISOString();
      count += 1;
    }
    if (count > 0) this.save();
    return count;
  }

  async updatePublication(
    id: string,
    patch: Partial<
      Pick<
        Publication,
        | 'status'
        | 'externalId'
        | 'externalIds'
        | 'targetName'
        | 'externalUrl'
        | 'errorCode'
        | 'mode'
        | 'confirmedAt'
        | 'connectionId'
      >
    >
  ): Promise<Publication | null> {
    const data = {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.externalId !== undefined ? { externalId: patch.externalId || null } : {}),
      ...(patch.externalIds !== undefined ? { externalIds: patch.externalIds } : {}),
      ...(patch.targetName !== undefined ? { targetName: patch.targetName || null } : {}),
      ...(patch.externalUrl !== undefined ? { externalUrl: patch.externalUrl || null } : {}),
      ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode || null } : {}),
      ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
      ...(patch.confirmedAt !== undefined
        ? { confirmedAt: patch.confirmedAt ? new Date(patch.confirmedAt) : null }
        : {}),
      ...(patch.connectionId !== undefined ? { connectionId: patch.connectionId || null } : {}),
    };

    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.publication.update({ where: { id }, data });
        return toPublication(updated);
      } catch (err) {
        logger.error('Prisma updatePublication failed', err, { id });
        throw err;
      }
    }

    this.ensureLoaded();
    const publication = this.data.publications.find((p) => p.id === id);
    if (!publication) return null;
    if (patch.status) publication.status = patch.status;
    if (patch.externalId !== undefined) publication.externalId = patch.externalId || undefined;
    if (patch.externalIds !== undefined) publication.externalIds = [...patch.externalIds];
    if (patch.targetName !== undefined) {
      if (patch.targetName) publication.targetName = patch.targetName;
      else delete publication.targetName;
    }
    if (patch.externalUrl !== undefined) {
      if (patch.externalUrl) publication.externalUrl = patch.externalUrl;
      else delete publication.externalUrl;
    }
    if (patch.errorCode !== undefined) publication.errorCode = patch.errorCode || undefined;
    if (patch.mode !== undefined) publication.mode = patch.mode;
    if (patch.confirmedAt !== undefined) publication.confirmedAt = patch.confirmedAt || undefined;
    if (patch.connectionId !== undefined) {
      publication.connectionId = patch.connectionId || undefined;
    }
    publication.updatedAt = new Date().toISOString();
    this.save();
    return publication;
  }

  // Conditional transition used by manual sharing. The row only moves while it
  // is still in one of the expected states and has no external id, so two
  // concurrent "mark shared" clicks cannot create conflicting outcomes and a
  // published record can never be moved back to prepared/opened.
  async transitionPublication(
    id: string,
    from: PublicationStatus[],
    patch: {
      status: PublicationStatus;
      mode?: Publication['mode'];
      confirmedAt?: string;
      externalIds?: string[];
      contentHash?: string;
    }
  ): Promise<Publication | null> {
    if (from.length === 0) return null;
    const data = {
      status: patch.status,
      ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
      ...(patch.confirmedAt !== undefined
        ? { confirmedAt: new Date(patch.confirmedAt) }
        : {}),
      ...(patch.externalIds !== undefined ? { externalIds: patch.externalIds } : {}),
      ...(patch.contentHash !== undefined ? { contentHash: patch.contentHash } : {}),
    };

    if (this.isPrismaActive()) {
      try {
        const result = await prisma.publication.updateMany({
          where: { id, status: { in: from }, externalId: null },
          data,
        });
        if (result.count !== 1) return null;
        const updated = await prisma.publication.findUnique({ where: { id } });
        return updated ? toPublication(updated) : null;
      } catch (err) {
        logger.error('Prisma transitionPublication failed', err, { id });
        throw err;
      }
    }

    this.ensureLoaded();
    const publication = this.data.publications.find((p) => p.id === id);
    if (!publication || publication.externalId || !from.includes(publication.status)) {
      return null;
    }
    publication.status = patch.status;
    if (patch.mode !== undefined) publication.mode = patch.mode;
    if (patch.confirmedAt !== undefined) publication.confirmedAt = patch.confirmedAt;
    if (patch.externalIds !== undefined) publication.externalIds = [...patch.externalIds];
    if (patch.contentHash !== undefined) publication.contentHash = patch.contentHash;
    publication.updatedAt = new Date().toISOString();
    this.save();
    return publication;
  }

  // --- X usage ledger ---
  // One row per publication, so a retry can never create a second charge record.
  async createUsageEntryIfAbsent(
    entry: UsageLedgerEntry
  ): Promise<{ created: boolean; entry: UsageLedgerEntry }> {
    if (this.isPrismaActive()) {
      try {
        const created = await prisma.usageLedgerEntry.create({ data: { ...entry } });
        return { created: true, entry: toUsageEntry(created) };
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          const existing = await prisma.usageLedgerEntry.findUnique({
            where: { publicationId: entry.publicationId },
          });
          if (existing) return { created: false, entry: toUsageEntry(existing) };
        }
        logger.error('Prisma createUsageEntryIfAbsent failed', err, {
          publicationId: entry.publicationId,
        });
        throw err;
      }
    }

    this.ensureLoaded();
    const existing = this.data.usageLedger.find(
      (row) => row.publicationId === entry.publicationId
    );
    if (existing) return { created: false, entry: existing };
    this.data.usageLedger.push({ ...entry });
    this.save();
    return { created: true, entry };
  }

  async updateUsageEntryStatus(
    id: string,
    status: UsageEntryStatus
  ): Promise<UsageLedgerEntry | null> {
    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.usageLedgerEntry.update({
          where: { id },
          data: { status },
        });
        return toUsageEntry(updated);
      } catch (err) {
        logger.error('Prisma updateUsageEntryStatus failed', err, { id });
        throw err;
      }
    }

    this.ensureLoaded();
    const entry = this.data.usageLedger.find((row) => row.id === id);
    if (!entry) return null;
    entry.status = status;
    entry.updatedAt = new Date().toISOString();
    this.save();
    return entry;
  }

  // Reserved and committed rows both count against the budget; released rows do
  // not. The caller decides the window (calendar month, in UTC).
  async sumUsageSince(
    platformId: string,
    since: Date,
    statuses: UsageEntryStatus[] = ['reserved', 'committed']
  ): Promise<number> {
    if (this.isPrismaActive()) {
      try {
        const result = await prisma.usageLedgerEntry.aggregate({
          where: { platformId, createdAt: { gte: since }, status: { in: statuses } },
          _sum: { costMicros: true },
        });
        return result._sum.costMicros ?? 0;
      } catch (err) {
        logger.error('Prisma sumUsageSince failed', err, { platformId });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.usageLedger
      .filter(
        (row) =>
          row.platformId === platformId &&
          statuses.includes(row.status) &&
          new Date(row.createdAt).getTime() >= since.getTime()
      )
      .reduce((sum, row) => sum + Math.max(0, row.costMicros), 0);
  }

  // --- M8 campaigns ---

  async createCampaign(input: {
    projectId: string;
    ownerId: string;
    brief: string;
    name?: string;
    objective?: string;
    audience?: string;
    platforms: string[];
    durationDays: number;
    timezone: string;
    startDate?: string;
    redditSubreddit?: string;
    themes?: string[];
    postingFrequency?: string;
    desiredOutcomes?: string[];
    status?: Campaign['status'];
  }): Promise<Campaign> {
    const id = `cmp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const now = new Date();
    const record: Campaign = {
      id,
      projectId: input.projectId,
      ownerId: input.ownerId,
      brief: input.brief,
      name: input.name || '',
      objective: input.objective || '',
      audience: input.audience || '',
      platforms: [...input.platforms],
      durationDays: input.durationDays,
      timezone: input.timezone,
      startDate: input.startDate || '',
      redditSubreddit: input.redditSubreddit,
      themes: [...(input.themes || [])],
      postingFrequency: input.postingFrequency || '',
      desiredOutcomes: [...(input.desiredOutcomes || [])],
      status: input.status || 'queued',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    if (this.isPrismaActive()) {
      try {
        const created = await prisma.campaign.create({
          data: {
            id,
            projectId: record.projectId,
            ownerId: record.ownerId,
            brief: record.brief,
            name: record.name,
            objective: record.objective,
            audience: record.audience,
            platforms: record.platforms,
            durationDays: record.durationDays,
            timezone: record.timezone,
            startDate: record.startDate,
            redditSubreddit: record.redditSubreddit ?? null,
            themes: record.themes,
            postingFrequency: record.postingFrequency,
            desiredOutcomes: record.desiredOutcomes,
            status: record.status,
          },
        });
        return toCampaign(created);
      } catch (err) {
        logger.error('Prisma createCampaign failed', err, { projectId: input.projectId });
        throw err;
      }
    }

    this.ensureLoaded();
    this.data.campaigns.push(record);
    this.save();
    return { ...record, platforms: [...record.platforms], themes: [...record.themes] };
  }

  async getCampaignById(id: string): Promise<Campaign | null> {
    if (this.isPrismaActive()) {
      try {
        const found = await prisma.campaign.findUnique({ where: { id } });
        return found ? toCampaign(found) : null;
      } catch (err) {
        logger.error('Prisma getCampaignById failed', err, { id });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.campaigns.find((campaign) => campaign.id === id) || null;
  }

  async getCampaignsByProject(projectId: string): Promise<Campaign[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.campaign.findMany({
          where: { projectId },
          orderBy: { createdAt: 'desc' },
        });
        return list.map((campaign) => toCampaign(campaign));
      } catch (err) {
        logger.error('Prisma getCampaignsByProject failed', err, { projectId });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.campaigns
      .filter((campaign) => campaign.projectId === projectId)
      .slice()
      .reverse();
  }

  async updateCampaign(
    id: string,
    patch: Partial<{
      name: string;
      objective: string;
      audience: string;
      platforms: string[];
      durationDays: number;
      timezone: string;
      startDate: string;
      redditSubreddit: string | null;
      themes: string[];
      postingFrequency: string;
      desiredOutcomes: string[];
      status: Campaign['status'];
      strategyNotes: string | null;
      research: ResearchResult | null;
    }>
  ): Promise<Campaign | null> {
    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.campaign.update({
          where: { id },
          data: {
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.objective !== undefined ? { objective: patch.objective } : {}),
            ...(patch.audience !== undefined ? { audience: patch.audience } : {}),
            ...(patch.platforms !== undefined ? { platforms: patch.platforms } : {}),
            ...(patch.durationDays !== undefined ? { durationDays: patch.durationDays } : {}),
            ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
            ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
            ...(patch.redditSubreddit !== undefined
              ? { redditSubreddit: patch.redditSubreddit || null }
              : {}),
            ...(patch.themes !== undefined ? { themes: patch.themes } : {}),
            ...(patch.postingFrequency !== undefined
              ? { postingFrequency: patch.postingFrequency }
              : {}),
            ...(patch.desiredOutcomes !== undefined
              ? { desiredOutcomes: patch.desiredOutcomes }
              : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.strategyNotes !== undefined
              ? { strategyNotes: patch.strategyNotes || null }
              : {}),
            ...(patch.research !== undefined
              ? {
                  research: patch.research
                    ? (patch.research as unknown as Prisma.InputJsonValue)
                    : Prisma.DbNull,
                }
              : {}),
          },
        });
        return toCampaign(updated);
      } catch (err) {
        logger.error('Prisma updateCampaign failed', err, { id });
        throw err;
      }
    }

    this.ensureLoaded();
    const campaign = this.data.campaigns.find((item) => item.id === id);
    if (!campaign) return null;
    if (patch.name !== undefined) campaign.name = patch.name;
    if (patch.objective !== undefined) campaign.objective = patch.objective;
    if (patch.audience !== undefined) campaign.audience = patch.audience;
    if (patch.platforms !== undefined) campaign.platforms = [...patch.platforms];
    if (patch.durationDays !== undefined) campaign.durationDays = patch.durationDays;
    if (patch.timezone !== undefined) campaign.timezone = patch.timezone;
    if (patch.startDate !== undefined) campaign.startDate = patch.startDate;
    if (patch.redditSubreddit !== undefined) {
      campaign.redditSubreddit = patch.redditSubreddit || undefined;
    }
    if (patch.themes !== undefined) campaign.themes = [...patch.themes];
    if (patch.postingFrequency !== undefined) campaign.postingFrequency = patch.postingFrequency;
    if (patch.desiredOutcomes !== undefined) campaign.desiredOutcomes = [...patch.desiredOutcomes];
    if (patch.status !== undefined) campaign.status = patch.status;
    if (patch.strategyNotes !== undefined) {
      campaign.strategyNotes = patch.strategyNotes || undefined;
    }
    if (patch.research !== undefined) campaign.research = patch.research || undefined;
    campaign.updatedAt = new Date().toISOString();
    this.save();
    return campaign;
  }

  // --- M8 tasks, sources, ideas, generated posts ---

  async createCampaignTask(input: {
    campaignId: string;
    kind: CampaignTaskKind;
    status?: CampaignTaskStatus;
    detail?: string;
  }): Promise<CampaignTask> {
    const id = `tsk_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const now = new Date().toISOString();
    const task: CampaignTask = {
      id,
      campaignId: input.campaignId,
      kind: input.kind,
      status: input.status || 'pending',
      detail: input.detail,
      createdAt: now,
      updatedAt: now,
    };

    if (this.isPrismaActive()) {
      try {
        const created = await prisma.campaignTask.create({
          data: {
            id,
            campaignId: task.campaignId,
            kind: task.kind,
            status: task.status,
            detail: task.detail ?? null,
          },
        });
        return toCampaignTask(created);
      } catch (err) {
        logger.error('Prisma createCampaignTask failed', err, { campaignId: input.campaignId });
        throw err;
      }
    }

    this.ensureLoaded();
    this.data.campaignTasks.push(task);
    this.save();
    return task;
  }

  async updateCampaignTask(
    id: string,
    patch: Partial<{
      status: CampaignTaskStatus;
      detail: string | null;
      errorCode: string | null;
      errorMessage: string | null;
      startedAt: string | null;
      completedAt: string | null;
    }>
  ): Promise<CampaignTask | null> {
    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.campaignTask.update({
          where: { id },
          data: {
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
            ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
            ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
            ...(patch.startedAt !== undefined
              ? { startedAt: patch.startedAt ? new Date(patch.startedAt) : null }
              : {}),
            ...(patch.completedAt !== undefined
              ? { completedAt: patch.completedAt ? new Date(patch.completedAt) : null }
              : {}),
          },
        });
        return toCampaignTask(updated);
      } catch (err) {
        logger.error('Prisma updateCampaignTask failed', err, { id });
        throw err;
      }
    }

    this.ensureLoaded();
    const task = this.data.campaignTasks.find((item) => item.id === id);
    if (!task) return null;
    if (patch.status !== undefined) task.status = patch.status;
    if (patch.detail !== undefined) task.detail = patch.detail || undefined;
    if (patch.errorCode !== undefined) task.errorCode = patch.errorCode || undefined;
    if (patch.errorMessage !== undefined) task.errorMessage = patch.errorMessage || undefined;
    if (patch.startedAt !== undefined) task.startedAt = patch.startedAt || undefined;
    if (patch.completedAt !== undefined) task.completedAt = patch.completedAt || undefined;
    task.updatedAt = new Date().toISOString();
    this.save();
    return task;
  }

  async getCampaignTasks(campaignId: string): Promise<CampaignTask[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.campaignTask.findMany({
          where: { campaignId },
          orderBy: { createdAt: 'asc' },
        });
        return list.map((task) => toCampaignTask(task));
      } catch (err) {
        logger.error('Prisma getCampaignTasks failed', err, { campaignId });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.campaignTasks.filter((task) => task.campaignId === campaignId);
  }

  async replaceResearchSources(
    campaignId: string,
    sources: Array<Omit<ResearchSource, 'campaignId'>>
  ): Promise<ResearchSource[]> {
    if (this.isPrismaActive()) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.researchSource.deleteMany({ where: { campaignId } });
          if (sources.length) {
            await tx.researchSource.createMany({
              data: sources.map((source) => ({
                id: source.id,
                campaignId,
                title: source.title,
                url: source.url,
                publisher: source.publisher ?? null,
                publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
                retrievedAt: new Date(source.retrievedAt),
                summary: source.summary ?? null,
                provider: source.provider,
                verified: source.verified,
              })),
            });
          }
        });
        return this.getResearchSources(campaignId);
      } catch (err) {
        logger.error('Prisma replaceResearchSources failed', err, { campaignId });
        throw err;
      }
    }

    this.ensureLoaded();
    this.data.researchSources = this.data.researchSources.filter(
      (source) => source.campaignId !== campaignId
    );
    const stored = sources.map((source) => ({ ...source, campaignId }));
    this.data.researchSources.push(...stored);
    this.save();
    return stored;
  }

  async getResearchSources(campaignId: string): Promise<ResearchSource[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.researchSource.findMany({
          where: { campaignId },
          orderBy: { retrievedAt: 'asc' },
        });
        return list.map((source) => toResearchSource(source));
      } catch (err) {
        logger.error('Prisma getResearchSources failed', err, { campaignId });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.researchSources.filter((source) => source.campaignId === campaignId);
  }

  async getBrandProfile(projectId: string): Promise<BrandProfile | null> {
    if (this.isPrismaActive()) {
      try {
        const found = await prisma.brandProfile.findUnique({ where: { projectId } });
        return found ? toBrandProfile(found) : null;
      } catch (err) {
        logger.error('Prisma getBrandProfile failed', err, { projectId });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.brandProfiles.find((profile) => profile.projectId === projectId) || null;
  }

  async upsertBrandProfile(
    projectId: string,
    input: Partial<Omit<BrandProfile, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>>
  ): Promise<BrandProfile> {
    const id = `brd_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    if (this.isPrismaActive()) {
      try {
        const saved = await prisma.brandProfile.upsert({
          where: { projectId },
          create: {
            id,
            projectId,
            brandName: input.brandName || '',
            description: input.description || '',
            audience: input.audience || '',
            tone: input.tone || '',
            vocabulary: input.vocabulary || [],
            style: input.style || '',
            avoidTopics: input.avoidTopics || [],
            avoidWords: input.avoidWords || [],
            ctas: input.ctas || [],
            examplePosts: input.examplePosts || [],
          },
          update: {
            ...(input.brandName !== undefined ? { brandName: input.brandName } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.audience !== undefined ? { audience: input.audience } : {}),
            ...(input.tone !== undefined ? { tone: input.tone } : {}),
            ...(input.vocabulary !== undefined ? { vocabulary: input.vocabulary } : {}),
            ...(input.style !== undefined ? { style: input.style } : {}),
            ...(input.avoidTopics !== undefined ? { avoidTopics: input.avoidTopics } : {}),
            ...(input.avoidWords !== undefined ? { avoidWords: input.avoidWords } : {}),
            ...(input.ctas !== undefined ? { ctas: input.ctas } : {}),
            ...(input.examplePosts !== undefined ? { examplePosts: input.examplePosts } : {}),
          },
        });
        return toBrandProfile(saved);
      } catch (err) {
        logger.error('Prisma upsertBrandProfile failed', err, { projectId });
        throw err;
      }
    }

    this.ensureLoaded();
    const existing = this.data.brandProfiles.find((profile) => profile.projectId === projectId);
    if (existing) {
      Object.assign(existing, input);
      existing.updatedAt = new Date().toISOString();
      this.save();
      return existing;
    }
    const now = new Date().toISOString();
    const profile: BrandProfile = {
      id,
      projectId,
      brandName: input.brandName || '',
      description: input.description || '',
      audience: input.audience || '',
      tone: input.tone || '',
      vocabulary: [...(input.vocabulary || [])],
      style: input.style || '',
      avoidTopics: [...(input.avoidTopics || [])],
      avoidWords: [...(input.avoidWords || [])],
      ctas: [...(input.ctas || [])],
      examplePosts: [...(input.examplePosts || [])],
      createdAt: now,
      updatedAt: now,
    };
    this.data.brandProfiles.push(profile);
    this.save();
    return profile;
  }

  async createContentIdea(input: {
    campaignId: string;
    day: number;
    platformId: string;
    topic: string;
    angle?: string;
    status?: ContentIdeaStatus;
    note?: string;
  }): Promise<ContentIdea> {
    const id = `idea_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const now = new Date().toISOString();
    const idea: ContentIdea = {
      id,
      campaignId: input.campaignId,
      day: input.day,
      platformId: input.platformId,
      topic: input.topic,
      angle: input.angle || '',
      status: input.status || 'planned',
      note: input.note,
      createdAt: now,
      updatedAt: now,
    };

    if (this.isPrismaActive()) {
      try {
        const created = await prisma.contentIdea.create({
          data: {
            id,
            campaignId: idea.campaignId,
            day: idea.day,
            platformId: idea.platformId,
            topic: idea.topic,
            angle: idea.angle,
            status: idea.status,
            note: idea.note ?? null,
          },
        });
        return toContentIdea(created);
      } catch (err) {
        logger.error('Prisma createContentIdea failed', err, { campaignId: input.campaignId });
        throw err;
      }
    }

    this.ensureLoaded();
    this.data.contentIdeas.push(idea);
    this.save();
    return idea;
  }

  async getContentIdeaById(id: string): Promise<ContentIdea | null> {
    if (this.isPrismaActive()) {
      try {
        const found = await prisma.contentIdea.findUnique({ where: { id } });
        return found ? toContentIdea(found) : null;
      } catch (err) {
        logger.error('Prisma getContentIdeaById failed', err, { id });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.contentIdeas.find((idea) => idea.id === id) || null;
  }

  async getContentIdeas(campaignId: string): Promise<ContentIdea[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.contentIdea.findMany({
          where: { campaignId },
          orderBy: [{ day: 'asc' }, { createdAt: 'asc' }],
        });
        return list.map((idea) => toContentIdea(idea));
      } catch (err) {
        logger.error('Prisma getContentIdeas failed', err, { campaignId });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.contentIdeas.filter((idea) => idea.campaignId === campaignId);
  }

  async updateContentIdea(
    id: string,
    patch: Partial<{
      day: number;
      platformId: string;
      topic: string;
      angle: string;
      status: ContentIdeaStatus;
      note: string | null;
    }>
  ): Promise<ContentIdea | null> {
    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.contentIdea.update({
          where: { id },
          data: {
            ...(patch.day !== undefined ? { day: patch.day } : {}),
            ...(patch.platformId !== undefined ? { platformId: patch.platformId } : {}),
            ...(patch.topic !== undefined ? { topic: patch.topic } : {}),
            ...(patch.angle !== undefined ? { angle: patch.angle } : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.note !== undefined ? { note: patch.note } : {}),
          },
        });
        return toContentIdea(updated);
      } catch (err) {
        logger.error('Prisma updateContentIdea failed', err, { id });
        throw err;
      }
    }
    this.ensureLoaded();
    const idea = this.data.contentIdeas.find((item) => item.id === id);
    if (!idea) return null;
    if (patch.day !== undefined) idea.day = patch.day;
    if (patch.platformId !== undefined) idea.platformId = patch.platformId;
    if (patch.topic !== undefined) idea.topic = patch.topic;
    if (patch.angle !== undefined) idea.angle = patch.angle;
    if (patch.status !== undefined) idea.status = patch.status;
    if (patch.note !== undefined) idea.note = patch.note || undefined;
    idea.updatedAt = new Date().toISOString();
    this.save();
    return idea;
  }

  async createGeneratedPost(input: {
    campaignId: string;
    ideaId: string;
    draftId: string;
    platformId: string;
    variationIndex: number;
  }): Promise<GeneratedPost> {
    const id = `gen_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const now = new Date().toISOString();
    const post: GeneratedPost = {
      id,
      campaignId: input.campaignId,
      ideaId: input.ideaId,
      draftId: input.draftId,
      platformId: input.platformId,
      variationIndex: input.variationIndex,
      createdAt: now,
      updatedAt: now,
    };

    if (this.isPrismaActive()) {
      try {
        const created = await prisma.generatedPost.create({
          data: {
            id,
            campaignId: post.campaignId,
            ideaId: post.ideaId,
            draftId: post.draftId,
            platformId: post.platformId,
            variationIndex: post.variationIndex,
          },
        });
        return toGeneratedPost(created);
      } catch (err) {
        logger.error('Prisma createGeneratedPost failed', err, {
          campaignId: input.campaignId,
          draftId: input.draftId,
        });
        throw err;
      }
    }

    this.ensureLoaded();
    this.data.generatedPosts.push(post);
    this.save();
    return post;
  }

  async getGeneratedPosts(campaignId: string): Promise<GeneratedPost[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.generatedPost.findMany({
          where: { campaignId },
          orderBy: [{ ideaId: 'asc' }, { variationIndex: 'asc' }],
        });
        return list.map((post) => toGeneratedPost(post));
      } catch (err) {
        logger.error('Prisma getGeneratedPosts failed', err, { campaignId });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.generatedPosts.filter((post) => post.campaignId === campaignId);
  }

  async getGeneratedPostByDraftId(draftId: string): Promise<GeneratedPost | null> {
    if (this.isPrismaActive()) {
      try {
        const found = await prisma.generatedPost.findUnique({ where: { draftId } });
        return found ? toGeneratedPost(found) : null;
      } catch (err) {
        logger.error('Prisma getGeneratedPostByDraftId failed', err, { draftId });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.generatedPosts.find((post) => post.draftId === draftId) || null;
  }

  async updateGeneratedPostQuality(
    id: string,
    quality: QualityResult
  ): Promise<GeneratedPost | null> {
    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.generatedPost.update({
          where: { id },
          data: { quality: quality as unknown as Prisma.InputJsonValue },
        });
        return toGeneratedPost(updated);
      } catch (err) {
        logger.error('Prisma updateGeneratedPostQuality failed', err, { id });
        throw err;
      }
    }
    this.ensureLoaded();
    const post = this.data.generatedPosts.find((item) => item.id === id);
    if (!post) return null;
    post.quality = quality;
    post.updatedAt = new Date().toISOString();
    this.save();
    return post;
  }

  // --- M8 schedules, executions and analytics ---

  async getCampaignSchedules(campaignId: string): Promise<CampaignSchedule[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.campaignSchedule.findMany({
          where: { campaignId },
          orderBy: { scheduledFor: 'asc' },
        });
        return list.map((schedule) => toCampaignSchedule(schedule));
      } catch (err) {
        logger.error('Prisma getCampaignSchedules failed', err, { campaignId });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.campaignSchedules
      .filter((schedule) => schedule.campaignId === campaignId)
      .slice()
      .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  }

  // Recomputing replaces only AI suggestions. A manual override is kept so a
  // recommendation pass cannot silently undo the owner's choice.
  async replaceSuggestedSchedules(
    campaignId: string,
    schedules: Array<{
      draftId: string;
      platformId: string;
      scheduledFor: string;
      timezone: string;
      status: ScheduleStatus;
      reason?: string;
    }>
  ): Promise<CampaignSchedule[]> {
    if (this.isPrismaActive()) {
      try {
        await prisma.campaignSchedule.deleteMany({ where: { campaignId, source: 'ai' } });
        const manual = await prisma.campaignSchedule.findMany({
          where: { campaignId, source: 'manual' },
          select: { draftId: true },
        });
        const taken = new Set(manual.map((row) => row.draftId));
        const rows = schedules.filter((row) => !taken.has(row.draftId));
        if (rows.length) {
          await prisma.campaignSchedule.createMany({
            data: rows.map((row) => ({
              id: `sch_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
              campaignId,
              draftId: row.draftId,
              platformId: row.platformId,
              scheduledFor: new Date(row.scheduledFor),
              timezone: row.timezone,
              status: row.status,
              reason: row.reason ?? null,
              source: 'ai',
            })),
          });
        }
        return this.getCampaignSchedules(campaignId);
      } catch (err) {
        logger.error('Prisma replaceSuggestedSchedules failed', err, { campaignId });
        throw err;
      }
    }

    this.ensureLoaded();
    this.data.campaignSchedules = this.data.campaignSchedules.filter(
      (schedule) => !(schedule.campaignId === campaignId && schedule.source === 'ai')
    );
    const taken = new Set(
      this.data.campaignSchedules
        .filter((schedule) => schedule.campaignId === campaignId && schedule.source === 'manual')
        .map((schedule) => schedule.draftId)
    );
    const now = new Date().toISOString();
    const added = schedules
      .filter((row) => !taken.has(row.draftId))
      .map<CampaignSchedule>((row) => ({
        id: `sch_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        campaignId,
        draftId: row.draftId,
        platformId: row.platformId,
        scheduledFor: row.scheduledFor,
        timezone: row.timezone,
        status: row.status,
        reason: row.reason,
        source: 'ai',
        createdAt: now,
        updatedAt: now,
      }));
    this.data.campaignSchedules.push(...added);
    this.save();
    return this.getCampaignSchedules(campaignId);
  }

  async updateCampaignSchedule(
    id: string,
    patch: {
      scheduledFor?: string;
      status?: ScheduleStatus;
      reason?: string | null;
      source?: ScheduleSource;
    }
  ): Promise<CampaignSchedule | null> {
    if (this.isPrismaActive()) {
      try {
        const updated = await prisma.campaignSchedule.update({
          where: { id },
          data: {
            ...(patch.scheduledFor !== undefined
              ? { scheduledFor: new Date(patch.scheduledFor) }
              : {}),
            ...(patch.status !== undefined ? { status: patch.status } : {}),
            ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
            ...(patch.source !== undefined ? { source: patch.source } : {}),
          },
        });
        return toCampaignSchedule(updated);
      } catch (err) {
        logger.error('Prisma updateCampaignSchedule failed', err, { id });
        throw err;
      }
    }
    this.ensureLoaded();
    const schedule = this.data.campaignSchedules.find((item) => item.id === id);
    if (!schedule) return null;
    if (patch.scheduledFor !== undefined) schedule.scheduledFor = patch.scheduledFor;
    if (patch.status !== undefined) schedule.status = patch.status;
    if (patch.reason !== undefined) schedule.reason = patch.reason || undefined;
    if (patch.source !== undefined) schedule.source = patch.source;
    schedule.updatedAt = new Date().toISOString();
    this.save();
    return schedule;
  }

  async createAgentExecution(input: {
    campaignId: string;
    projectId: string;
    userId: string;
    stage: AgentExecution['stage'];
    provider: string;
    model: string;
    status: AgentExecution['status'];
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costMicros?: number;
    latencyMs?: number;
    errorCode?: string;
  }): Promise<AgentExecution> {
    const id = `exe_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    if (this.isPrismaActive()) {
      try {
        const created = await prisma.agentExecution.create({
          data: {
            id,
            campaignId: input.campaignId,
            projectId: input.projectId,
            userId: input.userId,
            stage: input.stage,
            provider: input.provider,
            model: input.model,
            status: input.status,
            promptTokens: input.promptTokens ?? 0,
            completionTokens: input.completionTokens ?? 0,
            totalTokens: input.totalTokens ?? 0,
            costMicros: input.costMicros ?? null,
            latencyMs: input.latencyMs ?? 0,
            errorCode: input.errorCode ?? null,
          },
        });
        return toAgentExecution(created);
      } catch (err) {
        logger.error('Prisma createAgentExecution failed', err, {
          campaignId: input.campaignId,
        });
        throw err;
      }
    }

    this.ensureLoaded();
    const execution: AgentExecution = {
      id,
      campaignId: input.campaignId,
      projectId: input.projectId,
      userId: input.userId,
      stage: input.stage,
      provider: input.provider,
      model: input.model,
      status: input.status,
      promptTokens: input.promptTokens ?? 0,
      completionTokens: input.completionTokens ?? 0,
      totalTokens: input.totalTokens ?? 0,
      costMicros: input.costMicros,
      latencyMs: input.latencyMs ?? 0,
      errorCode: input.errorCode,
      createdAt: new Date().toISOString(),
    };
    this.data.agentExecutions.push(execution);
    this.save();
    return execution;
  }

  async getAgentExecutions(campaignId: string): Promise<AgentExecution[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.agentExecution.findMany({
          where: { campaignId },
          orderBy: { createdAt: 'asc' },
        });
        return list.map((execution) => toAgentExecution(execution));
      } catch (err) {
        logger.error('Prisma getAgentExecutions failed', err, { campaignId });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.agentExecutions.filter(
      (execution) => execution.campaignId === campaignId
    );
  }

  async upsertCampaignAnalytics(input: {
    campaignId: string;
    projectId: string;
    metrics: CampaignAnalytics['metrics'];
    unavailable: string[];
    note: string;
  }): Promise<CampaignAnalytics> {
    const id = `ana_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    if (this.isPrismaActive()) {
      try {
        const saved = await prisma.campaignAnalytics.upsert({
          where: { campaignId: input.campaignId },
          create: {
            id,
            campaignId: input.campaignId,
            projectId: input.projectId,
            metrics: input.metrics as unknown as Prisma.InputJsonValue,
            unavailable: input.unavailable,
            note: input.note,
          },
          update: {
            metrics: input.metrics as unknown as Prisma.InputJsonValue,
            unavailable: input.unavailable,
            note: input.note,
            collectedAt: new Date(),
          },
        });
        return toCampaignAnalytics(saved);
      } catch (err) {
        logger.error('Prisma upsertCampaignAnalytics failed', err, {
          campaignId: input.campaignId,
        });
        throw err;
      }
    }

    this.ensureLoaded();
    const existing = this.data.campaignAnalytics.find(
      (row) => row.campaignId === input.campaignId
    );
    const now = new Date().toISOString();
    if (existing) {
      existing.metrics = input.metrics;
      existing.unavailable = [...input.unavailable];
      existing.note = input.note;
      existing.collectedAt = now;
      this.save();
      return existing;
    }
    const record: CampaignAnalytics = {
      id,
      campaignId: input.campaignId,
      projectId: input.projectId,
      metrics: input.metrics,
      unavailable: [...input.unavailable],
      note: input.note,
      collectedAt: now,
    };
    this.data.campaignAnalytics.push(record);
    this.save();
    return record;
  }

  async getCampaignAnalytics(campaignId: string): Promise<CampaignAnalytics | null> {
    if (this.isPrismaActive()) {
      try {
        const found = await prisma.campaignAnalytics.findUnique({ where: { campaignId } });
        return found ? toCampaignAnalytics(found) : null;
      } catch (err) {
        logger.error('Prisma getCampaignAnalytics failed', err, { campaignId });
        throw err;
      }
    }
    this.ensureLoaded();
    return (
      this.data.campaignAnalytics.find((row) => row.campaignId === campaignId) || null
    );
  }

  // --- M9 platform analytics -------------------------------------------------

  async getAnalyticsAccountByConnection(
    connectionId: string
  ): Promise<AnalyticsAccount | null> {
    if (this.isPrismaActive()) {
      try {
        const found = await prisma.analyticsAccount.findUnique({
          where: { connectionId },
        });
        return found ? toAnalyticsAccount(found) : null;
      } catch (err) {
        logger.error('Prisma getAnalyticsAccountByConnection failed', err, { connectionId });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.analyticsAccounts.find((a) => a.connectionId === connectionId) || null;
  }

  async listAnalyticsAccounts(projectId: string): Promise<AnalyticsAccount[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.analyticsAccount.findMany({
          where: { projectId },
          orderBy: { platformId: 'asc' },
        });
        return list.map(toAnalyticsAccount);
      } catch (err) {
        logger.error('Prisma listAnalyticsAccounts failed', err, { projectId });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.analyticsAccounts
      .filter((a) => a.projectId === projectId)
      .sort((a, b) => a.platformId.localeCompare(b.platformId));
  }

  async upsertAnalyticsAccount(input: {
    id?: string;
    userId: string;
    projectId: string;
    connectionId: string;
    platformId: string;
    externalAccountId?: string;
    externalAccountName?: string;
    metrics: MetricSet;
    availableMetrics: MetricKey[];
    unavailableMetrics: MetricKey[];
    status: AnalyticsAccount['status'];
    note?: string;
    lastSyncedAt?: string;
    lastErrorCode?: string;
    lastErrorMessage?: string;
  }): Promise<AnalyticsAccount> {
    const id = input.id || `aacct_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const data = {
      userId: input.userId,
      projectId: input.projectId,
      connectionId: input.connectionId,
      platformId: input.platformId,
      externalAccountId: input.externalAccountId || null,
      externalAccountName: input.externalAccountName || null,
      metrics: input.metrics as Prisma.InputJsonValue,
      availableMetrics: input.availableMetrics,
      unavailableMetrics: input.unavailableMetrics,
      status: input.status,
      note: input.note || null,
      lastSyncedAt: input.lastSyncedAt ? new Date(input.lastSyncedAt) : null,
      lastErrorCode: input.lastErrorCode || null,
      lastErrorMessage: input.lastErrorMessage || null,
    };

    if (this.isPrismaActive()) {
      try {
        const saved = await prisma.analyticsAccount.upsert({
          where: { connectionId: input.connectionId },
          create: { id, ...data },
          update: data,
        });
        return toAnalyticsAccount(saved);
      } catch (err) {
        logger.error('Prisma upsertAnalyticsAccount failed', err, {
          connectionId: input.connectionId,
        });
        throw err;
      }
    }

    this.ensureLoaded();
    const now = new Date().toISOString();
    const index = this.data.analyticsAccounts.findIndex(
      (a) => a.connectionId === input.connectionId
    );
    const existing = index >= 0 ? this.data.analyticsAccounts[index] : null;
    const record: AnalyticsAccount = {
      id: existing?.id || id,
      userId: input.userId,
      projectId: input.projectId,
      connectionId: input.connectionId,
      platformId: input.platformId,
      externalAccountId: input.externalAccountId,
      externalAccountName: input.externalAccountName,
      metrics: { ...input.metrics },
      availableMetrics: [...input.availableMetrics],
      unavailableMetrics: [...input.unavailableMetrics],
      status: input.status,
      note: input.note,
      lastSyncedAt: input.lastSyncedAt,
      lastErrorCode: input.lastErrorCode,
      lastErrorMessage: input.lastErrorMessage,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (index >= 0) this.data.analyticsAccounts[index] = record;
    else this.data.analyticsAccounts.push(record);
    this.save();
    return record;
  }

  async getAnalyticsPostByPublication(publicationId: string): Promise<AnalyticsPost | null> {
    if (this.isPrismaActive()) {
      try {
        const found = await prisma.analyticsPost.findUnique({ where: { publicationId } });
        return found ? toAnalyticsPost(found) : null;
      } catch (err) {
        logger.error('Prisma getAnalyticsPostByPublication failed', err, { publicationId });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.analyticsPosts.find((p) => p.publicationId === publicationId) || null;
  }

  async listAnalyticsPosts(filter: {
    projectId: string;
    campaignId?: string;
    platformId?: string;
    from?: string;
    to?: string;
    status?: AnalyticsPostStatus;
    limit?: number;
    offset?: number;
  }): Promise<AnalyticsPost[]> {
    const limit = Math.min(1000, Math.max(1, filter.limit ?? 500));
    const offset = Math.max(0, filter.offset ?? 0);
    const dateWhere =
      filter.from || filter.to
        ? {
            ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00.000Z`) } : {}),
            ...(filter.to ? { lte: new Date(`${filter.to}T23:59:59.999Z`) } : {}),
          }
        : undefined;

    if (this.isPrismaActive()) {
      try {
        const list = await prisma.analyticsPost.findMany({
          where: {
            projectId: filter.projectId,
            ...(filter.campaignId ? { campaignId: filter.campaignId } : {}),
            ...(filter.platformId ? { platformId: filter.platformId } : {}),
            ...(filter.status ? { status: filter.status } : {}),
            ...(dateWhere ? { publishedAt: dateWhere } : {}),
          },
          orderBy: { publishedAt: 'desc' },
          take: limit,
          skip: offset,
        });
        return list.map(toAnalyticsPost);
      } catch (err) {
        logger.error('Prisma listAnalyticsPosts failed', err, { projectId: filter.projectId });
        throw err;
      }
    }

    this.ensureLoaded();
    return this.data.analyticsPosts
      .filter((p) => {
        if (p.projectId !== filter.projectId) return false;
        if (filter.campaignId && p.campaignId !== filter.campaignId) return false;
        if (filter.platformId && p.platformId !== filter.platformId) return false;
        if (filter.status && p.status !== filter.status) return false;
        const key = p.publishedAt.slice(0, 10);
        if (filter.from && key < filter.from) return false;
        if (filter.to && key > filter.to) return false;
        return true;
      })
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(offset, offset + limit);
  }

  async getAnalyticsPostsByCampaign(campaignId: string): Promise<AnalyticsPost[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.analyticsPost.findMany({
          where: { campaignId },
          orderBy: { publishedAt: 'desc' },
        });
        return list.map(toAnalyticsPost);
      } catch (err) {
        logger.error('Prisma getAnalyticsPostsByCampaign failed', err, { campaignId });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.analyticsPosts
      .filter((p) => p.campaignId === campaignId)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }

  async upsertAnalyticsPost(input: {
    id?: string;
    userId: string;
    projectId: string;
    publicationId: string;
    draftId: string;
    campaignId?: string;
    platformId: string;
    externalId?: string;
    externalUrl?: string;
    publishedAt: string;
    contentType: AnalyticsPost['contentType'];
    topic?: string;
    metrics: MetricSet;
    availableMetrics: MetricKey[];
    unavailableMetrics: MetricKey[];
    engagement: number | null;
    engagementRate: number | null;
    engagementRateBasis?: string;
    status: AnalyticsPostStatus;
    note?: string;
    lastSyncedAt?: string;
    lastErrorCode?: string;
  }): Promise<AnalyticsPost> {
    const id = input.id || `apost_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const data = {
      userId: input.userId,
      projectId: input.projectId,
      publicationId: input.publicationId,
      draftId: input.draftId,
      campaignId: input.campaignId || null,
      platformId: input.platformId,
      externalId: input.externalId || null,
      externalUrl: input.externalUrl || null,
      publishedAt: new Date(input.publishedAt),
      contentType: input.contentType,
      topic: input.topic || null,
      metrics: input.metrics as Prisma.InputJsonValue,
      availableMetrics: input.availableMetrics,
      unavailableMetrics: input.unavailableMetrics,
      engagement: input.engagement,
      engagementRate: input.engagementRate,
      engagementRateBasis: input.engagementRateBasis || null,
      status: input.status,
      note: input.note || null,
      lastSyncedAt: input.lastSyncedAt ? new Date(input.lastSyncedAt) : null,
      lastErrorCode: input.lastErrorCode || null,
    };

    if (this.isPrismaActive()) {
      try {
        const saved = await prisma.analyticsPost.upsert({
          where: { publicationId: input.publicationId },
          create: { id, ...data },
          update: data,
        });
        return toAnalyticsPost(saved);
      } catch (err) {
        logger.error('Prisma upsertAnalyticsPost failed', err, {
          publicationId: input.publicationId,
        });
        throw err;
      }
    }

    this.ensureLoaded();
    const now = new Date().toISOString();
    const index = this.data.analyticsPosts.findIndex(
      (p) => p.publicationId === input.publicationId
    );
    const existing = index >= 0 ? this.data.analyticsPosts[index] : null;
    const record: AnalyticsPost = {
      id: existing?.id || id,
      userId: input.userId,
      projectId: input.projectId,
      publicationId: input.publicationId,
      draftId: input.draftId,
      campaignId: input.campaignId,
      platformId: input.platformId,
      externalId: input.externalId,
      externalUrl: input.externalUrl,
      publishedAt: input.publishedAt,
      contentType: input.contentType,
      topic: input.topic,
      metrics: { ...input.metrics },
      availableMetrics: [...input.availableMetrics],
      unavailableMetrics: [...input.unavailableMetrics],
      engagement: input.engagement,
      engagementRate: input.engagementRate,
      engagementRateBasis: input.engagementRateBasis,
      status: input.status,
      note: input.note,
      lastSyncedAt: input.lastSyncedAt,
      lastErrorCode: input.lastErrorCode,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (index >= 0) this.data.analyticsPosts[index] = record;
    else this.data.analyticsPosts.push(record);
    this.save();
    return record;
  }

  async createAnalyticsSnapshotIfAbsent(
    snapshot: AnalyticsSnapshot
  ): Promise<{ created: boolean; snapshot: AnalyticsSnapshot }> {
    if (this.isPrismaActive()) {
      try {
        const created = await prisma.analyticsSnapshot.create({
          data: {
            id: snapshot.id,
            userId: snapshot.userId,
            projectId: snapshot.projectId,
            platformId: snapshot.platformId,
            scope: snapshot.scope,
            analyticsPostId: snapshot.analyticsPostId || null,
            analyticsAccountId: snapshot.analyticsAccountId || null,
            dedupeKey: snapshot.dedupeKey,
            metrics: snapshot.metrics as Prisma.InputJsonValue,
            capturedAt: new Date(snapshot.capturedAt),
            source: snapshot.source,
          },
        });
        return { created: true, snapshot: toAnalyticsSnapshot(created) };
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          const existing = await prisma.analyticsSnapshot.findUnique({
            where: { dedupeKey: snapshot.dedupeKey },
          });
          if (existing) return { created: false, snapshot: toAnalyticsSnapshot(existing) };
        }
        logger.error('Prisma createAnalyticsSnapshotIfAbsent failed', err, {
          dedupeKey: snapshot.dedupeKey,
        });
        throw err;
      }
    }

    this.ensureLoaded();
    const existing = this.data.analyticsSnapshots.find(
      (s) => s.dedupeKey === snapshot.dedupeKey
    );
    if (existing) return { created: false, snapshot: existing };
    const record: AnalyticsSnapshot = {
      ...snapshot,
      metrics: { ...snapshot.metrics },
      createdAt: snapshot.createdAt || new Date().toISOString(),
    };
    this.data.analyticsSnapshots.push(record);
    this.save();
    return { created: true, snapshot: record };
  }

  async listAnalyticsSnapshots(filter: {
    projectId?: string;
    analyticsPostId?: string;
    analyticsAccountId?: string;
    since?: string;
    limit?: number;
    order?: 'asc' | 'desc';
  }): Promise<AnalyticsSnapshot[]> {
    const limit = Math.min(2000, Math.max(1, filter.limit ?? 500));
    const order = filter.order ?? 'asc';
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.analyticsSnapshot.findMany({
          where: {
            ...(filter.projectId ? { projectId: filter.projectId } : {}),
            ...(filter.analyticsPostId ? { analyticsPostId: filter.analyticsPostId } : {}),
            ...(filter.analyticsAccountId
              ? { analyticsAccountId: filter.analyticsAccountId }
              : {}),
            ...(filter.since ? { capturedAt: { gte: new Date(filter.since) } } : {}),
          },
          orderBy: { capturedAt: order },
          take: limit,
        });
        return list.map(toAnalyticsSnapshot);
      } catch (err) {
        logger.error('Prisma listAnalyticsSnapshots failed', err, filter);
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.analyticsSnapshots
      .filter((s) => {
        if (filter.projectId && s.projectId !== filter.projectId) return false;
        if (filter.analyticsPostId && s.analyticsPostId !== filter.analyticsPostId) return false;
        if (filter.analyticsAccountId && s.analyticsAccountId !== filter.analyticsAccountId) {
          return false;
        }
        if (filter.since && s.capturedAt < filter.since) return false;
        return true;
      })
      .sort((a, b) =>
        order === 'desc'
          ? b.capturedAt.localeCompare(a.capturedAt)
          : a.capturedAt.localeCompare(b.capturedAt)
      )
      .slice(0, limit)
      .map((s) => ({ ...s, metrics: { ...s.metrics } }));
  }

  // Retention: keep at most `keep` snapshots per entity and drop anything older
  // than `olderThan`. Sync calls this after writing so growth stays bounded.
  async pruneAnalyticsSnapshots(input: {
    scope: AnalyticsSnapshot['scope'];
    id: string;
    keep: number;
    olderThan?: string;
  }): Promise<number> {
    const keep = Math.max(1, input.keep);
    if (this.isPrismaActive()) {
      try {
        const where =
          input.scope === 'post'
            ? { analyticsPostId: input.id }
            : { analyticsAccountId: input.id };
        const extra = await prisma.analyticsSnapshot.deleteMany({
          where: {
            ...where,
            ...(input.olderThan ? { capturedAt: { lt: new Date(input.olderThan) } } : {}),
          },
        });
        const remaining = await prisma.analyticsSnapshot.findMany({
          where,
          orderBy: { capturedAt: 'desc' },
          select: { id: true },
        });
        const excess = remaining.slice(keep).map((row) => row.id);
        const trimmed = excess.length
          ? await prisma.analyticsSnapshot.deleteMany({ where: { id: { in: excess } } })
          : { count: 0 };
        return extra.count + trimmed.count;
      } catch (err) {
        logger.error('Prisma pruneAnalyticsSnapshots failed', err, input);
        throw err;
      }
    }

    this.ensureLoaded();
    const matches = (snapshot: AnalyticsSnapshot) =>
      input.scope === 'post'
        ? snapshot.analyticsPostId === input.id
        : snapshot.analyticsAccountId === input.id;
    const before = this.data.analyticsSnapshots.length;
    let candidates = this.data.analyticsSnapshots
      .filter(matches)
      .filter((s) => !input.olderThan || s.capturedAt >= input.olderThan)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    const kept = candidates.slice(0, keep);
    const keptIds = new Set(kept.map((s) => s.id));
    this.data.analyticsSnapshots = this.data.analyticsSnapshots.filter(
      (s) => !matches(s) || keptIds.has(s.id)
    );
    const removed = before - this.data.analyticsSnapshots.length;
    if (removed > 0) this.save();
    return removed;
  }

  // --- M9 sync leases -------------------------------------------------------
  // Acquire is a single create or a conditional update of an expired row. No
  // transaction stays open while the platform is called. The owner token makes
  // release safe: an expired worker cannot delete a newer worker's lease.
  async acquireAnalyticsSyncLock(input: {
    key: string;
    ownerToken: string;
    projectId: string;
    platformId: string;
    connectionId?: string;
    now: Date;
    leaseMs: number;
  }): Promise<{
    acquired: boolean;
    lock: AnalyticsSyncLock | null;
    heldByToken?: string;
  }> {
    const expiresAt = new Date(input.now.getTime() + Math.max(1000, input.leaseMs));
    if (this.isPrismaActive()) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const created = await prisma.analyticsSyncLock.create({
            data: {
              key: input.key,
              ownerToken: input.ownerToken,
              projectId: input.projectId,
              platformId: input.platformId,
              connectionId: input.connectionId || null,
              acquiredAt: input.now,
              expiresAt,
            },
          });
          return { acquired: true, lock: toAnalyticsSyncLock(created) };
        } catch (err) {
          if ((err as { code?: string }).code !== 'P2002') {
            logger.error('Prisma acquireAnalyticsSyncLock failed', err, { key: input.key });
            throw err;
          }
          const updated = await prisma.analyticsSyncLock.updateMany({
            where: { key: input.key, expiresAt: { lt: input.now } },
            data: {
              ownerToken: input.ownerToken,
              projectId: input.projectId,
              platformId: input.platformId,
              connectionId: input.connectionId || null,
              acquiredAt: input.now,
              expiresAt,
            },
          });
          if (updated.count === 1) {
            const lock = await prisma.analyticsSyncLock.findUnique({
              where: { key: input.key },
            });
            return { acquired: true, lock: lock ? toAnalyticsSyncLock(lock) : null };
          }
          const existing = await prisma.analyticsSyncLock.findUnique({
            where: { key: input.key },
          });
          if (existing) {
            return {
              acquired: false,
              lock: toAnalyticsSyncLock(existing),
              heldByToken: existing.ownerToken,
            };
          }
          // The row disappeared between create and update; retry the create.
        }
      }
      throw new Error('Could not acquire the analytics sync lock.');
    }

    this.ensureLoaded();
    const nowIso = input.now.toISOString();
    const existing = this.data.analyticsSyncLocks.find((lock) => lock.key === input.key);
    if (!existing || existing.expiresAt < nowIso) {
      const record: AnalyticsSyncLock = {
        key: input.key,
        ownerToken: input.ownerToken,
        projectId: input.projectId,
        platformId: input.platformId,
        connectionId: input.connectionId,
        acquiredAt: nowIso,
        expiresAt: expiresAt.toISOString(),
        updatedAt: nowIso,
      };
      if (existing) {
        Object.assign(existing, record);
      } else {
        this.data.analyticsSyncLocks.push(record);
      }
      this.save();
      return { acquired: true, lock: record };
    }
    return { acquired: false, lock: existing, heldByToken: existing.ownerToken };
  }

  async releaseAnalyticsSyncLock(key: string, ownerToken: string): Promise<boolean> {
    if (this.isPrismaActive()) {
      try {
        const result = await prisma.analyticsSyncLock.deleteMany({
          where: { key, ownerToken },
        });
        return result.count === 1;
      } catch (err) {
        logger.error('Prisma releaseAnalyticsSyncLock failed', err, { key });
        throw err;
      }
    }
    this.ensureLoaded();
    const index = this.data.analyticsSyncLocks.findIndex(
      (lock) => lock.key === key && lock.ownerToken === ownerToken
    );
    if (index < 0) return false;
    this.data.analyticsSyncLocks.splice(index, 1);
    this.save();
    return true;
  }

  async getAnalyticsSyncLock(key: string): Promise<AnalyticsSyncLock | null> {
    if (this.isPrismaActive()) {
      try {
        const found = await prisma.analyticsSyncLock.findUnique({ where: { key } });
        return found ? toAnalyticsSyncLock(found) : null;
      } catch (err) {
        logger.error('Prisma getAnalyticsSyncLock failed', err, { key });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.analyticsSyncLocks.find((lock) => lock.key === key) || null;
  }

  async createAnalyticsSync(input: {
    id?: string;
    userId: string;
    projectId: string;
    platformId: string;
    trigger: AnalyticsSync['trigger'];
    status: AnalyticsSyncStatus;
    startedAt: string;
    postsRequested?: number;
    postsUpdated?: number;
    snapshotsWritten?: number;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<AnalyticsSync> {
    const id = input.id || `async_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const data = {
      userId: input.userId,
      projectId: input.projectId,
      platformId: input.platformId,
      trigger: input.trigger,
      status: input.status,
      startedAt: new Date(input.startedAt),
      postsRequested: input.postsRequested ?? 0,
      postsUpdated: input.postsUpdated ?? 0,
      snapshotsWritten: input.snapshotsWritten ?? 0,
      errorCode: input.errorCode || null,
      errorMessage: input.errorMessage || null,
    };
    if (this.isPrismaActive()) {
      try {
        const saved = await prisma.analyticsSync.create({ data: { id, ...data } });
        return toAnalyticsSync(saved);
      } catch (err) {
        logger.error('Prisma createAnalyticsSync failed', err, { projectId: input.projectId });
        throw err;
      }
    }
    this.ensureLoaded();
    const record: AnalyticsSync = {
      ...data,
      id,
      startedAt: data.startedAt.toISOString(),
      errorCode: data.errorCode ?? undefined,
      errorMessage: data.errorMessage ?? undefined,
      createdAt: new Date().toISOString(),
    };
    this.data.analyticsSyncs.push(record);
    this.save();
    return record;
  }

  async updateAnalyticsSync(
    id: string,
    patch: Partial<{
      status: AnalyticsSyncStatus;
      finishedAt: string;
      postsRequested: number;
      postsUpdated: number;
      snapshotsWritten: number;
      errorCode: string;
      errorMessage: string;
    }>
  ): Promise<AnalyticsSync | null> {
    const data = {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.finishedAt ? { finishedAt: new Date(patch.finishedAt) } : {}),
      ...(typeof patch.postsRequested === 'number'
        ? { postsRequested: patch.postsRequested }
        : {}),
      ...(typeof patch.postsUpdated === 'number' ? { postsUpdated: patch.postsUpdated } : {}),
      ...(typeof patch.snapshotsWritten === 'number'
        ? { snapshotsWritten: patch.snapshotsWritten }
        : {}),
      ...(patch.errorCode ? { errorCode: patch.errorCode } : {}),
      ...(patch.errorMessage ? { errorMessage: patch.errorMessage } : {}),
    };
    if (this.isPrismaActive()) {
      try {
        const saved = await prisma.analyticsSync.update({ where: { id }, data });
        return toAnalyticsSync(saved);
      } catch (err) {
        logger.error('Prisma updateAnalyticsSync failed', err, { id });
        throw err;
      }
    }
    this.ensureLoaded();
    const row = this.data.analyticsSyncs.find((s) => s.id === id);
    if (!row) return null;
    Object.assign(row, data, {
      finishedAt: data.finishedAt?.toISOString() ?? row.finishedAt,
      errorCode: data.errorCode ?? row.errorCode,
      errorMessage: data.errorMessage ?? row.errorMessage,
    });
    this.save();
    return row;
  }

  async getRunningAnalyticsSync(
    projectId: string,
    since: string
  ): Promise<AnalyticsSync | null> {
    if (this.isPrismaActive()) {
      try {
        const found = await prisma.analyticsSync.findFirst({
          where: { projectId, status: 'running', startedAt: { gte: new Date(since) } },
          orderBy: { startedAt: 'desc' },
        });
        return found ? toAnalyticsSync(found) : null;
      } catch (err) {
        logger.error('Prisma getRunningAnalyticsSync failed', err, { projectId });
        throw err;
      }
    }
    this.ensureLoaded();
    return (
      this.data.analyticsSyncs
        .filter((s) => s.projectId === projectId && s.status === 'running' && s.startedAt >= since)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] || null
    );
  }

  async listAnalyticsSyncs(projectId: string, limit = 30): Promise<AnalyticsSync[]> {
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.analyticsSync.findMany({
          where: { projectId },
          orderBy: { startedAt: 'desc' },
          take: Math.min(100, Math.max(1, limit)),
        });
        return list.map(toAnalyticsSync);
      } catch (err) {
        logger.error('Prisma listAnalyticsSyncs failed', err, { projectId });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.analyticsSyncs
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }

  async createAnalyticsInsight(input: {
    id?: string;
    userId: string;
    projectId: string;
    campaignId?: string;
    scope: AnalyticsInsightScope;
    periodStart: string;
    periodEnd: string;
    provider: string;
    model: string;
    status?: AnalyticsInsightStatus;
    sampleSize: number;
    promptTokens: number;
    completionTokens: number;
    payload: AnalyticsInsight['payload'];
  }): Promise<AnalyticsInsight> {
    const id = input.id || `ains_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const data = {
      userId: input.userId,
      projectId: input.projectId,
      campaignId: input.campaignId || null,
      scope: input.scope,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      provider: input.provider,
      model: input.model,
      status: input.status || 'new',
      sampleSize: input.sampleSize,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      payload: input.payload as unknown as Prisma.InputJsonValue,
    };
    if (this.isPrismaActive()) {
      try {
        const saved = await prisma.analyticsInsight.create({ data: { id, ...data } });
        return toAnalyticsInsight(saved);
      } catch (err) {
        logger.error('Prisma createAnalyticsInsight failed', err, { projectId: input.projectId });
        throw err;
      }
    }
    this.ensureLoaded();
    const now = new Date().toISOString();
    const record: AnalyticsInsight = {
      id,
      userId: input.userId,
      projectId: input.projectId,
      campaignId: input.campaignId,
      scope: input.scope,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      provider: input.provider,
      model: input.model,
      status: input.status || 'new',
      sampleSize: input.sampleSize,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      payload: input.payload,
      createdAt: now,
      updatedAt: now,
    };
    this.data.analyticsInsights.push(record);
    this.save();
    return record;
  }

  async getAnalyticsInsight(id: string): Promise<AnalyticsInsight | null> {
    if (this.isPrismaActive()) {
      try {
        const found = await prisma.analyticsInsight.findUnique({ where: { id } });
        return found ? toAnalyticsInsight(found) : null;
      } catch (err) {
        logger.error('Prisma getAnalyticsInsight failed', err, { id });
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.analyticsInsights.find((i) => i.id === id) || null;
  }

  async listAnalyticsInsights(filter: {
    projectId: string;
    campaignId?: string;
    scope?: AnalyticsInsightScope;
    status?: AnalyticsInsightStatus;
    limit?: number;
  }): Promise<AnalyticsInsight[]> {
    const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
    if (this.isPrismaActive()) {
      try {
        const list = await prisma.analyticsInsight.findMany({
          where: {
            projectId: filter.projectId,
            ...(filter.campaignId ? { campaignId: filter.campaignId } : {}),
            ...(filter.scope ? { scope: filter.scope } : {}),
            ...(filter.status ? { status: filter.status } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        });
        return list.map(toAnalyticsInsight);
      } catch (err) {
        logger.error('Prisma listAnalyticsInsights failed', err, filter);
        throw err;
      }
    }
    this.ensureLoaded();
    return this.data.analyticsInsights
      .filter((i) => {
        if (i.projectId !== filter.projectId) return false;
        if (filter.campaignId && i.campaignId !== filter.campaignId) return false;
        if (filter.scope && i.scope !== filter.scope) return false;
        if (filter.status && i.status !== filter.status) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async updateAnalyticsInsightStatus(
    id: string,
    status: AnalyticsInsightStatus
  ): Promise<AnalyticsInsight | null> {
    const acceptedAt = status === 'accepted' ? new Date() : null;
    if (this.isPrismaActive()) {
      try {
        const saved = await prisma.analyticsInsight.update({
          where: { id },
          data: { status, acceptedAt },
        });
        return toAnalyticsInsight(saved);
      } catch (err) {
        logger.error('Prisma updateAnalyticsInsightStatus failed', err, { id });
        return null;
      }
    }
    this.ensureLoaded();
    const row = this.data.analyticsInsights.find((i) => i.id === id);
    if (!row) return null;
    row.status = status;
    row.acceptedAt = acceptedAt?.toISOString();
    row.updatedAt = new Date().toISOString();
    this.save();
    return row;
  }
}

const globalForStorage = globalThis as unknown as {
  crewlinkStorage?: Storage;
};

export const storage = globalForStorage.crewlinkStorage ?? new Storage();
globalForStorage.crewlinkStorage = storage;
export default storage;
