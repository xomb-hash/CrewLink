import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/index';
import { getCurrentSessionAuth } from '@/lib/auth';
import {
  cancelLinkedInAuthorization,
  completeLinkedInAuthorization,
  ConnectionError,
} from '@/posting/connections';

function redirectToPublishing(params: Record<string, string>): NextResponse {
  const url = new URL('/publishing', config.appUrl || 'http://localhost:3000');
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

// LinkedIn OAuth callback. Success, denial and failure all consume the state.
// The code is exchanged server-side with the configured client secret; the
// redirect target always comes from APP_URL, never request headers.
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state') || '';
  const error = request.nextUrl.searchParams.get('error');
  const code = request.nextUrl.searchParams.get('code') || '';

  const auth = await getCurrentSessionAuth(request);

  if (error) {
    await cancelLinkedInAuthorization(state, {
      userId: auth ? String(auth.user.id) : undefined,
    });
    return redirectToPublishing({ linkedin: 'denied' });
  }

  if (!auth) {
    await cancelLinkedInAuthorization(state);
    return redirectToPublishing({ linkedin: 'error', reason: 'session' });
  }

  try {
    const connection = await completeLinkedInAuthorization({
      userId: String(auth.user.id),
      state,
      code,
      sessionId: auth.sessionId,
    });
    return redirectToPublishing({
      linkedin: 'connected',
      account: connection.externalAccountName || '',
    });
  } catch (err) {
    if (err instanceof ConnectionError) {
      return redirectToPublishing({ linkedin: 'error', reason: err.code });
    }
    throw err;
  }
}
