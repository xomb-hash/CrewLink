export type ReferralCodeState =
  | 'active'
  | 'expired'
  | 'limit-reached'
  | 'revoked'
  | 'used'
  | 'missing';

// --- Minimal project shape these helpers need (a full Project satisfies it) ---
interface ReferralCodeFields {
  referralCode?: string;
  referralCodeCreatedAt?: string;
  referralCodeExpiresAt?: string;
  referralCodeUsageLimit?: number;
  referralCodeRevokedAt?: string;
  referralCodeUsedAt?: string;
  createdAt?: string;
}

// --- Optional expiry parsing; an unset or invalid date means "no expiry" ---
function expiryTime(project: ReferralCodeFields): number | null {
  if (!project.referralCodeExpiresAt) return null;
  const time = new Date(project.referralCodeExpiresAt).getTime();
  return Number.isNaN(time) ? null : time;
}

// --- ISO expiry for display (null when the owner set no expiry) ---
export function referralCodeExpiresAt(project: ReferralCodeFields): string | null {
  const time = expiryTime(project);
  return time === null ? null : new Date(time).toISOString();
}

// --- Optional usage cap; 0/missing means unlimited ---
export function referralCodeLimit(project: ReferralCodeFields): number | null {
  const limit = Number(project.referralCodeUsageLimit);
  return Number.isFinite(limit) && limit > 0 ? limit : null;
}

// --- State machine: the first matching blocker wins ---
// --- missing → revoked → legacy used → expired → limit reached → active ---
export function referralCodeState(
  project: ReferralCodeFields,
  usageCount: number = 0,
  now: number = Date.now()
): ReferralCodeState {
  if (!project.referralCode) return 'missing';
  if (project.referralCodeRevokedAt) return 'revoked';
  // Legacy single-use codes stay closed instead of becoming reusable.
  if (project.referralCodeUsedAt) return 'used';
  const expiresAt = expiryTime(project);
  if (expiresAt !== null && now >= expiresAt) return 'expired';
  const limit = referralCodeLimit(project);
  if (limit !== null && usageCount >= limit) return 'limit-reached';
  return 'active';
}

// --- Server-side messages shown on the join page and returned by the API ---
export function referralCodeErrorMessage(state: ReferralCodeState): string {
  switch (state) {
    case 'missing':
      return 'This project requires a referral code.';
    case 'revoked':
      return 'This invite link has been revoked. Ask the creator for a new one.';
    case 'used':
      return 'This invite link has already been used. Ask the creator for a new one.';
    case 'expired':
      return 'This invite link has expired. Ask the creator for a new one.';
    case 'limit-reached':
      return 'This invite link has reached its usage limit. Ask the creator for a new one.';
    default:
      return '';
  }
}
