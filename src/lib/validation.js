export function formatAccountAge(createdAt) {
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

export function validateProjectInput(data) {
  const errors = [];

  if (!data.repoFullName || typeof data.repoFullName !== 'string') {
    errors.push('Repository full name is required (e.g. owner/repo).');
  } else if (!/^[\w.-]+\/[\w.-]+$/.test(data.repoFullName.trim())) {
    errors.push('Invalid repository format. Expected "owner/repo".');
  }

  const joinMode = data.joinMode === 'screening' ? 'screening' : 'referral';

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

  const title = (data.title && typeof data.title === 'string') 
    ? data.title.trim().slice(0, 100) 
    : (data.repoFullName ? data.repoFullName.split('/')[1] : '');

  const description = (data.description && typeof data.description === 'string')
    ? data.description.trim().slice(0, 500)
    : '';

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      repoFullName: data.repoFullName ? data.repoFullName.trim() : '',
      joinMode,
      screeningUrl,
      title,
      description,
      isPrivate: Boolean(data.isPrivate)
    }
  };
}

export function validateApplicantInput(data) {
  const errors = [];
  const message = typeof data.message === 'string' ? data.message.trim().slice(0, 300) : '';

  return {
    isValid: errors.length === 0,
    errors,
    data: {
      message
    }
  };
}

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
