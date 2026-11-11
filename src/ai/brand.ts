import storage from '../lib/storage';
import { AiValidationError } from './errors';
import type { BrandProfile } from './types';

const LIMITS = {
  brandName: 120,
  description: 1200,
  audience: 600,
  tone: 300,
  style: 600,
  listItems: 20,
  listItem: 120,
  examples: 5,
  example: 1500,
};

const clean = (value: unknown, max: number): string =>
  String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, max);

function cleanList(value: unknown, maxItems: number, maxItem: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = clean(item, maxItem);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

export interface BrandInput {
  brandName: string;
  description: string;
  audience: string;
  tone: string;
  vocabulary: string[];
  style: string;
  avoidTopics: string[];
  avoidWords: string[];
  ctas: string[];
  examplePosts: string[];
}

export function normalizeBrandInput(body: unknown): BrandInput {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const input: BrandInput = {
    brandName: clean(raw.brandName, LIMITS.brandName),
    description: clean(raw.description, LIMITS.description),
    audience: clean(raw.audience, LIMITS.audience),
    tone: clean(raw.tone, LIMITS.tone),
    vocabulary: cleanList(raw.vocabulary, LIMITS.listItems, LIMITS.listItem),
    style: clean(raw.style, LIMITS.style),
    avoidTopics: cleanList(raw.avoidTopics, LIMITS.listItems, LIMITS.listItem),
    avoidWords: cleanList(raw.avoidWords, LIMITS.listItems, LIMITS.listItem),
    ctas: cleanList(raw.ctas, LIMITS.listItems, LIMITS.listItem),
    examplePosts: cleanList(raw.examplePosts, LIMITS.examples, LIMITS.example),
  };
  if (!input.brandName && !input.description && !input.tone) {
    throw new AiValidationError('Add at least a brand name, description or tone.');
  }
  return input;
}

export async function getBrandProfile(projectId: string): Promise<BrandProfile | null> {
  return storage.getBrandProfile(projectId);
}

export async function saveBrandProfile(
  projectId: string,
  body: unknown
): Promise<BrandProfile> {
  const input = normalizeBrandInput(body);
  return storage.upsertBrandProfile(projectId, input);
}
