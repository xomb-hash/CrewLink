import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { rateLimiter } from '@/lib/rateLimit';
import { storage } from '@/lib/storage';
import { ConnectionError } from '@/posting/connections';
import { validateRedditSubmissionLive } from '@/posting/reddit/discovery';
import { AdapterError } from '@/posting/adapters/types';

function failure(err: unknown): NextResponse | null {
  if (err instanceof ConnectionError) {
    const status =
      err.code === 'forbidden'
        ? 403
        : err.code === 'connection_not_found'
          ? 404
          : err.code === 'connection_inactive'
            ? 409
            : 400;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  if (err instanceof AdapterError) {
    const status =
      err.code === 'rate_limited'
        ? 429
        : err.code === 'token_expired' || err.code === 'revoked'
          ? 409
          : err.code === 'invalid_input' || err.code === 'validation_error'
            ? 400
            : 502;
    const body: Record<string, unknown> = { error: err.message, code: err.code };
    if (err.retryAfterSeconds !== undefined) body.retryAfterSeconds = err.retryAfterSeconds;
    return NextResponse.json(body, { status });
  }
  return null;
}

// Owner-only live validation against the selected subreddit. The publish engine
// repeats this check itself; the route only powers the composer's Validate button.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const rateLimitCheck = rateLimiter.check(request, {
    limit: 20,
    windowMs: 60_000,
    keyPrefix: 'reddit-validate',
  });
  if (!rateLimitCheck.success) return rateLimiter.createResponse(rateLimitCheck);

  const { id } = await params;
  const draft = await storage.getDraftById(id);
  if (!draft) return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });
  if (draft.platformId !== 'reddit') {
    return NextResponse.json({ error: 'This draft is not a Reddit submission.' }, { status: 400 });
  }

  const project = await storage.getProjectById(draft.projectId);
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  if (project.ownerId !== String(user.id)) {
    return NextResponse.json(
      { error: 'Only the project owner can validate this draft.' },
      { status: 403 }
    );
  }

  try {
    const result = await validateRedditSubmissionLive({
      userId: String(user.id),
      projectId: project.id,
      draft,
    });
    return NextResponse.json({
      checks: result.validation.checks,
      unverifiable: result.validation.unverifiable,
      subreddit: result.subreddit,
      requirements: result.requirements,
    });
  } catch (err) {
    const response = failure(err);
    if (response) return response;
    throw err;
  }
}
