import { LlmError } from './llm';

// Extract one JSON object from a model response. Fenced code blocks are
// tolerated because providers sometimes add them even when JSON mode is on.
export function parseJsonObject(value: string): Record<string, unknown> {
  const raw = String(value ?? '').trim();
  if (!raw) throw new LlmError('malformed_response', 'The model returned an empty response.');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new LlmError('malformed_response', 'The model did not return a JSON object.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new LlmError('malformed_response', 'The model returned invalid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LlmError('malformed_response', 'The model returned a non-object JSON value.');
  }
  return parsed as Record<string, unknown>;
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function asStringArray(value: unknown, max = 40): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
}

export function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function asObjectArray(value: unknown, max = 80): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .slice(0, max);
}

export function requireObjectArray(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {}
): Record<string, unknown>[] {
  const rows = asObjectArray(value, options.max ?? 80);
  if (rows.length < (options.min ?? 1)) {
    throw new LlmError('malformed_response', `The model response is missing "${field}".`);
  }
  return rows;
}
