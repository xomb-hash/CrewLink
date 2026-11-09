import { NextRequest, NextResponse } from 'next/server';
import { storage } from '@/lib/storage';
import { SESSION_COOKIE, verifySignedValue } from '@/lib/auth';
import { config } from '@/config/index';

export async function GET(request: NextRequest) {
  const rawSession = request.cookies.get(SESSION_COOKIE)?.value;
  if (rawSession) {
    const sessionId = verifySignedValue(rawSession);
    if (sessionId) {
      storage.deleteSession(sessionId);
    }
  }

  const response = NextResponse.redirect(new URL('/', config.appUrl));
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

export async function POST(request: NextRequest) {
  return GET(request);
}
