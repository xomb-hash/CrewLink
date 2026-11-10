export const REFERRAL_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ReferralCodeState = 'active' | 'used' | 'expired' | 'missing';

interface ReferralCodeFields {
  referralCode?: string;
  referralCodeCreatedAt?: string;
  referralCodeUsedAt?: string;
  createdAt?: string;
}

function codeIssuedAt(project: ReferralCodeFields): number | null {
  const raw = project.referralCodeCreatedAt || project.createdAt;
  if (!raw) return null;
  const issuedAt = new Date(raw).getTime();
  return Number.isNaN(issuedAt) ? null : issuedAt;
}

export function referralCodeExpiresAt(project: ReferralCodeFields): string | null {
  const issuedAt = codeIssuedAt(project);
  return issuedAt === null ? null : new Date(issuedAt + REFERRAL_CODE_TTL_MS).toISOString();
}

export function referralCodeState(
  project: ReferralCodeFields,
  now: number = Date.now()
): ReferralCodeState {
  if (!project.referralCode) return 'missing';
  if (project.referralCodeUsedAt) return 'used';
  const issuedAt = codeIssuedAt(project);
  if (issuedAt === null) return 'active';
  return now < issuedAt + REFERRAL_CODE_TTL_MS ? 'active' : 'expired';
}
