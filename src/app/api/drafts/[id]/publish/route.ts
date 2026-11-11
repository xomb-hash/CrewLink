import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { rateLimiter } from '@/lib/rateLimit';
import { PublishError, publishDraft } from '@/posting/publish';

function publishErrorResponse(error: PublishError): NextResponse {
  const status =
    error.code === 'forbidden'
      ? 403
      : error.code === 'draft_not_found' ||
          error.code === 'project_not_found' ||
          error.code === 'connection_not_found'
        ? 404
        : error.code === 'in_progress' ||
            error.code === 'already_published' ||
            error.code === 'uncertain' ||
            error.code === 'auth_revoked' ||
            error.code === 'partial_thread'
          ? 409
          : error.code === 'bot_token_missing' ||
              error.code === 'x_not_configured' ||
              error.code === 'reddit_not_configured' ||
              error.code === 'linkedin_not_configured'
            ? 503
            : error.code === 'rate_limited'
              ? 429
              : error.code === 'cost_confirmation_required' ||
                  error.code === 'budget_exhausted'
                ? 402
                : error.code === 'send_failed' || error.code === 'platform_error'
                  ? 502
                  : 400;

  const body: Record<string, unknown> = { error: error.message, code: error.code };
  if (error.retryAfterSeconds !== undefined) body.retryAfterSeconds = error.retryAfterSeconds;
  if (error.estimate) body.estimate = error.estimate;
  if (error.budget) body.budget = error.budget;
  return NextResponse.json(body, { status });
}

// Publishes one approved draft. Approval is checked again here, server-side, and
// each draft can reach each platform at most once. X also requires an explicit
// cost confirmation before its paid API is called.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const rateLimitCheck = rateLimiter.check(request, {
    limit: 10,
    windowMs: 60_000,
    keyPrefix: 'draft-publish',
  });
  if (!rateLimitCheck.success) {
    return rateLimiter.createResponse(rateLimitCheck);
  }

  // The body is optional (existing callers send none); only the cost fields are
  // read, and malformed JSON is treated as "no confirmation".
  let body: { confirmCost?: unknown; maxCostUsd?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { id } = await params;

  try {
    const result = await publishDraft({
      userId: String(user.id),
      draftId: id,
      confirmCost: body.confirmCost === true,
      maxCostUsd:
        typeof body.maxCostUsd === 'number' ? body.maxCostUsd : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PublishError) return publishErrorResponse(err);
    throw err;
  }
}
