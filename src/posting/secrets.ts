import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { config } from '../config/index';

export interface SecretStore {
  readonly provider: 'env' | 'gcp';
  /** Returns the secret value, or null when it is not configured (env provider). */
  get(name: string): Promise<string | null>;
}

export class SecretStoreError extends Error {}

const SECRET_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

export function normalizeSecretName(name: string): string {
  if (!SECRET_NAME_PATTERN.test(String(name || ''))) {
    throw new SecretStoreError('Secret names may only contain letters, digits and underscores.');
  }
  return name;
}

// Application-level secrets (OAuth client secrets, shared bot tokens) only.
// Per-user access and refresh tokens are never stored here.
export class EnvSecretStore implements SecretStore {
  readonly provider = 'env' as const;

  constructor(private env: Record<string, string | undefined> = process.env) {}

  async get(name: string): Promise<string | null> {
    const normalized = normalizeSecretName(name);
    const value = this.env[normalized];
    return value === undefined || value === '' ? null : value;
  }
}

export interface SecretManagerClientLike {
  accessSecretVersion(request: { name: string }): Promise<
    Array<{ payload?: { data?: Uint8Array | string | null } | null }>
  >;
}

export interface GcpSecretStoreOptions {
  project: string;
  prefix: string;
  client?: SecretManagerClientLike;
  cacheTtlMs?: number;
  now?: () => number;
}

export class GcpSecretStore implements SecretStore {
  readonly provider = 'gcp' as const;
  private client: SecretManagerClientLike | null;
  private cache = new Map<string, { value: string; expiresAt: number }>();
  private cacheTtlMs: number;
  private now: () => number;

  constructor(private options: GcpSecretStoreOptions) {
    this.client = options.client || null;
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;
    this.now = options.now || Date.now;
  }

  private getClient(): SecretManagerClientLike {
    if (!this.options.project) {
      throw new SecretStoreError('GOOGLE_CLOUD_PROJECT is required when SECRETS_PROVIDER=gcp.');
    }
    if (!this.client) {
      this.client = new SecretManagerServiceClient() as unknown as SecretManagerClientLike;
    }
    return this.client;
  }

  async get(name: string): Promise<string | null> {
    const normalized = normalizeSecretName(name);
    const cached = this.cache.get(normalized);
    const now = this.now();
    if (cached && cached.expiresAt > now) return cached.value;

    const secretName = `projects/${this.options.project}/secrets/${this.options.prefix}${normalized
      .toLowerCase()
      .replace(/_/g, '-')}/versions/latest`;

    try {
      const [response] = await this.getClient().accessSecretVersion({ name: secretName });
      const data = response.payload?.data;
      if (!data) throw new Error('empty secret payload');
      const value = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
      this.cache.set(normalized, { value, expiresAt: now + this.cacheTtlMs });
      return value;
    } catch (err) {
      if (err instanceof SecretStoreError) throw err;
      // Fail closed: never fall back to environment variables in gcp mode.
      throw new SecretStoreError(`Secret ${normalized} could not be read from Secret Manager.`);
    }
  }
}

let cachedStore: SecretStore | null = null;

export function getSecretStore(): SecretStore {
  if (cachedStore) return cachedStore;
  cachedStore =
    config.secretsProvider === 'gcp'
      ? new GcpSecretStore({
          project: config.googleCloudProject,
          prefix: config.googleSecretManagerPrefix,
        })
      : new EnvSecretStore();
  return cachedStore;
}

export function resetSecretStoreForTests(): void {
  cachedStore = null;
}
