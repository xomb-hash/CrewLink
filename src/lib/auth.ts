import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { config } from '../config/index';
import { storage } from './storage';
import type { User } from '../types/index';

export const SESSION_COOKIE = 'crewlink_session';
export const STATE_COOKIE = 'crewlink_oauth_state';
export const REDIRECT_COOKIE = 'crewlink_oauth_redirect';

export function signValue(val: string, secret = config.sessionSecret): string {
  const signature = crypto.createHmac('sha256', secret).update(val).digest('hex');
  return `${val}.${signature}`;
}

export function verifySignedValue(signedVal?: string | null, secret = config.sessionSecret): string | null {
  if (!signedVal || typeof signedVal !== 'string') return null;
  const lastDot = signedVal.lastIndexOf('.');
  if (lastDot === -1) return null;

  const val = signedVal.slice(0, lastDot);
  const sig = signedVal.slice(lastDot + 1);
  const expectedSig = crypto.createHmac('sha256', secret).update(val).digest('hex');

  const bufA = Buffer.from(sig);
  const bufB = Buffer.from(expectedSig);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }
  return val;
}

export async function getCurrentUser(request?: NextRequest | Request): Promise<User | null> {
  try {
    let rawSession: string | undefined;

    if (request) {
      if ('cookies' in request && typeof request.cookies?.get === 'function') {
        rawSession = request.cookies.get(SESSION_COOKIE)?.value;
      }
      if (!rawSession && request.headers) {
        const cookieHeader = request.headers.get('cookie') || '';
        const match = cookieHeader.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]*)`));
        if (match) {
          rawSession = decodeURIComponent(match[1]);
        }
      }
    }

    if (!rawSession) {
      try {
        const cookieStore = await cookies();
        rawSession = cookieStore.get(SESSION_COOKIE)?.value;
      } catch {
        // Ignored when outside Next.js request context
      }
    }

    if (!rawSession) return null;

    const sessionId = verifySignedValue(rawSession);
    if (!sessionId) return null;

    const sessionData = await storage.getSession(sessionId);
    if (!sessionData) return null;

    return sessionData.user;
  } catch {
    return null;
  }
}
