import { NextResponse } from 'next/server';
import { AiUnauthorizedError } from '@/ai/access';
import {
  AiConflictError,
  AiForbiddenError,
  AiNotFoundError,
  AiUnavailableError,
  AiValidationError,
} from '@/ai/errors';
import { LlmError } from '@/ai/llm';
import { AnalyticsError } from '@/analytics/sync';
import { AnalyticsRangeError } from '@/analytics/range';

// Analytics errors are sanitized: they never contain a token, ciphertext, URL,
// prompt or platform response body.
export function analyticsErrorResponse(error: unknown): NextResponse {
  if (error instanceof AnalyticsRangeError || error instanceof AiValidationError) {
    return NextResponse.json({ error: error.message, code: 'invalid_range' }, { status: 400 });
  }
  if (error instanceof AnalyticsError) {
    const status =
      error.code === 'invalid_input' || error.code === 'unsupported_platform'
        ? 400
        : error.code === 'not_found'
          ? 404
          : error.code === 'rate_limited'
            ? 429
            : error.code === 'platform_error' || error.code === 'transport_error'
              ? 502
              : 409;
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      },
      { status }
    );
  }
  if (error instanceof LlmError) {
    const status =
      error.code === 'not_configured'
        ? 503
        : error.code === 'rate_limited' || error.code === 'token_limit' || error.code === 'limit_reached'
          ? 429
          : error.code === 'timeout'
            ? 504
            : error.code === 'aborted'
              ? 408
              : 502;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  if (error instanceof AiUnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof AiForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof AiNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof AiConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof AiUnavailableError) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  return NextResponse.json(
    { error: 'The analytics request could not be completed.' },
    { status: 500 }
  );
}
