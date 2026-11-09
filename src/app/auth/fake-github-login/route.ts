import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const redirectUri = searchParams.get('redirect_uri') || '/dashboard';
  const state = searchParams.get('state') || '';
  const loginAs = searchParams.get('login_as') || 'alice-owner';

  const target = new URL(redirectUri, request.url);
  target.searchParams.set('code', `code-${loginAs}`);
  target.searchParams.set('state', state);

  return NextResponse.redirect(target);
}
