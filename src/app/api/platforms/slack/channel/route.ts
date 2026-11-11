import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { rateLimiter } from '@/lib/rateLimit';
import { AdapterError } from '@/posting/adapters/types';
import { ConnectionError, selectSlackChannel } from '@/posting/connections';
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

// Selects the channel the Crewlink bot may post to. The channel is re-read from
// Slack, so archived channels and channels the bot is not in are rejected.
export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const rateLimitCheck = rateLimiter.check(request, {
    limit: 30,
    windowMs: 60_000,
    keyPrefix: 'slack-channel-select',
  });
  if (!rateLimitCheck.success) return rateLimiter.createResponse(rateLimitCheck);

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const connectionId =
    typeof body.connectionId === 'string' ? body.connectionId.trim() : '';
  const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
  if (!connectionId || !channelId) {
    return NextResponse.json(
      { error: 'connectionId and channelId are required.' },
      { status: 400 }
    );
  }

  try {
    const connection = await selectSlackChannel({
      userId: String(user.id),
      connectionId,
      channelId,
    });
    return NextResponse.json({ connection });
  } catch (err) {
    if (err instanceof ConnectionError) return connectionErrorResponse(err);
    if (err instanceof AdapterError) return adapterErrorResponse(err);
    throw err;
  }
}
