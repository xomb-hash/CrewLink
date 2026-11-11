import { NextRequest, NextResponse } from 'next/server';
import { recomputeSchedule } from '@/ai/actions';
import { requireOwnedCampaign } from '@/ai/access';
import { rateLimiter } from '@/lib/rateLimit';
import { aiErrorResponse } from '@/app/api/ai/errors';

// Rebuilds heuristic suggestions. Manual times are preserved by storage.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { campaign } = await requireOwnedCampaign(request, id);
    const limit = rateLimiter.check(request, {
      limit: 20,
      windowMs: 60_000,
      keyPrefix: 'ai-schedule',
    });
    if (!limit.success) return rateLimiter.createResponse(limit);
    return NextResponse.json({ schedules: await recomputeSchedule(campaign) });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
