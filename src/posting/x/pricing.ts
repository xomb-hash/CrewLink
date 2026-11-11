import { xHasUrl } from './text';

// X bills per create request, not per account or per thread. A thread of N posts
// is N requests. A post containing any URL costs more. These are the published
// pay-per-usage rates; the source and verification date travel with every
// estimate so the UI never shows an unsourced number.
export const X_PRICING = Object.freeze({
  currency: 'USD' as const,
  createRequestMicros: 15_000, // $0.015 per POST /2/tweets
  createRequestWithUrlMicros: 200_000, // $0.200 when the post contains a URL
  source: 'https://docs.x.com/x-api/getting-started/pricing',
  verifiedAt: '2026-11-11',
  disclaimer:
    'Estimated from X’s published pay-per-request prices. X bills the Crewlink-owned app, and the actual invoice may differ.',
});

export interface XPostPrice {
  index: number;
  hasUrl: boolean;
  costMicros: number;
}

export interface XCostEstimate {
  currency: 'USD';
  requests: number;
  costMicros: number;
  costUsd: number;
  perPost: XPostPrice[];
  source: string;
  verifiedAt: string;
  disclaimer: string;
}

export function microsToUsd(micros: number): number {
  return Math.max(0, Math.round(micros)) / 1_000_000;
}

export function usdToMicros(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) return 0;
  return Math.round(usd * 1_000_000);
}

export function formatUsd(micros: number): string {
  return `$${microsToUsd(micros).toFixed(3)}`;
}

export function priceForPost(text: string): number {
  return xHasUrl(text)
    ? X_PRICING.createRequestWithUrlMicros
    : X_PRICING.createRequestMicros;
}

export function estimateXThread(parts: string[]): XCostEstimate {
  const perPost = (Array.isArray(parts) ? parts : []).map((text, index) => {
    const hasUrl = xHasUrl(text);
    return {
      index,
      hasUrl,
      costMicros: hasUrl
        ? X_PRICING.createRequestWithUrlMicros
        : X_PRICING.createRequestMicros,
    };
  });
  const costMicros = perPost.reduce((sum, post) => sum + post.costMicros, 0);
  return {
    currency: 'USD',
    requests: perPost.length,
    costMicros,
    costUsd: microsToUsd(costMicros),
    perPost,
    source: X_PRICING.source,
    verifiedAt: X_PRICING.verifiedAt,
    disclaimer: X_PRICING.disclaimer,
  };
}

// Manual publishing never calls the API, so it never costs anything.
export const X_MANUAL_COST = Object.freeze({
  currency: 'USD' as const,
  costMicros: 0,
  costUsd: 0,
  requests: 0,
  message: 'Manual publishing is free. Crewlink does not call X.',
});

export default {
  X_PRICING,
  estimateXThread,
  priceForPost,
  formatUsd,
  microsToUsd,
  usdToMicros,
};
