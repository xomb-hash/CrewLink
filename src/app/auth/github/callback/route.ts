import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/index';
import { storage } from '@/lib/storage';
import { getGitHubClient } from '@/github/index';
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  REDIRECT_COOKIE,
  signValue,
  verifySignedValue,
} from '@/lib/auth';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const signedState = request.cookies.get(STATE_COOKIE)?.value;
  const expectedState = verifySignedValue(signedState);

  if (!expectedState || expectedState !== state || !code) {
    return NextResponse.json(
      { error: 'Invalid or expired OAuth state parameter.' },
      { status: 400 }
    );
  }

  const rawRedirect = request.cookies.get(REDIRECT_COOKIE)?.value;
  const redirectTarget = rawRedirect ? decodeURIComponent(rawRedirect) : '/dashboard';

  try {
    const client = getGitHubClient();
    const redirectUri = `${config.appUrl}/auth/github/callback`;
    const accessToken = await client.exchangeCodeForToken({ code, redirectUri });
    const ghUser = await client.getAuthenticatedUser(accessToken);

    const savedUser = storage.saveUser({
      id: ghUser.id,
      login: ghUser.login,
      name: ghUser.name,
      avatarUrl: ghUser.avatarUrl,
      createdAt: ghUser.createdAt,
      publicRepos: ghUser.publicRepos,
      accessToken,
    });

    const sessionId = storage.createSession(savedUser.id);
    const signedSession = signValue(sessionId);

    const response = NextResponse.redirect(new URL(redirectTarget, config.appUrl));

    response.cookies.set(SESSION_COOKIE, signedSession, {
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
      httpOnly: true,
      sameSite: 'lax',
    });

    response.cookies.delete(STATE_COOKIE);
    response.cookies.delete(REDIRECT_COOKIE);

    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Auth callback failed:', msg);
    return NextResponse.json({ error: `Authentication failed: ${msg}` }, { status: 500 });
  }
}
