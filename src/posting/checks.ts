import { byId } from '../platforms/registry';
import { X_WEIGHTED_LIMIT, xTextMetrics } from './x/text';
import { redditComposerChecks } from './reddit/validate';
import type { DraftCheck } from '../types/index';

export interface ProjectCheckContext {
  ownerName?: string;
  repoName?: string;
  repoFullName?: string;
  isPrivate?: boolean;
  joinUrl?: string;
  roles?: string[];
  description?: string;
  approvedDrafts?: Array<{ platformId: string; approvedText: string; approvedAt: string }>;
}

export const graphemes = (text: string): number =>
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length
    : [...text].length;

const isPrivateCodeLink = (project: ProjectCheckContext, text: string): boolean => {
  if (project.isPrivate === false) return false;
  const owner = project.ownerName || (project.repoFullName ? project.repoFullName.split('/')[0] : '');
  const repo = project.repoName || (project.repoFullName ? project.repoFullName.split('/')[1] : '');
  const repoSlug = `${String(owner).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${String(repo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
  return new RegExp(`https?://(?:www\\.)?github\\.com/${repoSlug}(?:[/?#]|$)`, 'i').test(text);
};

const looksSecret = (text: string): boolean =>
  /(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,})/i.test(text);

export interface RedditCheckFields {
  title?: string;
  subreddit?: string;
  submissionType?: 'self' | 'link';
  linkUrl?: string;
}

export function checkDraft(
  project: ProjectCheckContext,
  platformId: string,
  text: string,
  threadParts?: string[],
  reddit?: RedditCheckFields
): DraftCheck[] {
  const value = String(text || '');
  const platform = byId(platformId);
  const limit = platform ? platform.characterLimit : 1000;
  const parts = threadParts && threadParts.length ? threadParts : [value];
  const out: DraftCheck[] = [];

  if (platformId === 'reddit') {
    out.push(
      ...redditComposerChecks({
        title: reddit?.title,
        subreddit: reddit?.subreddit,
        submissionType: reddit?.submissionType,
        text: value,
        linkUrl: reddit?.linkUrl,
      })
    );
  } else if (platformId === 'x') {
    // X counts CJK and emoji as 2 and every URL as 23, so the raw length is not
    // the limit. Each thread post is checked on its own.
    parts.forEach((part, index) => {
      if (xTextMetrics(part).weightedLength > X_WEIGHTED_LIMIT) {
        out.push({
          level: 'error',
          code: index > 0 ? `over_limit_${index + 1}` : 'over_limit',
          message: `Post ${index + 1} is limited to ${X_WEIGHTED_LIMIT} weighted characters on X (URLs count as 23).`,
        });
      }
    });
  } else {
    const length = platform && platform.count === 'graphemes' ? graphemes(value) : value.length;
    // LinkedIn rejects an empty commentary field, so it is blocked before the
    // approval and publish gates rather than only at the API.
    if (platformId === 'linkedin' && !value.trim()) {
      out.push({
        level: 'error',
        code: 'post_required',
        message: 'Write the LinkedIn post before saving or approving it.',
      });
    }
    if (length > limit) {
      out.push({
        level: 'error',
        code: 'over_limit',
        message: `${platform ? platform.name : 'Personal post'} is limited to ${limit} ${
          platform && platform.count === 'graphemes' ? 'grapheme clusters' : 'characters'
        }.`,
      });
    }
  }

  const joinUrl = project.joinUrl || '';
  const linkUrl = String(reddit?.linkUrl || '');
  const linkPostHasJoinUrl =
    platformId === 'reddit' &&
    reddit?.submissionType === 'link' &&
    Boolean(joinUrl) &&
    linkUrl.includes(joinUrl);
  if (!joinUrl || (!linkPostHasJoinUrl && !parts.some((part) => part.includes(joinUrl)))) {
    out.push({ level: 'error', code: 'join_link_missing', message: 'Include the project join link.' });
  }


  if (parts.some((part) => looksSecret(part)) || looksSecret(String(reddit?.title || '')) || looksSecret(linkUrl)) {
    out.push({ level: 'error', code: 'secret', message: 'Remove a token- or secret-looking string.' });
  }

  if (
    parts.some((part) => isPrivateCodeLink(project, part)) ||
    (linkUrl && isPrivateCodeLink(project, linkUrl))
  ) {
    out.push({ level: 'error', code: 'private_repo_link', message: 'Do not link directly to code in a private repository.' });
  }

  const approved = Array.isArray(project.approvedDrafts) ? project.approvedDrafts : [];
  if (
    approved.some(
      (draft) =>
        draft.platformId === platformId &&
        draft.approvedText === value &&
        Date.now() - new Date(draft.approvedAt).getTime() < 86400000
    )
  ) {
    out.push({
      level: 'error',
      code: 'recent_duplicate',
      message: 'This text was already approved for this platform in the last 24 hours.',
    });
  }

  if (!Array.isArray(project.roles) || !project.roles.length) {
    out.push({ level: 'warning', code: 'no_roles', message: 'No roles are listed.' });
  }

  if (!String(project.description || '').trim()) {
    out.push({ level: 'warning', code: 'no_description', message: 'No project description is listed.' });
  }

  return out;
}

export default { checkDraft, graphemes };
