import type { AgentRuntime } from './execution';
import { aiId } from './ids';
import { asObjectArray, asString, asStringArray, parseJsonObject } from './json';
import type { LlmRequest } from './llm';
import { researchPrompt } from './prompts';
import {
  researchQuery,
  runSearch,
  type ResearchGateway,
  type SearchHit,
} from './search';
import type {
  BrandProfile,
  Campaign,
  ResearchFinding,
  ResearchResult,
  ResearchSource,
} from './types';

export interface OwnerSourceInput {
  title?: string;
  url: string;
}

export interface ResearchAgentResult {
  result: ResearchResult;
  sources: ResearchSource[];
}

function safeHttpUrl(value: unknown): string | null {
  const text = String(value || '').trim();
  if (!text || text.length > 2000) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function sourceFromOwner(input: OwnerSourceInput, now: string): ResearchSource | null {
  const url = safeHttpUrl(input.url);
  if (!url) return null;
  return {
    id: aiId('src'),
    campaignId: '',
    title: String(input.title || '').trim().slice(0, 300) || hostLabel(url),
    url,
    publisher: hostLabel(url),
    retrievedAt: now,
    provider: 'owner',
    verified: false,
  };
}

function sourceFromHit(hit: SearchHit, now: string): ResearchSource | null {
  const url = safeHttpUrl(hit.url);
  if (!url) return null;
  return {
    id: aiId('src'),
    campaignId: '',
    title: String(hit.title || '').trim().slice(0, 300) || hostLabel(url),
    url,
    publisher: hit.publisher ? String(hit.publisher).slice(0, 200) : undefined,
    publishedAt: hit.publishedAt,
    retrievedAt: now,
    summary: hit.summary ? String(hit.summary).slice(0, 800) : undefined,
    provider: hit.provider || 'brave',
    verified: true,
  };
}

// The research step treats every retrieved page as data. It never fetches a URL
// from the model and never stores a link the search layer did not return.
export async function runResearchAgent(options: {
  campaign: Campaign;
  brand: BrandProfile | null;
  runtime: AgentRuntime;
  gateways: ResearchGateway[];
  ownerSources?: OwnerSourceInput[];
  signal?: AbortSignal;
}): Promise<ResearchAgentResult> {
  const now = new Date().toISOString();
  const sources: ResearchSource[] = [];
  const seen = new Set<string>();

  const add = (source: ResearchSource | null) => {
    if (!source) return;
    const key = source.url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    sources.push(source);
  };

  for (const input of options.ownerSources || []) add(sourceFromOwner(input, now));

  const query = researchQuery(options.campaign);
  const search = query
    ? await runSearch(options.gateways, query, 5, options.signal)
    : { hits: [], providers: [], failed: [] };
  for (const hit of search.hits) add(sourceFromHit(hit, now));

  const searchStatus: ResearchResult['search']['status'] = !options.gateways.length
    ? 'not_configured'
    : search.hits.length > 0
      ? 'ok'
      : search.failed.length > 0
        ? 'failed'
        : 'empty';

  const prompt = researchPrompt(options.campaign, options.brand, sources, searchStatus);
  const request: LlmRequest = {
    task: 'research',
    system: prompt.system,
    user: prompt.user,
    json: true,
    maxOutputTokens: 1600,
    meta: {
      brief: options.campaign.brief,
      objective: options.campaign.objective,
      audience: options.campaign.audience,
      themes: options.campaign.themes,
      sources: sources.map((source) => ({
        title: source.title,
        url: source.url,
        publisher: source.publisher,
      })),
      searchStatus,
    },
  };
  const response = await options.runtime.complete(request);
  const parsed = parseJsonObject(response.text);

  const retrievedUrls = new Set(
    sources.filter((source) => source.verified).map((source) => source.url.toLowerCase())
  );
  const knownUrls = new Set(sources.map((source) => source.url.toLowerCase()));
  const findings: ResearchFinding[] = [];
  const assumptions = asStringArray(parsed.assumptions, 30);

  for (const row of asObjectArray(parsed.findings, 30)) {
    const statement = asString(row.statement);
    if (!statement) continue;
    const cited = asStringArray(row.sourceUrls, 10).filter((url) =>
      knownUrls.has(url.toLowerCase())
    );
    const cleaned = asStringArray(row.sourceUrls, 10).filter(
      (url) => !knownUrls.has(url.toLowerCase())
    );
    if (cleaned.length) {
      assumptions.push(
        `${statement} (A cited link was omitted because it was not returned by a search source.)`
      );
      continue;
    }
    if (!cited.length) {
      assumptions.push(statement);
      continue;
    }
    findings.push({
      statement,
      sourceUrls: cited,
      verified: row.verified === true && cited.every((url) => retrievedUrls.has(url.toLowerCase())),
    });
  }

  const messages: string[] = [];
  if (!options.gateways.length) {
    messages.push('No research search provider is configured.');
  } else if (searchStatus === 'failed') {
    messages.push('The configured search provider could not be reached.');
  } else if (searchStatus === 'empty') {
    messages.push('The search provider returned no results.');
  }
  for (const failure of search.failed) {
    messages.push(`${failure.provider}: ${failure.message}`);
  }
  if (searchStatus === 'not_configured') {
    assumptions.push('No external sources were retrieved; findings are planning notes only.');
  }
  for (const message of messages) {
    if (!assumptions.includes(message)) assumptions.push(message);
  }

  const result: ResearchResult = {
    summary: asString(parsed.summary) || 'No research summary was returned.',
    findings,
    opportunities: asStringArray(parsed.opportunities, 20),
    assumptions: assumptions.slice(0, 30),
    search: {
      status: searchStatus,
      providers: search.providers,
      message: messages[0],
    },
    generatedAt: now,
  };

  return { result, sources };
}

// Search-only fallback used when the research model fails. It keeps the real
// source list and clearly states that no summary was generated.
export function researchFallback(
  sources: ResearchSource[],
  reason: string
): ResearchResult {
  return {
    summary: 'The research model failed, so no summary was generated. Only the retrieved source list is shown.',
    findings: sources
      .filter((source) => source.verified)
      .slice(0, 8)
      .map((source) => ({
        statement: `Retrieved source: ${source.title}`,
        sourceUrls: [source.url],
        verified: true,
      })),
    opportunities: [],
    assumptions: [reason],
    search: {
      status: sources.some((source) => source.verified) ? 'ok' : 'not_configured',
      providers: Array.from(
        new Set(sources.map((source) => source.provider).filter(Boolean))
      ),
      message: reason,
    },
    generatedAt: new Date().toISOString(),
  };
}
