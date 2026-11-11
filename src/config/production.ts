// Production startup validation. It fails closed before the server accepts
// traffic when security-critical configuration is missing. It never prints a
// secret value; only variable names and safe descriptions appear in errors.

export class ProductionConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `Crewlink production configuration is invalid:\n- ${problems.join('\n- ')}`
    );
    this.name = 'ProductionConfigError';
  }
}

const DEFAULT_SESSION_SECRET =
  'crewlink-dev-secret-key-change-in-production-32chars';
const PLACEHOLDER_SECRETS = new Set([
  'changeme',
  'change-me',
  'secret',
  'password',
  'test',
  'development',
]);

function text(env: Record<string, string | undefined>, key: string): string {
  return String(env[key] ?? '').trim();
}

function isStrongSecret(value: string): boolean {
  return (
    value.length >= 32 &&
    value !== DEFAULT_SESSION_SECRET &&
    !PLACEHOLDER_SECRETS.has(value.toLowerCase())
  );
}

function isPostgresUrl(value: string): boolean {
  return value.startsWith('postgresql://') || value.startsWith('postgres://');
}

function positiveInt(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export interface ProductionConfigResult {
  warnings: string[];
}

// Pure enough to test with a custom env object. The caller decides whether to
// throw; production startup should.
export function validateProductionConfig(
  env: Record<string, string | undefined> = process.env
): ProductionConfigResult {
  const warnings: string[] = [];
  if (text(env, 'NODE_ENV') !== 'production') return { warnings };
  // Next.js runs instrumentation during build/static analysis in some setups.
  // Build-time validation is not a deployment configuration check.
  if (text(env, 'NEXT_PHASE').includes('production-build')) return { warnings };

  const problems: string[] = [];
  const appUrl = text(env, 'APP_URL');
  if (!appUrl) {
    problems.push('APP_URL is required in production.');
  } else {
    try {
      const parsed = new URL(appUrl);
      if (parsed.protocol !== 'https:') {
        problems.push('APP_URL must use https:// in production.');
      }
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        problems.push('APP_URL must not point at localhost in production.');
      }
    } catch {
      problems.push('APP_URL must be an absolute URL.');
    }
  }

  const sessionSecret = text(env, 'SESSION_SECRET');
  if (!isStrongSecret(sessionSecret)) {
    problems.push(
      'SESSION_SECRET must be set to a unique value of at least 32 characters (not the development default).'
    );
  }

  const encryptionSecret =
    text(env, 'ENCRYPTION_SECRET_V1') || text(env, 'ENCRYPTION_SECRET');
  if (!isStrongSecret(encryptionSecret)) {
    problems.push(
      'ENCRYPTION_SECRET_V1 (or ENCRYPTION_SECRET) must be a unique value of at least 32 characters. GitHub tokens are encrypted with it.'
    );
  }

  const databaseUrl = text(env, 'DATABASE_URL');
  if (!isPostgresUrl(databaseUrl)) {
    problems.push(
      'DATABASE_URL must be a PostgreSQL URL in production; the file-backed store is development/test only.'
    );
  }

  const transport = text(env, 'PUBLISHING_TRANSPORT');
  if (transport !== 'live' && transport !== 'mock') {
    problems.push(
      'PUBLISHING_TRANSPORT must be explicitly set to "live" or "mock" in production. It never defaults silently.'
    );
  } else if (transport === 'mock') {
    warnings.push(
      'PUBLISHING_TRANSPORT=mock is explicit: no real publishing or analytics network calls will be made.'
    );
  } else {
    const configuredPlatforms = [
      text(env, 'DISCORD_BOT_TOKEN'),
      text(env, 'TELEGRAM_BOT_TOKEN'),
      text(env, 'X_CLIENT_ID'),
      text(env, 'REDDIT_CLIENT_ID'),
      text(env, 'LINKEDIN_CLIENT_ID'),
      text(env, 'SLACK_CLIENT_ID'),
    ].filter(Boolean).length;
    if (configuredPlatforms === 0) {
      warnings.push(
        'PUBLISHING_TRANSPORT=live but no platform credentials are configured; platform use will fail closed until they are added.'
      );
    }
  }

  const credentialProvider = text(env, 'CREDENTIAL_PROVIDER') || 'local';
  if (!['local', 'gcp'].includes(credentialProvider)) {
    problems.push('CREDENTIAL_PROVIDER must be "local" or "gcp".');
  }
  if (credentialProvider === 'gcp' && !text(env, 'GOOGLE_CLOUD_KMS_KEY')) {
    problems.push('GOOGLE_CLOUD_KMS_KEY is required when CREDENTIAL_PROVIDER=gcp.');
  }
  const secretsProvider = text(env, 'SECRETS_PROVIDER') || 'env';
  if (!['env', 'gcp'].includes(secretsProvider)) {
    problems.push('SECRETS_PROVIDER must be "env" or "gcp".');
  }
  if (secretsProvider === 'gcp' && !text(env, 'GOOGLE_CLOUD_PROJECT')) {
    problems.push('GOOGLE_CLOUD_PROJECT is required when SECRETS_PROVIDER=gcp.');
  }

  const aiProvider = text(env, 'AI_PROVIDER') || 'unconfigured';
  if (aiProvider === 'openai' && !text(env, 'OPENAI_API_KEY')) {
    problems.push('OPENAI_API_KEY is required when AI_PROVIDER=openai.');
  }
  if (aiProvider === 'anthropic' && !text(env, 'ANTHROPIC_API_KEY')) {
    problems.push('ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic.');
  }
  if (aiProvider === 'gemini' && !(text(env, 'GEMINI_API_KEY') || text(env, 'GOOGLE_AI_API_KEY'))) {
    problems.push('GEMINI_API_KEY is required when AI_PROVIDER=gemini.');
  }
  if (aiProvider === 'mock') {
    warnings.push(
      'AI_PROVIDER=mock is explicit: AI output is deterministic and no model network call will be made.'
    );
  }
  if (!['unconfigured', 'mock', 'openai', 'anthropic', 'gemini'].includes(aiProvider)) {
    problems.push(
      'AI_PROVIDER must be one of unconfigured, mock, openai, anthropic or gemini.'
    );
  }

  const researchProvider = text(env, 'AI_RESEARCH_PROVIDER') || 'none';
  if (!['none', 'brave', 'reddit', 'both'].includes(researchProvider)) {
    problems.push('AI_RESEARCH_PROVIDER must be none, brave, reddit or both.');
  }
  if (
    (researchProvider === 'reddit' || researchProvider === 'both') &&
    (!text(env, 'REDDIT_CLIENT_ID') || !text(env, 'REDDIT_CLIENT_SECRET'))
  ) {
    problems.push(
      'REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are required when AI_RESEARCH_PROVIDER uses Reddit.'
    );
  }
  if (researchProvider === 'brave' || researchProvider === 'both') {
    if (!text(env, 'BRAVE_SEARCH_API_KEY')) {
      problems.push('BRAVE_SEARCH_API_KEY is required when AI_RESEARCH_PROVIDER=both.');
    }
  }

  if (text(env, 'LINKEDIN_ANALYTICS_ENABLED') === 'true') {
    if (!text(env, 'LINKEDIN_CLIENT_ID') || !text(env, 'LINKEDIN_CLIENT_SECRET')) {
      problems.push(
        'LINKEDIN_ANALYTICS_ENABLED=true requires LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET.'
      );
    }
  }

  const schedulerToken = text(env, 'ANALYTICS_SCHEDULER_TOKEN');
  if (schedulerToken && schedulerToken.length < 32) {
    problems.push(
      'ANALYTICS_SCHEDULER_TOKEN must be at least 32 characters when set; leave it empty to disable the scheduler endpoint.'
    );
  }

  const leaseRaw = text(env, 'ANALYTICS_SYNC_LEASE_MS');
  const timeoutRaw = text(env, 'ANALYTICS_SYNC_TIMEOUT_MS');
  const lease = positiveInt(leaseRaw);
  const timeout = positiveInt(timeoutRaw);
  if (leaseRaw && lease === null) {
    problems.push('ANALYTICS_SYNC_LEASE_MS must be a positive integer when set.');
  }
  if (timeoutRaw && timeout === null) {
    problems.push('ANALYTICS_SYNC_TIMEOUT_MS must be a positive integer when set.');
  }
  if (lease !== null && timeout !== null && lease <= timeout) {
    problems.push(
      'ANALYTICS_SYNC_LEASE_MS must be greater than ANALYTICS_SYNC_TIMEOUT_MS so the lease cannot expire during a live sync.'
    );
  }

  if (problems.length) throw new ProductionConfigError(problems);
  return { warnings };
}

export function assertProductionConfig(
  env: Record<string, string | undefined> = process.env
): void {
  validateProductionConfig(env);
}
