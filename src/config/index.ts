// Unset means the default ceiling; a malformed explicit value disables spend.
function parseBudget(value: string | undefined): number {
  if (value === undefined || value === '') return 10;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseResearchProvider(value: string | undefined): 'none' | 'brave' | 'reddit' | 'both' {
  return value === 'brave' || value === 'reddit' || value === 'both' ? value : 'none';
}

export const config = {
  port: parseInt(process.env.PORT || '3100', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3100',
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || 'crewlink-dev-secret-key-change-in-production-32chars',
  githubClientId: process.env.GITHUB_CLIENT_ID || '',
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET || '',
  githubAppId: process.env.GITHUB_APP_ID || '',
  githubPrivateKeyPath: process.env.GITHUB_PRIVATE_KEY_PATH || '',
  gcsBucketName: process.env.GCS_BUCKET_NAME || '',
  gcpProjectId: process.env.GCP_PROJECT_ID || '',
  gcsCredentialsJson: process.env.GCS_CREDENTIALS_JSON || '',
  // Credential storage for social platform tokens. `gcp` encrypts with Cloud KMS
  // and reads app secrets from Secret Manager; `local` uses versioned AES-256-GCM
  // and environment variables. There is never an automatic fallback between them.
  credentialProvider: (process.env.CREDENTIAL_PROVIDER === 'gcp' ? 'gcp' : 'local') as 'gcp' | 'local',
  secretsProvider: (process.env.SECRETS_PROVIDER === 'gcp' ? 'gcp' : 'env') as 'gcp' | 'env',
  googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || '',
  googleCloudKmsKey: process.env.GOOGLE_CLOUD_KMS_KEY || '',
  googleCloudLocation: process.env.GOOGLE_CLOUD_LOCATION || '',
  googleCloudStorageBucket:
    process.env.GOOGLE_CLOUD_STORAGE_BUCKET || process.env.GCS_BUCKET_NAME || '',
  googleSecretManagerPrefix: process.env.GOOGLE_SECRET_MANAGER_PREFIX || 'crewlink-',
  // Discord and Telegram calls are mocked unless live transport is explicitly
  // switched on. A misconfigured deployment therefore never posts by accident.
  publishingTransport: (process.env.PUBLISHING_TRANSPORT === 'live' ? 'live' : 'mock') as
    | 'mock'
    | 'live',
  // AT Protocol service used for creator-owned Bluesky accounts.
  blueskyServiceUrl: process.env.BLUESKY_SERVICE_URL || 'https://bsky.social',
  // X uses one Crewlink-owned OAuth app. Owners never create their own developer
  // app, and the paid API calls are billed to that app. A missing client id
  // disables automatic publishing; manual publishing stays available.
  xClientId: process.env.X_CLIENT_ID || '',
  xClientSecret: process.env.X_CLIENT_SECRET || '',
  xApiBaseUrl: (process.env.X_API_BASE_URL || 'https://api.x.com').replace(/\/+$/, ''),
  xAuthorizeUrl: process.env.X_AUTHORIZE_URL || 'https://x.com/i/oauth2/authorize',
  // App-wide monthly ceiling for Crewlink-billed X API requests. Invalid or
  // negative values fail closed to zero rather than allowing unlimited spend.
  xMonthlyBudgetUsd: parseBudget(process.env.X_MONTHLY_BUDGET_USD),
  // Reddit uses one Crewlink-owned OAuth app. A missing client id disables
  // automatic publishing; Reddit's API terms may also require commercial
  // approval before the app is allowed to post at scale.
  redditClientId: process.env.REDDIT_CLIENT_ID || '',
  redditClientSecret: process.env.REDDIT_CLIENT_SECRET || '',
  // Reddit requires a unique, descriptive User-Agent. The default is a safe
  // placeholder, not a production identity.
  redditUserAgent: process.env.REDDIT_USER_AGENT || 'crewlink/0.1 (Crewlink publishing)',
  redditAuthorizeUrl:
    process.env.REDDIT_AUTHORIZE_URL || 'https://www.reddit.com/api/v1/authorize',
  redditTokenUrl:
    process.env.REDDIT_TOKEN_URL || 'https://www.reddit.com/api/v1/access_token',
  redditRevokeUrl:
    process.env.REDDIT_REVOKE_URL || 'https://www.reddit.com/api/v1/revoke_token',
  redditApiBaseUrl: (process.env.REDDIT_API_BASE_URL || 'https://oauth.reddit.com').replace(
    /\/+$/,
    ''
  ),
  // Documented non-commercial ceiling for an OAuth client id. This is used for
  // guidance and error messages; the API remains the source of truth.
  redditRateLimitPerMinute: parsePositiveInt(process.env.REDDIT_RATE_LIMIT_PER_MINUTE, 100),
  // LinkedIn uses one Crewlink-owned OAuth app. A missing client id disables
  // automatic publishing and connection; drafts stay available. The redirect URI
  // is derived from APP_URL (/api/platforms/linkedin/callback) so there is no
  // second, conflicting source of truth.
  linkedinClientId: process.env.LINKEDIN_CLIENT_ID || '',
  linkedinClientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
  // Versioned endpoints take a YYYYMM LinkedIn-Version header. The raw value is
  // kept here and validated centrally in src/posting/linkedin/config.ts so a
  // malformed version fails closed instead of scattering defaults.
  linkedinApiVersion: process.env.LINKEDIN_API_VERSION || '',
  linkedinApiBaseUrl: (process.env.LINKEDIN_API_BASE_URL || 'https://api.linkedin.com').replace(
    /\/+$/,
    ''
  ),
  linkedinAuthorizeUrl:
    process.env.LINKEDIN_AUTHORIZE_URL || 'https://www.linkedin.com/oauth/v2/authorization',
  linkedinTokenUrl:
    process.env.LINKEDIN_TOKEN_URL || 'https://www.linkedin.com/oauth/v2/accessToken',
  // Member post analytics need the Community Management API and the
  // r_member_postAnalytics scope, which are not self-serve. Live analytics fetches
  // stay off until an approved app explicitly enables them.
  linkedinAnalyticsEnabled: process.env.LINKEDIN_ANALYTICS_ENABLED === 'true',
  // M9 analytics. Sync is an explicit owner action with a bounded post count and
  // deadline; snapshots are pruned to keep storage growth predictable.
  analyticsMaxPostsPerSync: parsePositiveInt(process.env.ANALYTICS_MAX_POSTS_PER_SYNC, 50),
  analyticsSyncTimeoutMs: parsePositiveInt(process.env.ANALYTICS_SYNC_TIMEOUT_MS, 20000),
  // Lease for the database-backed per-platform sync lock. Must exceed the sync
  // deadline so a live worker cannot lose its lease; a crashed worker is
  // recoverable after this period.
  analyticsSyncLeaseMs: parsePositiveInt(process.env.ANALYTICS_SYNC_LEASE_MS, 120000),
  // Optional service token for an external scheduler. Empty disables the
  // scheduler endpoint; the value must be at least 32 characters when set.
  analyticsSchedulerToken: process.env.ANALYTICS_SCHEDULER_TOKEN || '',
  analyticsSnapshotRetentionDays: parsePositiveInt(
    process.env.ANALYTICS_SNAPSHOT_RETENTION_DAYS,
    365
  ),
  analyticsSnapshotMaxPerEntity: parsePositiveInt(
    process.env.ANALYTICS_SNAPSHOT_MAX_PER_ENTITY,
    60
  ),
  analyticsMinSampleForTiming: parsePositiveInt(process.env.ANALYTICS_MIN_SAMPLE_FOR_TIMING, 8),
  // Slack uses one Crewlink-owned app. The owner installs it in their workspace
  // and chooses a channel; Crewlink never asks for or stores a person's token.
  // Missing credentials disable the connection flow without affecting drafts.
  slackClientId: process.env.SLACK_CLIENT_ID || '',
  slackClientSecret: process.env.SLACK_CLIENT_SECRET || '',
  slackAuthorizeUrl: process.env.SLACK_AUTHORIZE_URL || 'https://slack.com/oauth/v2/authorize',
  slackTokenUrl: process.env.SLACK_TOKEN_URL || 'https://slack.com/api/oauth.v2.access',
  slackApiBaseUrl: (process.env.SLACK_API_BASE_URL || 'https://slack.com/api').replace(/\/+$/, ''),
  // M8 AI workspace. There is no fallback between providers: the selected
  // provider either has its own key or the AI features fail closed. `mock` is
  // deterministic, makes no network calls, and is only the default in tests or
  // when AI_PROVIDER=mock is set explicitly for local exploration.
  aiProvider:
    process.env.AI_PROVIDER ||
    (process.env.NODE_ENV === 'test' ? 'mock' : 'unconfigured'),
  aiModel: process.env.AI_MODEL || '',
  aiTimeoutMs: parsePositiveInt(process.env.AI_TIMEOUT_MS, 30000),
  aiMaxRetries: parseNonNegativeInt(process.env.AI_MAX_RETRIES, 1),
  aiMaxOutputTokens: parsePositiveInt(process.env.AI_MAX_OUTPUT_TOKENS, 2048),
  // One research, one strategy, one generation and one quality call per idea is
  // the common path; variations multiply the last two. The limit still stops a
  // campaign before it can run unbounded.
  aiMaxLlmCallsPerCampaign: parsePositiveInt(process.env.AI_MAX_LLM_CALLS_PER_CAMPAIGN, 160),
  aiMaxDurationDays: parsePositiveInt(process.env.AI_MAX_DURATION_DAYS, 30),
  aiMaxIdeasPerCampaign: parsePositiveInt(process.env.AI_MAX_IDEAS_PER_CAMPAIGN, 40),
  aiVariationsPerIdea: parsePositiveInt(process.env.AI_VARIATIONS_PER_IDEA, 2),
  aiExecutionBudgetMs: parsePositiveInt(process.env.AI_EXECUTION_BUDGET_MS, 90000),
  aiMinScheduleGapMinutes: parsePositiveInt(process.env.AI_MIN_SCHEDULE_GAP_MINUTES, 120),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  openaiModel: process.env.OPENAI_MODEL || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicBaseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(
    /\/+$/,
    ''
  ),
  anthropicModel: process.env.ANTHROPIC_MODEL || '',
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || '',
  geminiBaseUrl: (
    process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'
  ).replace(/\/+$/, ''),
  geminiModel: process.env.GEMINI_MODEL || '',
  // Research uses only documented search APIs. `none` means the research step
  // records questions and assumptions instead of pretending to have sources.
  aiResearchProvider: parseResearchProvider(process.env.AI_RESEARCH_PROVIDER),
  braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY || '',
  braveSearchUrl: (
    process.env.BRAVE_SEARCH_URL || 'https://api.search.brave.com/res/v1/web/search'
  ).replace(/\/+$/, ''),
};

export default config;
