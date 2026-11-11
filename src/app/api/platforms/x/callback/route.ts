import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/index';
import { getCurrentSessionAuth } from '@/lib/auth';
import {
  cancelXAuthorization,
  completeXAuthorization,
  ConnectionError,
} from '@/posting/connections';

function redirectToPublishing(params: Record<string, string>): NextResponse {
  const url = new URL('/publishing', config.appUrl || 'http://localhost:3100');
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

// X OAuth callback. Success, denial and failure all consume the state. The code
// is exchanged server-side with the stored PKCE verifier; the redirect target
// always comes from configured APP_URL, never request headers.
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state') || '';
  const error = request.nextUrl.searchParams.get('error');
  const code = request.nextUrl.searchParams.get('code') || '';

  const auth = await getCurrentSessionAuth(request);

  if (error) {
    await cancelXAuthorization(state, { userId: auth ? String(auth.user.id) : undefined });
    return redirectToPublishing({ x: 'denied' });
  }

  if (!auth) {
    await cancelXAuthorization(state);
    return redirectToPublishing({ x: 'error', reason: 'session' });
  }

  try {
    const connection = await completeXAuthorization({
      userId: String(auth.user.id),
      state,
      code,
      sessionId: auth.sessionId,
    });
    return redirectToPublishing({
      x: 'connected',
      account: connection.externalAccountName || '',
    });
  } catch (err) {
    if (err instanceof ConnectionError) {
      return redirectToPublishing({ x: 'error', reason: err.code });
    }
    throw err;
  }
}
