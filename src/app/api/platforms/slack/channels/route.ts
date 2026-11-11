import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { rateLimiter } from '@/lib/rateLimit';
import { AdapterError } from '@/posting/adapters/types';
import { ConnectionError, listSlackChannels } from '@/posting/connections';
import { connectionErrorResponse } from '../../errors';

function adapterErrorResponse(err: AdapterError): NextResponse {
  const status =
    err.code === 'rate_limited'
      ? 429
      : err.code === 'token_expired' || err.code === 'revoked' || err.code === 'auth_failed'
        ? 409
        : 502;
  const body: Record<string, unknown> = { error: err.message, code: err.code };
  if (err.retryAfterSeconds !== undefined) body.retryAfterSeconds = err.retryAfterSeconds;
  return NextResponse.json(body, { status });
}

// Lists channels the Crewlink bot can see: public channels plus private channels
// the bot was invited to. The owner's own Slack access is never used.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const rateLimitCheck = rateLimiter.check(request, {
    limit: 30,
    windowMs: 60_000,
    keyPrefix: 'slack-channels',
  });
  if (!rateLimitCheck.success) return rateLimiter.createResponse(rateLimitCheck);

  const connectionId = request.nextUrl.searchParams.get('connectionId') || '';
  if (!connectionId) {
    return NextResponse.json({ error: 'connectionId is required.' }, { status: 400 });
  }

  try {
    const channels = await listSlackChannels(String(user.id), connectionId);
    return NextResponse.json({ channels });
  } catch (err) {
    if (err instanceof ConnectionError) return connectionErrorResponse(err);
    if (err instanceof AdapterError) return adapterErrorResponse(err);
    throw err;
  }
}
