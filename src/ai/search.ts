import { config } from '../config/index';
import { requestJson } from './llm';
import type { Campaign } from './types';

export interface SearchHit {
  title: string;
  url: string;
  publisher?: string;
  publishedAt?: string;
  summary?: string;
  provider?: 'brave' | 'reddit';
}

export interface ResearchGateway {
  readonly id: 'brave' | 'reddit';
  readonly configured: boolean;
  search(query: string, limit: number, signal?: AbortSignal): Promise<SearchHit[]>;
}

function safeUrl(value: unknown): string | null {
  const text = String(value || '').trim();
  if (!text || text.length > 2000) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeDate(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

const clip = (value: unknown, max: number): string =>
  String(value || '').trim().slice(0, max);

// Brave Search API — documented web search endpoint. Only enabled when a key is
// configured; no key means no request, never a different provider.
export class BraveSearchGateway implements ResearchGateway {
  readonly id = 'brave' as const;
  readonly configured: boolean;

  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
    private readonly timeoutMs: number,
    private readonly retries: number
  ) {
    this.configured = Boolean(apiKey);
  }

  async search(query: string, limit: number, signal?: AbortSignal): Promise<SearchHit[]> {
    if (!this.configured) return [];
    const url = `${this.endpoint}?q=${encodeURIComponent(clip(query, 300))}&count=${Math.min(
      10,
      limit
    )}`;
    const body = await requestJson(
      'brave-search',
      url,
      {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': this.apiKey,
        },
      },
      { timeoutMs: this.timeoutMs, retries: this.retries, signal }
    );
    const results = (body as { web?: { results?: unknown } })?.web?.results;
    if (!Array.isArray(results)) return [];
    return results
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item): SearchHit | null => {
        const url = safeUrl(item.url);
        if (!url) return null;
        return {
          title: clip(item.title, 300) || url,
          url,
          publisher: clip(item.profile || item.meta_url, 120) || undefined,
          publishedAt: safeDate(item.page_age),
          summary: clip(item.description, 600) || undefined,
          provider: this.id,
        };
      })
      .filter((item): item is SearchHit => item !== null)
      .slice(0, limit);
  }
}

// Reddit's official app-only OAuth search. This is the public search endpoint,
// not a scraped page, and it never uses a user's session or password.
export class RedditSearchGateway implements ResearchGateway {
  readonly id = 'reddit' as const;
  readonly configured: boolean;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly tokenUrl: string,
    private readonly apiBaseUrl: string,
    private readonly userAgent: string,
    private readonly timeoutMs: number,
    private readonly retries: number
  ) {
    this.configured = Boolean(clientId && clientSecret);
  }

  private async token(signal?: AbortSignal): Promise<string> {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const body = await requestJson(
      'reddit-search',
      this.tokenUrl,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.userAgent,
        },
        body: 'grant_type=client_credentials',
      },
      { timeoutMs: this.timeoutMs, retries: this.retries, signal }
    );
    const token = (body as { access_token?: unknown })?.access_token;
    if (typeof token !== 'string' || !token) {
      throw new Error('Reddit did not return an app-only token.');
    }
    return token;
  }

  async search(query: string, limit: number, signal?: AbortSignal): Promise<SearchHit[]> {
    if (!this.configured) return [];
    const accessToken = await this.token(signal);
    const url = `${this.apiBaseUrl}/search?q=${encodeURIComponent(
      clip(query, 300)
    )}&limit=${Math.min(10, limit)}&sort=relevance&type=link&raw_json=1`;
    const body = await requestJson(
      'reddit-search',
      url,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
      },
      { timeoutMs: this.timeoutMs, retries: this.retries, signal }
    );
    const children = (body as { data?: { children?: unknown } })?.data?.children;
    if (!Array.isArray(children)) return [];
    return children
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item): SearchHit | null => {
        const data =
          item.data && typeof item.data === 'object'
            ? (item.data as Record<string, unknown>)
            : {};
        const permalink = String(data.permalink || '');
        const url = safeUrl(permalink ? `https://www.reddit.com${permalink}` : data.url);
        if (!url) return null;
        return {
          title: clip(data.title, 300) || url,
          url,
          publisher: clip(data.subreddit_name_prefixed || data.subreddit, 120) || undefined,
          publishedAt: safeDate(
            typeof data.created_utc === 'number' ? data.created_utc * 1000 : data.created_utc
          ),
          summary: clip(data.selftext, 600) || undefined,
          provider: this.id,
        };
      })
      .filter((item): item is SearchHit => item !== null)
      .slice(0, limit);
  }
}

// A test/owner-supplied gateway. It performs no network call and is never used
// by production routes unless a caller explicitly supplies it.
export class StaticSearchGateway implements ResearchGateway {
  readonly id: 'brave' | 'reddit';
  readonly configured = true;

  constructor(
    id: 'brave' | 'reddit',
    private readonly hits: SearchHit[]
  ) {
    this.id = id;
  }

  async search(_query: string, limit: number): Promise<SearchHit[]> {
    return this.hits.slice(0, limit);
  }
}

export function createResearchGateways(): ResearchGateway[] {
  const gateways: ResearchGateway[] = [];
  if (config.aiResearchProvider === 'brave' || config.aiResearchProvider === 'both') {
    if (config.braveSearchApiKey) {
      gateways.push(
        new BraveSearchGateway(
          config.braveSearchApiKey,
          config.braveSearchUrl,
          config.aiTimeoutMs,
          config.aiMaxRetries
        )
      );
    }
  }
  if (config.aiResearchProvider === 'reddit' || config.aiResearchProvider === 'both') {
    if (config.redditClientId && config.redditClientSecret) {
      gateways.push(
        new RedditSearchGateway(
          config.redditClientId,
          config.redditClientSecret,
          config.redditTokenUrl,
          config.redditApiBaseUrl,
          config.redditUserAgent,
          config.aiTimeoutMs,
          config.aiMaxRetries
        )
      );
    }
  }
  return gateways;
}

export function researchQuery(campaign: Campaign): string {
  const parts = [campaign.brief, campaign.objective, campaign.audience, campaign.themes.join(' ')]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return clip(parts.join(' ').replace(/\s+/g, ' '), 280);
}

export interface SearchOutcome {
  hits: SearchHit[];
  providers: string[];
  failed: Array<{ provider: string; message: string }>;
}

export async function runSearch(
  gateways: ResearchGateway[],
  query: string,
  limit: number,
  signal?: AbortSignal
): Promise<SearchOutcome> {
  const active = gateways.filter((gateway) => gateway.configured);
  const results = await Promise.allSettled(
    active.map((gateway) => gateway.search(query, limit, signal))
  );
  const hits: SearchHit[] = [];
  const providers: string[] = [];
  const failed: Array<{ provider: string; message: string }> = [];
  results.forEach((result, index) => {
    const gateway = active[index];
    if (result.status === 'fulfilled') {
      providers.push(gateway.id);
      hits.push(...result.value);
    } else {
      failed.push({
        provider: gateway.id,
        message: result.reason instanceof Error ? result.reason.message : 'Search failed.',
      });
    }
  });
  const seen = new Set<string>();
  const deduped = hits.filter((hit) => {
    const key = hit.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { hits: deduped, providers, failed };
}
