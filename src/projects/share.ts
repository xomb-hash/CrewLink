import { config } from '../config/index';
import { referralCodeState } from './referralState';
import type { ShareLinks } from '../types/index';

interface ShareProject {
  slug: string;
  title: string;
  referralCode?: string;
  referralCodeCreatedAt?: string;
  referralCodeUsedAt?: string;
  createdAt?: string;
}

export function generateShareLinks(
  project: ShareProject,
  baseUrl = config.appUrl
): ShareLinks {
  const activeCode = referralCodeState(project) === 'active' ? project.referralCode : undefined;
  const code = activeCode?.trim().toUpperCase();
  const joinUrl = code
    ? `${baseUrl}/join/${project.slug}?ref=${encodeURIComponent(code)}`
    : `${baseUrl}/join/${project.slug}`;
  const textPrompt = `Build with us on ${project.title}:`;
  const fullMessage = `${textPrompt} ${joinUrl}`;

  return {
    joinUrl,
    linkedIn: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(joinUrl)}`,
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(textPrompt)}&url=${encodeURIComponent(joinUrl)}`,
    whatsApp: `https://api.whatsapp.com/send?text=${encodeURIComponent(fullMessage)}`,
  };
}
