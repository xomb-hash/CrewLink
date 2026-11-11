import twitterText from 'twitter-text';

// X counts characters with its own weighting: Latin text is 1, CJK and emoji are
// 2, and every URL counts as 23 regardless of length. twitter-text ships that
// official configuration, so we never approximate the rule by hand.
export const X_WEIGHTED_LIMIT = 280;
export const X_MAX_THREAD_PARTS = 25;
export const X_URL_WEIGHT = 23;

export interface XTextMetrics {
  weightedLength: number;
  valid: boolean;
  urlCount: number;
  hasUrl: boolean;
}

export function xTextMetrics(text: string): XTextMetrics {
  const value = String(text ?? '');
  const parsed = twitterText.parseTweet(value);
  const urls = twitterText.extractUrls(value);
  return {
    weightedLength: parsed.weightedLength,
    valid: parsed.valid,
    urlCount: urls.length,
    hasUrl: urls.length > 0,
  };
}

export function xWeightedLength(text: string): number {
  return xTextMetrics(text).weightedLength;
}

export function xHasUrl(text: string): boolean {
  return xTextMetrics(text).hasUrl;
}

// The canonical text stored on the draft is the parts joined by a blank line.
// Approval hashes this exact value, so editing any part invalidates approval.
export function threadText(parts: string[]): string {
  return parts.join('\n\n');
}

// Returns human-readable problems, not DraftCheck rows, so callers can attach
// the right severity and message for composer and approval screens.
export function xTextProblem(text: string): string | null {
  const value = String(text ?? '');
  if (!value.trim()) return 'Each post needs text.';
  const metrics = xTextMetrics(value);
  if (metrics.weightedLength > X_WEIGHTED_LIMIT) {
    return `Each post is limited to ${X_WEIGHTED_LIMIT} weighted characters (URLs count as ${X_URL_WEIGHT}).`;
  }
  return null;
}

export function xThreadProblems(parts: string[]): string[] {
  if (!Array.isArray(parts) || parts.length === 0) return ['Add at least one post.'];
  if (parts.length > X_MAX_THREAD_PARTS) {
    return [`A thread can contain at most ${X_MAX_THREAD_PARTS} posts.`];
  }
  const problems: string[] = [];
  parts.forEach((part, index) => {
    const problem = xTextProblem(part);
    if (problem) problems.push(`Post ${index + 1}: ${problem}`);
  });
  return problems;
}

export default { xTextMetrics, xWeightedLength, xHasUrl, threadText, xTextProblem, xThreadProblems };
