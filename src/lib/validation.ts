export function formatAccountAge(createdAt?: string | null): string {
  if (!createdAt) return 'Unknown';
  const createdDate = new Date(createdAt);
  if (Number.isNaN(createdDate.getTime())) return 'Unknown';

  const now = new Date();
  let years = now.getFullYear() - createdDate.getFullYear();
  let months = now.getMonth() - createdDate.getMonth();

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years > 0) {
    const yrStr = years === 1 ? '1 year' : `${years} years`;
    if (months > 0) {
      const moStr = months === 1 ? '1 month' : `${months} months`;
      return `${yrStr}, ${moStr}`;
    }
    return yrStr;
  }

  if (months > 0) {
    return months === 1 ? '1 month' : `${months} months`;
  }

  const days = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'Joined today';
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export interface ProjectInput {
  repoFullName: string;
  joinMode?: 'referral' | 'screening';
  screeningUrl?: string;
  screeningNote?: string;
  title?: string;
  description?: string;
  isPrivate?: boolean;
  creatorNote?: string;
  requireResume?: boolean;
  requireGithubLink?: boolean;
  requireLinkedinLink?: boolean;
}

export function validateProjectInput(data: Partial<ProjectInput>) {
  const errors: string[] = [];

  let cleanRepoFullName = '';
  if (!data.repoFullName || typeof data.repoFullName !== 'string') {
    errors.push('Repository full name is required (e.g. owner/repo).');
  } else {
    // Strip leading github.com/ if pasted as full URL, and strip trailing .git
    cleanRepoFullName = data.repoFullName
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/, '')
      .replace(/^\/+|\/+$/g, '');

    if (!/^[\w.-]+\/[\w.-]+$/.test(cleanRepoFullName)) {
      errors.push('Invalid repository format. Expected "owner/repo".');
    }
  }

  const joinMode: 'referral' | 'screening' = data.joinMode === 'screening' ? 'screening' : 'referral';

  let screeningUrl = '';
  if (joinMode === 'screening') {
    screeningUrl = typeof data.screeningUrl === 'string' ? data.screeningUrl.trim() : '';
    if (!screeningUrl) {
      errors.push('Screening link is required when screening mode is selected.');
    } else {
      try {
        const parsed = new URL(screeningUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          errors.push('Screening link must begin with http:// or https://');
        }
      } catch {
        errors.push('Screening link must be a valid URL.');
      }
    }
  }

  const title =
    data.title && typeof data.title === 'string'
      ? data.title.trim().slice(0, 100)
      : cleanRepoFullName
      ? cleanRepoFullName.split('/')[1]
      : '';

  const description =
    data.description && typeof data.description === 'string'
      ? data.description.trim().slice(0, 500)
      : '';

  const screeningNote =
    data.screeningNote && typeof data.screeningNote === 'string'
      ? data.screeningNote.trim().slice(0, 280)
      : '';

  const creatorNote =
    data.creatorNote && typeof data.creatorNote === 'string'
      ? data.creatorNote.trim().slice(0, 600)
      : '';

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      repoFullName: cleanRepoFullName,
      joinMode,
      screeningUrl,
      screeningNote,
      title,
      description,
      isPrivate: Boolean(data.isPrivate),
      creatorNote,
      requireResume: Boolean(data.requireResume),
      requireGithubLink: Boolean(data.requireGithubLink),
      requireLinkedinLink: Boolean(data.requireLinkedinLink),
    },
  };
}


export function normalizeProfileUrl(
  raw: unknown,
  kind: 'github' | 'linkedin'
): { url: string; error?: string } {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { url: '' };

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value.replace(/^\/+/, '')}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { url: '', error: kind === 'github' ? 'GitHub link must be a valid URL.' : 'LinkedIn link must be a valid URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { url: '', error: kind === 'github' ? 'GitHub link must be a valid URL.' : 'LinkedIn link must be a valid URL.' };
  }

  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname.split('/').filter(Boolean);

  if (kind === 'github') {
    if ((host !== 'github.com' && host !== 'www.github.com') || segments.length < 1) {
      return { url: '', error: 'GitHub link must point to a github.com profile.' };
    }
    return { url: `https://github.com/${segments[0]}` };
  }

  if (host !== 'linkedin.com' && host !== 'www.linkedin.com') {
    return { url: '', error: 'LinkedIn link must point to a linkedin.com profile.' };
  }
  if (segments.length < 2 || segments[0].toLowerCase() !== 'in') {
    return { url: '', error: 'LinkedIn link must point to a linkedin.com/in/ profile.' };
  }
  return { url: `https://www.linkedin.com/${segments[0]}/${segments[1]}` };
}

export function validateApplicantInput(data: {
  message?: string;
  githubUrl?: string;
  linkedinUrl?: string;
}) {
  const errors: string[] = [];
  const message = typeof data.message === 'string' ? data.message.trim().slice(0, 300) : '';

  const github = normalizeProfileUrl(data.githubUrl, 'github');
  if (github.error) errors.push(github.error);

  const linkedin = normalizeProfileUrl(data.linkedinUrl, 'linkedin');
  if (linkedin.error) errors.push(linkedin.error);

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      message,
      githubUrl: github.url,
      linkedinUrl: linkedin.url,
    },
  };
}

export function escapeHtml(str: unknown): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
