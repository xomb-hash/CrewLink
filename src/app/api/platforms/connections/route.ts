import { NextRequest, NextResponse } from 'next/server';
import { getCurrentSessionAuth, getCurrentUser } from '@/lib/auth';
import { rateLimiter } from '@/lib/rateLimit';
import { byId } from '@/platforms/registry';
import {
  beginMastodonAuthorization,
  beginXAuthorization,
  connectBlueskyAccount,
  connectBotChannel,
  ConnectionError,
  listConnections,
  saveConnection,
} from '@/posting/connections';
import { connectionErrorResponse } from '../errors';

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// Owner-scoped list of connection summaries. Tokens are never included.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get('projectId') || undefined;

  try {
    const connections = await listConnections(String(user.id), projectId);
    return NextResponse.json({ connections });
  } catch (err) {
    if (err instanceof ConnectionError) return connectionErrorResponse(err);
    throw err;
  }
}

// Store a creator-owned token (or shared-bot channel selection) for one project.
// The token is encrypted before it reaches storage and is never echoed back.
// OAuth and bot-install flows must exchange their codes on the server and call
// the connection module there; tokens must never be read back into browser JS.
export async function POST(request: NextRequest) {
  const auth = await getCurrentSessionAuth(request);
  const user = auth?.user;
  if (!user || !auth) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const rateLimitCheck = rateLimiter.check(request, {
    limit: 20,
    windowMs: 60_000,
    keyPrefix: 'platform-connections',
  });
  if (!rateLimitCheck.success) {
    return rateLimiter.createResponse(rateLimitCheck);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const projectId = optionalString(body.projectId);
  const platformId = optionalString(body.platformId);
  if (!projectId || !platformId) {
    return NextResponse.json(
      { error: 'projectId and platformId are required.' },
      { status: 400 }
    );
  }

  // Bot platforms never accept a pasted token: the owner chooses a channel and
  // the Crewlink bot's membership and posting rights are verified server-side.
  if (byId(platformId)?.auth === 'bot') {
    const channelId = optionalString(body.channelId);
    if (!channelId) {
      return NextResponse.json(
        { error: 'channelId is required for bot platforms.' },
        { status: 400 }
      );
    }
    try {
      const connection = await connectBotChannel({
        userId: String(user.id),
        projectId,
        platformId,
        channelId,
      });
      return NextResponse.json({ connection }, { status: 201 });
    } catch (err) {
      if (err instanceof ConnectionError) return connectionErrorResponse(err);
      throw err;
    }
  }

  // Creator-owned Bluesky accounts sign in with an app password. The password is
  // exchanged for a session server-side and is never stored or returned.
  if (platformId === 'bluesky') {
    const identifier = optionalString(body.identifier);
    const appPassword =
      typeof body.appPassword === 'string' && body.appPassword.trim()
        ? body.appPassword
        : undefined;
    if (!identifier || !appPassword) {
      return NextResponse.json(
        { error: 'identifier and appPassword are required for Bluesky.' },
        { status: 400 }
      );
    }
    try {
      const connection = await connectBlueskyAccount({
        userId: String(user.id),
        projectId,
        identifier,
        appPassword,
      });
      return NextResponse.json({ connection }, { status: 201 });
    } catch (err) {
      if (err instanceof ConnectionError) return connectionErrorResponse(err);
      throw err;
    }
  }

  // Mastodon starts an OAuth authorization; no token passes through the browser.
  if (platformId === 'mastodon') {
    const instanceUrl = optionalString(body.instanceUrl);
    if (!instanceUrl) {
      return NextResponse.json(
        { error: 'instanceUrl is required for Mastodon.' },
        { status: 400 }
      );
    }
    try {
      const result = await beginMastodonAuthorization({
        userId: String(user.id),
        projectId,
        instanceUrl,
        sessionId: auth.sessionId,
      });
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof ConnectionError) return connectionErrorResponse(err);
      throw err;
    }
  }

  // X starts an OAuth 2.0 + PKCE authorization. As with Mastodon, no token ever
  // passes through the browser and the verifier stays encrypted server-side.
  if (platformId === 'x') {
    try {
      const result = await beginXAuthorization({
        userId: String(user.id),
        projectId,
        sessionId: auth.sessionId,
      });
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof ConnectionError) return connectionErrorResponse(err);
      throw err;
    }
  }

  const accessToken = optionalString(body.accessToken);
  if (!accessToken) {
    return NextResponse.json({ error: 'accessToken is required.' }, { status: 400 });
  }

  try {
    const connection = await saveConnection({
      userId: String(user.id),
      projectId,
      platformId,
      accessToken,
      refreshToken: optionalString(body.refreshToken),
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : undefined,
      externalAccountId: optionalString(body.externalAccountId),
      externalAccountName: optionalString(body.externalAccountName),
      channelId: optionalString(body.channelId),
      channelName: optionalString(body.channelName),
      tokenExpiresAt:
        body.tokenExpiresAt === undefined
          ? undefined
          : body.tokenExpiresAt === null
            ? null
            : String(body.tokenExpiresAt),
    });
    return NextResponse.json({ connection }, { status: 201 });
  } catch (err) {
    if (err instanceof ConnectionError) return connectionErrorResponse(err);
    throw err;
  }
}
