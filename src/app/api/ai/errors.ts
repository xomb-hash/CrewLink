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

// AI errors never include prompts, model responses, tokens or credentials. The
// body carries a sanitized message and a typed code only.
export function aiErrorResponse(error: unknown): NextResponse {
  if (error instanceof LlmError) {
    const status =
      error.code === 'not_configured'
        ? 503
        : error.code === 'rate_limited' ||
            error.code === 'token_limit' ||
            error.code === 'limit_reached'
          ? 429
          : error.code === 'timeout'
            ? 504
            : error.code === 'aborted'
              ? 408
              : 502;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status }
    );
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
  if (error instanceof AiValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(
    { error: 'The AI workspace could not complete that request.' },
    { status: 500 }
  );
}
