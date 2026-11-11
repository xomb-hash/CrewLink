import { config } from '../config/index';
import { normalizeReferralCode } from './referral';
import { referralCodeState } from './referralState';
import type { ShareLinks } from '../types/index';

// --- Project fields that decide whether the reusable code URL can be shared ---
interface ShareProject {
  slug: string;
  title: string;
  referralCode?: string;
  referralCodeCreatedAt?: string;
  referralCodeExpiresAt?: string;
  referralCodeUsageLimit?: number;
  referralCodeRevokedAt?: string;
  referralCodeUsedAt?: string;
  createdAt?: string;
}

// --- Build the join URL and social links for the current code state ---
export function generateShareLinks(
  project: ShareProject,
  baseUrl = config.appUrl,
  usageCount: number = 0
): ShareLinks {
  // --- Only an active link uses the code URL; otherwise fall back to the slug ---
  const code =
    referralCodeState(project, usageCount) === 'active'
      ? normalizeReferralCode(project.referralCode)
      : '';
  const joinUrl = code
    ? `${baseUrl}/join/${encodeURIComponent(code)}`
    : `${baseUrl}/join/${project.slug}`;
  const textPrompt = `Build with us on ${project.title}:`;
  const fullMessage = `${textPrompt} ${joinUrl}`;

  // --- Every social link points at the same resolved join URL ---
  return {
    joinUrl,
    linkedIn: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(joinUrl)}`,
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(textPrompt)}&url=${encodeURIComponent(joinUrl)}`,
    whatsApp: `https://api.whatsapp.com/send?text=${encodeURIComponent(fullMessage)}`,
  };
}
