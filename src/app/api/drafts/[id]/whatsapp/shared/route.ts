import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { rateLimiter } from '@/lib/rateLimit';
import { PublishError } from '@/posting/publish';
import { markWhatsAppShared } from '@/posting/whatsapp/share';

function manualErrorResponse(error: PublishError): NextResponse {
  const status =
    error.code === 'forbidden'
      ? 403
      : error.code === 'draft_not_found' || error.code === 'project_not_found'
        ? 404
        : error.code === 'already_published' || error.code === 'in_progress'
          ? 409
          : error.code === 'draft_not_approved' || error.code === 'draft_changed'
            ? 409
            : 400;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

// Records the owner's statement that they shared the message by hand. Crewlink
// cannot verify this and never reports it as sent or delivered.
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
    keyPrefix: 'whatsapp-shared',
  });
  if (!rateLimitCheck.success) return rateLimiter.createResponse(rateLimitCheck);

  const { id } = await params;

  try {
    const result = await markWhatsAppShared({
      userId: String(user.id),
      draftId: id,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PublishError) return manualErrorResponse(err);
    throw err;
  }
}
