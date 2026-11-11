import { NextRequest, NextResponse } from 'next/server';
import { overrideSchedule } from '@/ai/actions';
import { requireOwnedCampaign } from '@/ai/access';
import { rateLimiter } from '@/lib/rateLimit';
import { aiErrorResponse } from '@/app/api/ai/errors';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; scheduleId: string }> }
) {
  try {
    const { id, scheduleId } = await params;
    const { campaign } = await requireOwnedCampaign(request, id);
    const limit = rateLimiter.check(request, {
      limit: 60,
      windowMs: 60_000,
      keyPrefix: 'ai-schedule-override',
    });
    if (!limit.success) return rateLimiter.createResponse(limit);
    let body: { scheduledFor?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const schedules = await overrideSchedule({
      campaign,
      scheduleId,
      scheduledFor: body.scheduledFor,
    });
    return NextResponse.json({ schedules });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
