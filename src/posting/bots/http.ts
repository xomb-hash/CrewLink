import { BotError } from './types';

// Minimal fetch wrapper. The URL is never included in an error because the
// Telegram Bot API carries its token inside the URL path.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface JsonRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface JsonResponse {
  status: number;
  ok: boolean;
  data: unknown;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function requestJson(url: string, options: JsonRequest = {}): Promise<JsonResponse> {
  const fetchImpl = options.fetchImpl || (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new BotError('The HTTP transport is unavailable.', 'transport_error');
  }

  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: options.method || 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new BotError('The platform could not be reached.', 'transport_error');
  }

  const text = await response.text().catch(() => '');
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  return { status: response.status, ok: response.ok, data };
}
