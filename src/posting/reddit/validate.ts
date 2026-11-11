import crypto from 'node:crypto';
import { byId } from '../../platforms/registry';
import { REDDIT_SUBREDDIT_PATTERN } from '../adapters/reddit';
import type { RedditPostRequirements, RedditRule, RedditSubreddit } from '../adapters/types';
import type { Draft, DraftCheck } from '../../types/index';

export const REDDIT_TITLE_LIMIT = 300;
export const REDDIT_BODY_LIMIT = 40_000;
export const REDDIT_LINK_LIMIT = 2_000;

export interface RedditDraftInput {
  title?: string;
  subreddit?: string;
  submissionType?: 'self' | 'link';
  text?: string;
  linkUrl?: string;
}

export interface RedditValidation {
  checks: DraftCheck[];
  // Restrictions Crewlink cannot verify. They are shown to the owner and never
  // presented as guarantees.
  unverifiable: string[];
}

const error = (code: string, message: string): DraftCheck => ({
  level: 'error',
  code,
  message,
});

const warning = (code: string, message: string): DraftCheck => ({
  level: 'warning',
  code,
  message,
});

export function normalizeSubreddit(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^\/?r\//i, '')
    .replace(/\/+$/, '');
}

export function validSubreddit(value: unknown): boolean {
  return REDDIT_SUBREDDIT_PATTERN.test(normalizeSubreddit(value));
}

