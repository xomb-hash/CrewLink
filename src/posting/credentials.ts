import crypto from 'node:crypto';
import { KeyManagementServiceClient } from '@google-cloud/kms';
import { config } from '../config/index';

export type CredentialProvider = 'gcp' | 'local';

export interface CredentialContext {
  userId: string;
  platformId: string;
  connectionId: string;
}

export interface EncryptedCredential {
  ciphertext: string;
  provider: CredentialProvider;
  keyRef: string;
}

export interface CredentialVault {
  readonly provider: CredentialProvider;
  encrypt(plaintext: string, context: CredentialContext): Promise<EncryptedCredential>;
  decrypt(credential: EncryptedCredential, context: CredentialContext): Promise<string>;
}

export class CredentialError extends Error {}
export class CredentialConfigError extends CredentialError {}
export class CredentialEncryptionError extends CredentialError {}
export class CredentialDecryptionError extends CredentialError {}

const LOCAL_PAYLOAD_PREFIX = 'crewlink:v1:local';
const LOCAL_IV_BYTES = 12;

// AAD binds every ciphertext to one user, platform and connection so rows cannot
// be copied between accounts. The version and provider are bound too.
function buildAad(provider: CredentialProvider, context: CredentialContext): Buffer {
  for (const field of ['userId', 'platformId', 'connectionId'] as const) {
    if (!context[field] || typeof context[field] !== 'string') {
      throw new CredentialConfigError(`Credential context is missing ${field}.`);
    }
  }
  return Buffer.from(
    `crewlink:v1:${provider}:${context.userId}:${context.platformId}:${context.connectionId}`,
    'utf8'
  );
}

// --- Local provider: versioned AES-256-GCM for development and tests ---

type EnvLike = Record<string, string | undefined>;

function localSecretForVersion(version: number, env: EnvLike): string {
  const specific = env[`ENCRYPTION_SECRET_V${version}`];
  if (specific) return specific;
  if (version === 1) {
    // Backwards compatible with the pre-vault single secret.
    const legacy = env.ENCRYPTION_SECRET || env.SESSION_SECRET;
    if (legacy) return legacy;
  }
  throw new CredentialConfigError(
    `No encryption secret is configured for key version ${version}. Set ENCRYPTION_SECRET_V${version}.`
  );
}

function activeLocalVersion(env: EnvLike): number {
  let highest = 0;
  for (const [name, value] of Object.entries(env)) {
    const match = /^ENCRYPTION_SECRET_V(\d+)$/.exec(name);
    if (match && value) highest = Math.max(highest, Number(match[1]));
  }
  if (highest > 0) return highest;
  if (env.ENCRYPTION_SECRET || env.SESSION_SECRET) return 1;
  throw new CredentialConfigError(
    'ENCRYPTION_SECRET (or ENCRYPTION_SECRET_V1) is required for local credential encryption.'
  );
}

function localKey(version: number, env: EnvLike): Buffer {
  return crypto.createHash('sha256').update(localSecretForVersion(version, env)).digest();
}

export class LocalCredentialVault implements CredentialVault {
  readonly provider = 'local' as const;

  constructor(private env: EnvLike = process.env) {}

  async encrypt(plaintext: string, context: CredentialContext): Promise<EncryptedCredential> {
    if (!plaintext) throw new CredentialEncryptionError('Cannot encrypt an empty credential.');
    try {
      const version = activeLocalVersion(this.env);
      const iv = crypto.randomBytes(LOCAL_IV_BYTES);
      const cipher = crypto.createCipheriv('aes-256-gcm', localKey(version, this.env), iv);
      cipher.setAAD(buildAad('local', context));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return {
        ciphertext: `${LOCAL_PAYLOAD_PREFIX}:v${version}:${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`,
        provider: 'local',
        keyRef: `local:v${version}`,
      };
    } catch (err) {
      if (err instanceof CredentialError) throw err;
      throw new CredentialEncryptionError('Local credential encryption failed.');
    }
  }

