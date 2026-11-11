import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/index';
import { getCurrentSessionAuth } from '@/lib/auth';
import {
  cancelSlackAuthorization,
  completeSlackAuthorization,
  ConnectionError,
} from '@/posting/connections';

function redirectToPublishing(params: Record<string, string>): NextResponse {
  const url = new URL('/publishing', config.appUrl || 'http://localhost:3000');
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

// Slack OAuth callback. Success, denial and failure all consume the state. The
// code is exchanged server-side and the redirect target always comes from
// APP_URL, never request headers.
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state') || '';
  const error = request.nextUrl.searchParams.get('error');
  const code = request.nextUrl.searchParams.get('code') || '';

  const auth = await getCurrentSessionAuth(request);

  if (error) {
    await cancelSlackAuthorization(state, {
      userId: auth ? String(auth.user.id) : undefined,
    });
    return redirectToPublishing({ slack: 'denied' });
  }

  if (!auth) {
    await cancelSlackAuthorization(state);
    return redirectToPublishing({ slack: 'error', reason: 'session' });
  }

  try {
    const connection = await completeSlackAuthorization({
      userId: String(auth.user.id),
      state,
      code,
      sessionId: auth.sessionId,
    });
    return redirectToPublishing({
      slack: 'connected',
      workspace: connection.serverName || '',
    });
  } catch (err) {
    if (err instanceof ConnectionError) {
      return redirectToPublishing({ slack: 'error', reason: err.code });
    }
    throw err;
  }
}