export function validLinkUrl(value: unknown): boolean {
  const text = String(value || '').trim();
  if (!text || text.length > REDDIT_LINK_LIMIT) return false;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function domainOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function domainMatches(host: string, entry: string): boolean {
  const value = entry.trim().toLowerCase().replace(/^\*\./, '').replace(/^\./, '');
  return Boolean(value) && (host === value || host.endsWith(`.${value}`));
}

// The canonical value an approval covers. Any change to a submission field
// invalidates the approval because the hash no longer matches.
export function redditApprovalPayload(draft: RedditDraftInput): string {
  return JSON.stringify({
    subreddit: normalizeSubreddit(draft.subreddit).toLowerCase(),
    kind: draft.submissionType === 'link' ? 'link' : 'self',
    title: String(draft.title || '').trim(),
    body: String(draft.text || ''),
    url: draft.submissionType === 'link' ? String(draft.linkUrl || '').trim() : '',
  });
}

export function redditApprovalHash(draft: RedditDraftInput): string {
  return crypto.createHash('sha256').update(redditApprovalPayload(draft)).digest('hex');
}

// Checks that do not need a network call. These run when the draft is saved and
// approved; the live API rules are checked again immediately before publishing.
export function redditComposerChecks(draft: RedditDraftInput): DraftCheck[] {
  const platform = byId('reddit');
  const titleLimit = platform?.titleLimit || REDDIT_TITLE_LIMIT;
  const title = String(draft.title || '').trim();
  const body = String(draft.text || '');
  const kind = draft.submissionType;
  const checks: DraftCheck[] = [];

  if (!title) {
    checks.push(error('title_required', 'Reddit submissions need a title.'));
  } else if (title.length > titleLimit) {
    checks.push(
      error('title_limit', `The title is limited to ${titleLimit} characters on Reddit.`)
    );
  }

  if (kind !== 'self' && kind !== 'link') {
    checks.push(error('submission_type', 'Choose a text or link submission.'));
  }

  if (!validSubreddit(draft.subreddit)) {
    checks.push(
      error(
        'subreddit_required',
        'Choose a subreddit using a valid name (2-21 letters, numbers or underscores).'
      )
    );
  }

  if (kind === 'self' && !body.trim()) {
    checks.push(error('body_required', 'A text submission needs a body.'));
  }

  if (body.length > REDDIT_BODY_LIMIT) {
    checks.push(
      error('body_limit', `The body is limited to ${REDDIT_BODY_LIMIT.toLocaleString()} characters.`)
    );
  }

  if (kind === 'link' && !validLinkUrl(draft.linkUrl)) {
    checks.push(error('link_url', 'Enter a valid http or https link.'));
  }

  if (kind === 'link' && validLinkUrl(draft.linkUrl)) {
    const host = domainOf(String(draft.linkUrl));
    if (!host || host === 'localhost' || host.endsWith('.local')) {
      checks.push(error('link_host', 'Use a public link, not a local address.'));
    }
  }

  return checks;
}

function stringIncludesAny(value: string, values: string[]): string | null {
  const lower = value.toLowerCase();
  const found = values.find((entry) => entry && lower.includes(entry.toLowerCase()));
  return found || null;
}

function missingRequiredStrings(value: string, values: string[]): string | null {
  const lower = value.toLowerCase();
  const missing = values.find((entry) => entry && !lower.includes(entry.toLowerCase()));
  return missing || null;
}

// Live checks use the subreddit's own reported rules. Requirements fields that
// the API does not return are skipped rather than guessed.
export function redditLiveChecks(input: {
  draft: RedditDraftInput;
  subreddit: RedditSubreddit;
  requirements?: RedditPostRequirements;
  rules?: RedditRule[];
}): RedditValidation {
  const { draft, subreddit, requirements = {}, rules = [] } = input;
  const checks: DraftCheck[] = [...redditComposerChecks(draft)];
  const unverifiable: string[] = [];
  const title = String(draft.title || '').trim();
  const body = String(draft.text || '');
  const kind = draft.submissionType === 'link' ? 'link' : 'self';
  const subredditName = subreddit.name || normalizeSubreddit(draft.subreddit);

  if (subreddit.subredditType === 'private') {
    checks.push(error('subreddit_private', `${subredditName} is private; only members can submit.`));
  } else if (subreddit.subredditType === 'archived') {
    checks.push(error('subreddit_archived', `${subredditName} is archived and cannot receive new posts.`));
  } else if (subreddit.subredditType === 'restricted') {
    unverifiable.push(
      `${subredditName} is restricted. Crewlink cannot confirm whether this account is an approved submitter; Reddit makes the final decision.`
    );
  }

  if (subreddit.userIsBanned) {
    checks.push(error('account_banned', `This Reddit account is banned from ${subredditName}.`));
  }
  if (subreddit.userIsMuted) {
    checks.push(error('account_muted', `This Reddit account is muted in ${subredditName}.`));
  }

  const allowed = subreddit.submissionType;
  if (allowed && allowed !== 'any' && allowed !== kind) {
    checks.push(
      error(
        'submission_type_not_allowed',
        `${subredditName} only accepts ${allowed === 'self' ? 'text' : 'link'} submissions.`
      )
    );
  }

  if (requirements.titleMinLength && title.length < requirements.titleMinLength) {
    checks.push(
      error(
        'title_min',
        `This subreddit requires a title of at least ${requirements.titleMinLength} characters.`
      )
    );
  }
  if (requirements.titleMaxLength && title.length > requirements.titleMaxLength) {
    checks.push(
      error(
        'title_max',
        `This subreddit limits titles to ${requirements.titleMaxLength} characters.`
      )
    );
  }

  if (requirements.bodyRequired === true && !body.trim()) {
    checks.push(error('body_required', 'This subreddit requires body text.'));
  }
  if (requirements.bodyMinLength && body.length < requirements.bodyMinLength) {
    checks.push(
      error(
        'body_min',
        `This subreddit requires at least ${requirements.bodyMinLength} characters of body text.`
      )
    );
  }
  if (requirements.bodyMaxLength && body.length > requirements.bodyMaxLength) {
    checks.push(
      error(
        'body_max',
        `This subreddit limits body text to ${requirements.bodyMaxLength} characters.`
      )
    );
  }

  if (requirements.linkRequired === true && !validLinkUrl(draft.linkUrl)) {
    checks.push(error('link_url', 'This subreddit requires a valid link.'));
  }

  if (kind === 'link' && validLinkUrl(draft.linkUrl)) {
    const host = domainOf(String(draft.linkUrl));
    const blacklisted = (requirements.domainBlacklist || []).find((entry) =>
      domainMatches(host, entry)
    );
    if (blacklisted) {
      checks.push(
        error('domain_not_allowed', `${host} is not allowed in ${subredditName}.`)
      );
    }
    const whitelist = requirements.domainWhitelist || [];
    if (
      whitelist.length &&
      requirements.linkRestrictionPolicy === 'whitelist' &&
      !whitelist.some((entry) => domainMatches(host, entry))
    ) {
      checks.push(
        error('domain_not_allowed', `${host} is not on ${subredditName}'s allowed domains.`)
      );
    }
  }

  const badTitle = stringIncludesAny(title, requirements.titleBlacklistedStrings || []);
  if (badTitle) {
    checks.push(
      error('title_filtered', `The title contains a word this subreddit does not allow: "${badTitle}".`)
    );
  }
  const missingTitle = missingRequiredStrings(title, requirements.titleRequiredStrings || []);
  if (missingTitle) {
    checks.push(
      error('title_required_text', `The title must include "${missingTitle}".`)
    );
  }
  const badBody = stringIncludesAny(body, requirements.bodyBlacklistedStrings || []);
  if (badBody) {
    checks.push(
      error('body_filtered', `The body contains a word this subreddit does not allow: "${badBody}".`)
    );
  }
  const missingBody = missingRequiredStrings(body, requirements.bodyRequiredStrings || []);
  if (missingBody) {
    checks.push(error('body_required_text', `The body must include "${missingBody}".`));
  }

  // Flair selection is outside this milestone. Blocking is safer than submitting
  // without flair and hoping the moderators accept it.
  if (requirements.flairRequired) {
    checks.push(
      error(
        'flair_required',
        `${subredditName} requires flair, which Crewlink does not support yet. Submit this post on Reddit instead.`
      )
    );
  }
  if (requirements.galleryRequired) {
    checks.push(
      error(
        'gallery_required',
        `${subredditName} requires a gallery post, which Crewlink does not support yet.`
      )
    );
  }

  const ruleNames = rules.map((rule) => rule.name).filter(Boolean).slice(0, 12);
  if (ruleNames.length) {
    unverifiable.push(
      `Community rules may add requirements Crewlink cannot check: ${ruleNames.join('; ')}.`
    );
  }
  unverifiable.push(
    'Moderators may still remove the post. Crewlink never guarantees that a submission stays visible.'
  );

  return { checks, unverifiable };
}

export function draftAsRedditInput(draft: Pick<Draft, 'title' | 'subreddit' | 'submissionType' | 'text' | 'linkUrl'>): RedditDraftInput {
  return {
    title: draft.title,
    subreddit: draft.subreddit,
    submissionType: draft.submissionType,
    text: draft.text,
    linkUrl: draft.linkUrl,
  };
}

export default {
  redditApprovalHash,
  redditApprovalPayload,
  redditComposerChecks,
  redditLiveChecks,
  draftAsRedditInput,
  normalizeSubreddit,
  validSubreddit,
  validLinkUrl,
  REDDIT_TITLE_LIMIT,
  REDDIT_BODY_LIMIT,
};
