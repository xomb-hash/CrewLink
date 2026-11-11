import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { rateLimiter } from '@/lib/rateLimit';
import { markPublishedManually, PublishError } from '@/posting/publish';

function manualErrorResponse(error: PublishError): NextResponse {
  const status =
    error.code === 'forbidden'
      ? 403
      : error.code === 'draft_not_found' || error.code === 'project_not_found'
        ? 404
        : error.code === 'in_progress' ||
            error.code === 'already_published' ||
            error.code === 'partial_thread'
          ? 409
          : 400;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

// Records that the owner posted the approved draft by hand. No X API call is
// made, so this is free and works without an X connection.
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
    keyPrefix: 'draft-manual-published',
  });
  if (!rateLimitCheck.success) {
    return rateLimiter.createResponse(rateLimitCheck);
  }

  const { id } = await params;

  try {
    const result = await markPublishedManually({
      userId: String(user.id),
      draftId: id,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PublishError) return manualErrorResponse(err);
    throw err;
  }
}
