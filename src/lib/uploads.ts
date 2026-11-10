import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Storage, type StorageOptions } from '@google-cloud/storage';
import { config } from '@/config/index';
import { logger } from '@/lib/logger';

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const STORED_NAME_PATTERN = /^[a-f0-9-]+\.pdf$/;
const LOGO_NAME_PATTERN = /^logo-[a-f0-9-]+\.(png|jpg|webp)$/;
const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export class ResumeUploadError extends Error {}
export class LogoUploadError extends Error {}

function uploadsDir(): string {
  return path.resolve(process.cwd(), 'data', 'uploads');
}

type GcsBucket = ReturnType<Storage['bucket']>;

let gcsBucket: GcsBucket | null = null;

function getGcsBucket(): GcsBucket | null {
  if (!config.gcsBucketName) return null;
  if (gcsBucket) return gcsBucket;

  const options: StorageOptions = {};
  if (config.gcpProjectId) options.projectId = config.gcpProjectId;
  if (config.gcsCredentialsJson) {
    try {
      options.credentials = JSON.parse(config.gcsCredentialsJson);
    } catch (err) {
      logger.error('Invalid GCS_CREDENTIALS_JSON', err);
      throw new Error('Invalid GCS_CREDENTIALS_JSON: expected a service account key JSON.');
    }
  }

  gcsBucket = new Storage(options).bucket(config.gcsBucketName);
  return gcsBucket;
}

export function resumeStorageMode(): 'google-cloud-storage' | 'local-disk' {
  return config.gcsBucketName ? 'google-cloud-storage' : 'local-disk';
}

export function validateResumeFile(file: { size: number; type: string; name: string }): string | null {
  if (file.size <= 0) return 'The uploaded resume is empty.';
  if (file.size > MAX_RESUME_BYTES) return 'Resume must be 5 MB or smaller.';
  const looksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!looksLikePdf) return 'Resume must be a PDF file.';
  return null;
}

export function resumeDownloadName(originalName: string): string {
  const base = path
    .basename(originalName)
    .replace(/[\r\n"\\]/g, '')
    .slice(0, 120);
  return base || 'resume.pdf';
}

export async function saveResume(file: File): Promise<{ storedName: string; fileName: string }> {
  const invalid = validateResumeFile(file);
  if (invalid) throw new ResumeUploadError(invalid);

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new ResumeUploadError('Resume must be a valid PDF file.');
  }

  const storedName = `${crypto.randomUUID()}.pdf`;
  const bucket = getGcsBucket();

  if (bucket) {
    try {
      await bucket.file(storedName).save(buffer, {
        contentType: 'application/pdf',
        resumable: false,
        metadata: { cacheControl: 'private, no-store' },
      });
    } catch (err) {
      logger.error('GCS resume upload failed', err, { storedName });
      throw err;
    }
  } else {
    await fs.mkdir(uploadsDir(), { recursive: true });
    await fs.writeFile(path.join(uploadsDir(), storedName), buffer);
  }

  return { storedName, fileName: resumeDownloadName(file.name) };
}

export async function deleteResume(storedName?: string): Promise<void> {
  if (!storedName || !STORED_NAME_PATTERN.test(storedName)) return;

  const bucket = getGcsBucket();
  if (bucket) {
    try {
      await bucket.file(storedName).delete({ ignoreNotFound: true });
    } catch (err) {
      logger.error('GCS resume delete failed', err, { storedName });
    }
    return;
  }

  await fs.rm(path.join(uploadsDir(), storedName), { force: true });
}

export async function readResume(storedName?: string): Promise<Buffer | null> {
  if (!storedName || !STORED_NAME_PATTERN.test(storedName)) return null;

  const bucket = getGcsBucket();
  if (bucket) {
    try {
      const [contents] = await bucket.file(storedName).download();
      return contents;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      logger.error('GCS resume download failed', err, { storedName });
      throw err;
    }
  }

  try {
    return await fs.readFile(path.join(uploadsDir(), storedName));
  } catch {
    return null;
  }
}

export function validateLogoFile(file: { size: number; type: string; name: string }): string | null {
  if (file.size <= 0) return 'The uploaded logo is empty.';
  if (file.size > MAX_LOGO_BYTES) return 'Logo must be 2 MB or smaller.';
  if (!LOGO_TYPES.has(file.type)) return 'Logo must be a PNG, JPEG, or WebP image.';
  const ext = path.extname(file.name).toLowerCase();
  if (ext && !['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    return 'Logo must be a PNG, JPEG, or WebP image.';
  }
  return null;
}

function detectImageType(buffer: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export async function saveLogo(file: File): Promise<{ storedName: string }> {
  const invalid = validateLogoFile(file);
  if (invalid) throw new LogoUploadError(invalid);

  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = detectImageType(buffer);
  if (!kind) throw new LogoUploadError('Logo must be a valid PNG, JPEG, or WebP image.');

  const storedName = `logo-${crypto.randomUUID()}.${kind}`;
  await fs.mkdir(uploadsDir(), { recursive: true });
  await fs.writeFile(path.join(uploadsDir(), storedName), buffer);

  return { storedName };
}

export async function deleteLogo(storedName?: string): Promise<void> {
  if (!storedName || !LOGO_NAME_PATTERN.test(storedName)) return;
  await fs.rm(path.join(uploadsDir(), storedName), { force: true });
}

export async function readLogo(
  storedName?: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!storedName || !LOGO_NAME_PATTERN.test(storedName)) return null;
  try {
    const buffer = await fs.readFile(path.join(uploadsDir(), storedName));
    const contentType = storedName.endsWith('.png')
      ? 'image/png'
      : storedName.endsWith('.webp')
      ? 'image/webp'
      : 'image/jpeg';
    return { buffer, contentType };
  } catch {
    return null;
  }
}
