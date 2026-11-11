// Provider-independent language-model contract. Provider modules implement
// `complete`; nothing here reads platform credentials or publishes content.

export type LlmTask = 'research' | 'strategy' | 'generation' | 'quality' | 'analytics';

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmRequest {
  task: LlmTask;
  system: string;
  user: string;
  // Ask the provider for a JSON object. Agents still parse and validate it.
  json?: boolean;
  maxOutputTokens?: number;
  // Deterministic hints for the mock provider only. Real providers ignore it.
  meta?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface LlmResponse {
  text: string;
  provider: string;
  model: string;
  usage: LlmUsage;
  latencyMs: number;
}

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  readonly configured: boolean;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export type LlmErrorCode =
  | 'not_configured'
  | 'timeout'
  | 'rate_limited'
  | 'provider_error'
  | 'malformed_response'
  | 'unsupported_numeric_claim'
  | 'token_limit'
  | 'limit_reached'
  | 'aborted';

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(code: LlmErrorCode, message: string, retryable = false, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export function emptyUsage(): LlmUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

export function normalizeUsage(input: {
  prompt?: unknown;
  completion?: unknown;
  total?: unknown;
}): LlmUsage {
  const number = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
  };
  const promptTokens = number(input.prompt);
  const completionTokens = number(input.completion);
  const totalTokens = number(input.total) || promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

// One shared fetch wrapper so every provider has the same timeout, bounded
// retry policy and sanitized error surface.
export async function requestJson(
  providerId: string,
  url: string,
  init: RequestInit,
  options: { timeoutMs: number; retries: number; signal?: AbortSignal }
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < options.retries) {
          lastError = new LlmError(
            response.status === 429 ? 'rate_limited' : 'provider_error',
            `${providerId} returned HTTP ${response.status}.`,
            true,
            response.status
          );
          await delay(250 * 2 ** attempt);
          continue;
        }
        throw new LlmError(
          response.status === 429 ? 'rate_limited' : 'provider_error',
          `${providerId} returned HTTP ${response.status}.`,
          retryable,
          response.status
        );
      }
      return (await response.json()) as unknown;
    } catch (err) {
      if (err instanceof LlmError) {
        if (err.code === 'provider_error' && err.retryable && attempt < options.retries) {
          lastError = err;
          await delay(250 * 2 ** attempt);
          continue;
        }
        throw err;
      }
      const aborted = options.signal?.aborted === true;
      if (aborted) {
        throw new LlmError('aborted', 'The AI request was cancelled.', false);
      }
      if (controller.signal.aborted) {
        lastError = new LlmError('timeout', `${providerId} did not respond in time.`, true);
      } else {
        lastError = new LlmError('provider_error', `${providerId} could not be reached.`, true);
      }
      if (attempt < options.retries) {
        await delay(250 * 2 ** attempt);
        continue;
      }
      throw lastError;
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
    }
  }
  throw lastError instanceof LlmError
    ? lastError
    : new LlmError('provider_error', `${providerId} failed.`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  });
}

// Extract a short, non-secret provider message for the UI. Full response bodies
// are never stored because they can contain prompt echoes.
export function providerErrorSummary(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const error = record.error;
  if (typeof error === 'string') return error.slice(0, 200);
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') return message.slice(0, 200);
  }
  if (typeof record.message === 'string') return record.message.slice(0, 200);
  return '';
}