  async decrypt(credential: EncryptedCredential, context: CredentialContext): Promise<string> {
    if (credential.provider !== 'local') {
      throw new CredentialDecryptionError('Credential was not encrypted with the local provider.');
    }
    const parts = String(credential.ciphertext || '').split(':');
    if (parts.length !== 7 || `${parts[0]}:${parts[1]}:${parts[2]}` !== LOCAL_PAYLOAD_PREFIX) {
      throw new CredentialDecryptionError('Credential ciphertext is malformed.');
    }
    const version = Number(parts[3].replace(/^v/, ''));
    if (!Number.isInteger(version) || version < 1 || credential.keyRef !== `local:v${version}`) {
      throw new CredentialDecryptionError('Credential key reference does not match its ciphertext.');
    }
    try {
      const iv = Buffer.from(parts[4], 'hex');
      const authTag = Buffer.from(parts[5], 'hex');
      if (iv.length !== LOCAL_IV_BYTES || authTag.length !== 16) {
        throw new Error('bad iv or tag');
      }
      const decipher = crypto.createDecipheriv('aes-256-gcm', localKey(version, this.env), iv);
      decipher.setAAD(buildAad('local', context));
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(parts[6], 'hex')),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch (err) {
      if (err instanceof CredentialError) throw err;
      throw new CredentialDecryptionError(
        'Credential could not be decrypted with the configured key.'
      );
    }
  }
}

// --- GCP provider: Cloud KMS encrypts each token directly (tokens are far below 64 KiB) ---

export interface KmsClientLike {
  encrypt(request: {
    name: string;
    plaintext: Buffer;
    additionalAuthenticatedData: Buffer;
  }): Promise<Array<{ ciphertext?: Uint8Array | string | null; name?: string | null }>>;
  decrypt(request: {
    name: string;
    ciphertext: Buffer;
    additionalAuthenticatedData: Buffer;
  }): Promise<Array<{ plaintext?: Uint8Array | string | null }>>;
}

function toBase64(value: Uint8Array | string): string {
  return typeof value === 'string' ? value : Buffer.from(value).toString('base64');
}

export interface GcpKmsVaultOptions {
  keyName: string;
  client?: KmsClientLike;
}

export class GcpKmsVault implements CredentialVault {
  readonly provider = 'gcp' as const;
  private client: KmsClientLike | null;

  constructor(private options: GcpKmsVaultOptions) {
    this.client = options.client || null;
  }

  private getClient(): KmsClientLike {
    if (!this.options.keyName) {
      throw new CredentialConfigError('GOOGLE_CLOUD_KMS_KEY is required when CREDENTIAL_PROVIDER=gcp.');
    }
    if (!this.client) {
      // Uses Application Default Credentials; no service-account keys are embedded.
      this.client = new KeyManagementServiceClient() as unknown as KmsClientLike;
    }
    return this.client;
  }

  async encrypt(plaintext: string, context: CredentialContext): Promise<EncryptedCredential> {
    if (!plaintext) throw new CredentialEncryptionError('Cannot encrypt an empty credential.');
    const client = this.getClient();
    try {
      const [response] = await client.encrypt({
        name: this.options.keyName,
        plaintext: Buffer.from(plaintext, 'utf8'),
        additionalAuthenticatedData: buildAad('gcp', context),
      });
      if (!response.ciphertext) {
        throw new Error('empty ciphertext');
      }
      return {
        ciphertext: toBase64(response.ciphertext),
        provider: 'gcp',
        // KMS returns the exact key version used; decrypt accepts it too.
        keyRef: response.name || this.options.keyName,
      };
    } catch (err) {
      if (err instanceof CredentialError) throw err;
      throw new CredentialEncryptionError('Google Cloud KMS encryption failed.');
    }
  }

  async decrypt(credential: EncryptedCredential, context: CredentialContext): Promise<string> {
    if (credential.provider !== 'gcp') {
      throw new CredentialDecryptionError('Credential was not encrypted with Google Cloud KMS.');
    }
    if (!credential.keyRef) {
      throw new CredentialDecryptionError('Credential is missing its KMS key reference.');
    }
    const client = this.getClient();
    try {
      const [response] = await client.decrypt({
        name: credential.keyRef,
        ciphertext: Buffer.from(credential.ciphertext, 'base64'),
        additionalAuthenticatedData: buildAad('gcp', context),
      });
      if (!response.plaintext) {
        throw new Error('empty plaintext');
      }
      const value = Buffer.from(response.plaintext as Uint8Array | string);
      return value.toString('utf8');
    } catch (err) {
      if (err instanceof CredentialError) throw err;
      throw new CredentialDecryptionError('Google Cloud KMS decryption failed.');
    }
  }
}

let cachedVault: CredentialVault | null = null;

// Provider selection is explicit: a gcp failure never falls back to local encryption.
export function getCredentialVault(): CredentialVault {
  if (cachedVault) return cachedVault;
  cachedVault =
    config.credentialProvider === 'gcp'
      ? new GcpKmsVault({ keyName: config.googleCloudKmsKey })
      : new LocalCredentialVault();
  return cachedVault;
}

export function resetCredentialVaultForTests(): void {
  cachedVault = null;
}
