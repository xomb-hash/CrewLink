import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/index';
import { getCurrentSessionAuth } from '@/lib/auth';
import {
  cancelMastodonAuthorization,
  completeMastodonAuthorization,
  ConnectionError,
} from '@/posting/connections';

function redirectToPublishing(params: Record<string, string>): NextResponse {
  const url = new URL('/publishing', config.appUrl || 'http://localhost:3100');
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

// OAuth callback. The state is single-use: success, denial or failure always
// clears the pending handshake. The code is exchanged server-side only.
export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state') || '';
  const error = request.nextUrl.searchParams.get('error');
  const code = request.nextUrl.searchParams.get('code') || '';

  const auth = await getCurrentSessionAuth(request);

  if (error) {
    await cancelMastodonAuthorization(state, { userId: auth ? String(auth.user.id) : undefined });
    return redirectToPublishing({ mastodon: 'denied' });
  }

  if (!auth) {
    await cancelMastodonAuthorization(state);
    return redirectToPublishing({ mastodon: 'error', reason: 'session' });
  }

  try {
    const connection = await completeMastodonAuthorization({
      userId: String(auth.user.id),
      state,
      code,
      sessionId: auth.sessionId,
    });
    return redirectToPublishing({
      mastodon: 'connected',
      account: connection.externalAccountName || '',
    });
  } catch (err) {
    if (err instanceof ConnectionError) {
      return redirectToPublishing({ mastodon: 'error', reason: err.code });
    }
    throw err;
  }
}
