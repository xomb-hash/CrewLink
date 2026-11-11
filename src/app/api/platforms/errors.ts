import { NextResponse } from 'next/server';
import { ConnectionError } from '@/posting/connections';

// Shared HTTP mapping for connection errors. Credential material is never part
// of an error message, so the body is safe to return.
export function connectionErrorResponse(error: ConnectionError): NextResponse {
  const status =
    error.code === 'forbidden'
      ? 403
      : error.code === 'project_not_found' || error.code === 'connection_not_found'
        ? 404
        : error.code === 'connection_inactive' || error.code === 'oauth_state_invalid'
          ? 409
          : error.code === 'platform_rate_limited'
            ? 429
            : error.code === 'platform_unreachable'
              ? 502
              : 400;

  const body: Record<string, unknown> = { error: error.message, code: error.code };
  if (error.retryAfterSeconds !== undefined) {
    body.retryAfterSeconds = error.retryAfterSeconds;
  }
  return NextResponse.json(body, { status });
}
