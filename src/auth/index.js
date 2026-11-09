import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { storage } from '../lib/storage.js';
import { getGitHubClient } from '../github/index.js';
import {
  parseCookies,
  setCookie,
  clearCookie,
  signValue,
  verifySignedValue,
  redirect,
  sendError,
  sendJson
} from '../lib/request.js';

const SESSION_COOKIE = 'crewlink_session';
const STATE_COOKIE = 'crewlink_oauth_state';
const REDIRECT_COOKIE = 'crewlink_oauth_redirect';

export function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const rawSession = cookies[SESSION_COOKIE];
  if (!rawSession) return null;

  const sessionId = verifySignedValue(rawSession);
  if (!sessionId) return null;

  const sessionData = storage.getSession(sessionId);
  if (!sessionData) return null;

  return sessionData.user;
}

export async function handleLogin(req, res) {
  const parsedUrl = new URL(req.url, config.appUrl);
  const redirectTo = parsedUrl.searchParams.get('redirect_to') || '/dashboard';

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${config.appUrl}/auth/github/callback`;

  // Store state and target redirect in cookies
  setCookie(res, STATE_COOKIE, signValue(state), { maxAge: 600 });
  setCookie(res, REDIRECT_COOKIE, encodeURIComponent(redirectTo), { maxAge: 600 });

  const client = getGitHubClient();
  const oauthUrl = client.getOAuthUrl({ redirectUri, state });

  redirect(res, oauthUrl);
}

export async function handleCallback(req, res) {
  const parsedUrl = new URL(req.url, config.appUrl);
  const code = parsedUrl.searchParams.get('code');
  const state = parsedUrl.searchParams.get('state');

  const cookies = parseCookies(req);
  const signedState = cookies[STATE_COOKIE];
  const expectedState = verifySignedValue(signedState);

  // Validate state
  if (!expectedState || expectedState !== state) {
    return sendError(res, 400, 'Invalid or expired OAuth state parameter.');
  }

  // Clear state cookie
  clearCookie(res, STATE_COOKIE);

  const redirectTarget = cookies[REDIRECT_COOKIE] 
    ? decodeURIComponent(cookies[REDIRECT_COOKIE]) 
    : '/dashboard';
  clearCookie(res, REDIRECT_COOKIE);

  try {
    const client = getGitHubClient();
    const redirectUri = `${config.appUrl}/auth/github/callback`;
    const accessToken = await client.exchangeCodeForToken({ code, redirectUri });
    const ghUser = await client.getAuthenticatedUser(accessToken);

    // Save or update user in storage with their access token
    const savedUser = storage.saveUser({
      id: ghUser.id,
      login: ghUser.login,
      name: ghUser.name,
      avatarUrl: ghUser.avatarUrl,
      createdAt: ghUser.createdAt,
      publicRepos: ghUser.publicRepos,
      accessToken
    });

    // Create session
    const sessionId = storage.createSession(savedUser.id);
    const signedSession = signValue(sessionId);

    // Set session cookie
    setCookie(res, SESSION_COOKIE, signedSession, {
      maxAge: 7 * 24 * 60 * 60, // 7 days
      httpOnly: true,
      sameSite: 'Lax'
    });

    redirect(res, redirectTarget);
  } catch (err) {
    console.error('Auth callback failed:', err.message);
    sendError(res, 500, `Authentication failed: ${err.message}`);
  }
}

export function handleLogout(req, res) {
  const cookies = parseCookies(req);
  const rawSession = cookies[SESSION_COOKIE];
  if (rawSession) {
    const sessionId = verifySignedValue(rawSession);
    if (sessionId) {
      storage.deleteSession(sessionId);
    }
  }

  clearCookie(res, SESSION_COOKIE);
  redirect(res, '/');
}

export function handleCurrentUserApi(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    return sendJson(res, 200, { user: null });
  }

  // Expose safe user profile (omit accessToken)
  return sendJson(res, 200, {
    user: {
      id: user.id,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      publicRepos: user.publicRepos
    }
  });
}
