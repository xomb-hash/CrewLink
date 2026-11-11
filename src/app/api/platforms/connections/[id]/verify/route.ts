import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { rateLimiter } from '@/lib/rateLimit';
import { ConnectionError, verifyConnection } from '@/posting/connections';
import { connectionErrorResponse } from '../../../errors';

// Re-checks a creator-owned account without accepting any token from the browser.
// A revoked credential marks the connection disconnected so it cannot publish.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const rateLimitCheck = rateLimiter.check(request, {
    limit: 20,
    windowMs: 60_000,
    keyPrefix: 'platform-verify',
  });
  if (!rateLimitCheck.success) {
    return rateLimiter.createResponse(rateLimitCheck);
  }

  const { id } = await params;

  try {
    const connection = await verifyConnection(String(user.id), id);
    return NextResponse.json({ connection });
  } catch (err) {
    if (err instanceof ConnectionError) return connectionErrorResponse(err);
    throw err;
  }
}
