import { AdapterError } from './types';
import {
  pinnedHttpsRequest,
  resolvePublicAddresses,
  type LookupFn,
} from './ssrf';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AdapterRequestBody {
  json?: unknown;
  form?: Record<string, string>;
}

export interface AdapterRequestGuard {
  // User-supplied instance URLs must be resolved and validated before any
  // outbound request, and an injected test transport is guarded the same way.
  lookup?: LookupFn;
}

export interface AdapterRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: AdapterRequestBody;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  // A failed send may have reached the platform. Adapters pass `uncertain` so the
  // publication row is never retried automatically.
  networkErrorCode?: 'transport_error' | 'uncertain';
  // Enables DNS validation, address pinning and redirect refusal.
  guard?: AdapterRequestGuard;
}

export interface AdapterResponse {
  status: number;
  ok: boolean;
  data: unknown;
  headers: Headers;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function request(
  url: string,
  options: AdapterRequestOptions = {}
): Promise<AdapterResponse> {
  const fetchImpl = options.fetchImpl || (globalThis.fetch as FetchLike | undefined);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  let body: string | undefined;
  if (options.body?.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body.json);
  } else if (options.body?.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(options.body.form).toString();
  }

  // User-controlled instance hosts use the pinned HTTPS transport: DNS is
  // resolved and validated first, then the socket connects only to that address.
  // Redirects are never followed, so a 3xx cannot escape the guard.
  if (options.guard && !options.fetchImpl) {
    let pinned;
    try {
      pinned = await pinnedHttpsRequest(url, {
        method: options.method || 'GET',
        headers,
        body,
        timeoutMs,
        lookup: options.guard.lookup,
      });
    } catch (err) {
      if (err instanceof AdapterError) {
        throw new AdapterError(
          err.message,
          err.code === 'transport_error'
            ? options.networkErrorCode || 'transport_error'
            : err.code,
          err.retryAfterSeconds,
          err.tokens
        );
      }
      throw new AdapterError(
        'The platform could not be reached.',
        options.networkErrorCode || 'transport_error'
      );
    }
    if (pinned.status >= 300 && pinned.status < 400) {
      throw new AdapterError(
        'The instance redirected the request. Crewlink does not follow redirects.',
        'instance_error'
      );
    }
    return {
      status: pinned.status,
      ok: pinned.ok,
      data: parseJson(pinned.text),
      headers: pinned.headers,
    };
  }

  if (!fetchImpl) {
    throw new AdapterError('The HTTP transport is unavailable.', 'transport_error');
  }

  // Even when a transport is injected (tests), resolve and validate the host
  // before calling it so the guard cannot be bypassed by the transport choice.
  if (options.guard) {
    await resolvePublicAddresses(
      new URL(url).hostname,
      options.guard.lookup
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: options.method || 'GET',
      headers,
      body,
      redirect: options.guard ? 'manual' : 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AdapterError(
      'The platform could not be reached.',
      options.networkErrorCode || 'transport_error'
    );
  }

  if (options.guard && response.status >= 300 && response.status < 400) {
    throw new AdapterError(
      'The instance redirected the request. Crewlink does not follow redirects.',
      'instance_error'
    );
  }

  const text = await response.text().catch(() => '');
  return { status: response.status, ok: response.ok, data: parseJson(text), headers: response.headers };
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Mastodon sends `retry-after` seconds; Bluesky sends an epoch in `ratelimit-reset`.
// Reddit's `x-ratelimit-reset` is the number of seconds until the window resets.
export function retryAfterSeconds(headers: Headers, now = Date.now()): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1, Math.ceil(seconds));
    const date = new Date(retryAfter);
    if (!Number.isNaN(date.getTime())) {
      return Math.max(1, Math.ceil((date.getTime() - now) / 1000));
    }
  }

  const resetHeader = headers.get('ratelimit-reset');
  const redditReset = headers.get('x-ratelimit-reset');
  const reset = resetHeader || redditReset;
  if (reset) {
    const value = Number(reset);
    if (Number.isFinite(value)) {
      const seconds = resetHeader
        ? value > 1e12
          ? (value - now) / 1000
          : value - now / 1000
        : value > 1e9
          ? (value - now) / 1000
          : value;
      if (seconds > 0) return Math.max(1, Math.ceil(seconds));
    }
  }

  return undefined;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
