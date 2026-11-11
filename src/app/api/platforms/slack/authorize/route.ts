import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSessionAuth } from '@/lib/auth';
import { rateLimiter } from '@/lib/rateLimit';
import { beginSlackAuthorization, ConnectionError } from '@/posting/connections';
import { connectionErrorResponse } from '../../errors';

// Starts the Slack OAuth v2 installation. The browser only receives the
// authorization URL; the state hash and client secret stay server-side.
export async function POST(request: NextRequest) {
  const auth = await getCurrentSessionAuth(request);
  const user = auth?.user;
  if (!user || !auth) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const rateLimitCheck = rateLimiter.check(request, {
    limit: 20,
    windowMs: 60_000,
    keyPrefix: 'slack-authorize',
  });
  if (!rateLimitCheck.success) {
    return rateLimiter.createResponse(rateLimitCheck);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required.' }, { status: 400 });
  }

  try {
    const result = await beginSlackAuthorization({
      userId: String(user.id),
      projectId,
      sessionId: auth.sessionId,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ConnectionError) return connectionErrorResponse(err);
    throw err;
  }
}
