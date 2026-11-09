import { config } from '../config/index';
import type { Project, ShareLinks } from '../types/index';

export function generateShareLinks(
  project: Pick<Project, 'slug' | 'title' | 'referralCode'>,
  baseUrl = config.appUrl
): ShareLinks {
  const code = project.referralCode?.trim().toUpperCase();
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
