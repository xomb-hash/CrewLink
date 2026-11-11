import { NextRequest, NextResponse } from 'next/server';
import { recomputeSchedule } from '@/ai/actions';
import { requireOwnedCampaign } from '@/ai/access';
import { applyStrategyPatch, getCampaignDetail } from '@/ai/campaigns';
import { rateLimiter } from '@/lib/rateLimit';
import { aiErrorResponse } from '@/app/api/ai/errors';

// The owner edits the proposed strategy. Calendar edits update the same idea
// rows the generator uses, and schedule suggestions are recomputed afterwards.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { campaign } = await requireOwnedCampaign(request, id);
    const limit = rateLimiter.check(request, {
      limit: 30,
      windowMs: 60_000,
      keyPrefix: 'ai-campaign-strategy',
    });
    if (!limit.success) return rateLimiter.createResponse(limit);
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const updated = await applyStrategyPatch(campaign, body);
    const current = await getCampaignDetail(campaign.id);
    if (current.generated.length > 0) {
      await recomputeSchedule(updated.campaign);
    }
    return NextResponse.json({
      campaign: updated.campaign,
      ideas: updated.ideas,
      detail: current,
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
