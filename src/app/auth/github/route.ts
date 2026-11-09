import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { config } from '@/config/index';
import { getGitHubClient } from '@/github/index';
import { STATE_COOKIE, REDIRECT_COOKIE, signValue } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const redirectTo = searchParams.get('redirect_to') || '/dashboard';

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${config.appUrl}/auth/github/callback`;

  const client = getGitHubClient();
  const oauthUrl = client.getOAuthUrl({ redirectUri, state });

  const response = NextResponse.redirect(oauthUrl);

  // Set cookies
  response.cookies.set(STATE_COOKIE, signValue(state), {
    path: '/',
    maxAge: 600,
    httpOnly: true,
    sameSite: 'lax',
  });

  response.cookies.set(REDIRECT_COOKIE, encodeURIComponent(redirectTo), {
    path: '/',
    maxAge: 600,
    httpOnly: true,
    sameSite: 'lax',
  });

  return response;
}
