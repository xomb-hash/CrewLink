import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { rateLimiter } from '@/lib/rateLimit';
import { PublishError } from '@/posting/publish';
import { prepareWhatsAppShare } from '@/posting/whatsapp/share';

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

// Validates an approved WhatsApp draft and returns a click-to-chat link. No
// request is made to WhatsApp and no message content leaves the server.
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
    keyPrefix: 'whatsapp-prepare',
  });
  if (!rateLimitCheck.success) return rateLimiter.createResponse(rateLimitCheck);

  const { id } = await params;

  try {
    const result = await prepareWhatsAppShare({
      userId: String(user.id),
      draftId: id,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PublishError) return manualErrorResponse(err);
    throw err;
  }
}
