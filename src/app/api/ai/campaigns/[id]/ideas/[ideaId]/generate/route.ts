import { NextRequest, NextResponse } from 'next/server';
import { generateIdea, recomputeSchedule } from '@/ai/actions';
import { requireOwnedCampaign } from '@/ai/access';
import { getCampaignDetail } from '@/ai/campaigns';
import { requireConfiguredProvider } from '@/ai/provider';
import { rateLimiter } from '@/lib/rateLimit';
import { aiErrorResponse } from '@/app/api/ai/errors';

// Generates or regenerates one calendar entry. `force` keeps existing drafts and
// adds a new variation; nothing is approved or published here.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ideaId: string }> }
) {
  try {
    const { id, ideaId } = await params;
    const { project, campaign } = await requireOwnedCampaign(request, id);
    const limit = rateLimiter.check(request, {
      limit: 20,
      windowMs: 60_000,
      keyPrefix: 'ai-idea-generate',
    });
    if (!limit.success) return rateLimiter.createResponse(limit);
    const provider = requireConfiguredProvider();
    let body: { force?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const { idea, result } = await generateIdea({
      campaign,
      ideaId,
      project,
      provider,
      force: body.force === true,
    });
    await recomputeSchedule(campaign);
    return NextResponse.json({
      idea,
      drafts: result.drafts,
      generated: result.generated,
      issues: result.issues,
      detail: await getCampaignDetail(campaign.id),
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
