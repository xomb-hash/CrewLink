import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { rateLimiter } from '@/lib/rateLimit';
import { storage } from '@/lib/storage';
import { ConnectionError } from '@/posting/connections';
import { getRedditSubredditDetails } from '@/posting/reddit/discovery';
import { AdapterError } from '@/posting/adapters/types';
import { connectionErrorResponse } from '../../../errors';

function adapterErrorResponse(err: AdapterError): NextResponse {
  const status =
    err.code === 'rate_limited'
      ? 429
      : err.code === 'invalid_input' || err.code === 'validation_error'
        ? 400
        : err.code === 'token_expired' || err.code === 'revoked'
          ? 409
          : 502;
  const body: Record<string, unknown> = { error: err.message, code: err.code };
  if (err.retryAfterSeconds !== undefined) body.retryAfterSeconds = err.retryAfterSeconds;
  return NextResponse.json(body, { status });
}

// Owner-only subreddit details: public description, subscriber count, posting
// type, rules and the API-reported post requirements.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const rateLimitCheck = rateLimiter.check(request, {
    limit: 60,
    windowMs: 60_000,
    keyPrefix: 'reddit-subreddit',
  });
  if (!rateLimitCheck.success) return rateLimiter.createResponse(rateLimitCheck);

  const projectId = request.nextUrl.searchParams.get('projectId') || '';
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required.' }, { status: 400 });
  }

  const project = await storage.getProjectById(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  if (project.ownerId !== String(user.id)) {
    return NextResponse.json(
      { error: 'Only the project owner can view subreddit details.' },
      { status: 403 }
    );
  }

  const { name } = await params;
  try {
    const result = await getRedditSubredditDetails(String(user.id), projectId, name);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ConnectionError) return connectionErrorResponse(err);
    if (err instanceof AdapterError) return adapterErrorResponse(err);
    throw err;
  }
}
