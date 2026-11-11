import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedCampaign } from '@/ai/access';
import { collectCampaignAnalytics } from '@/ai/analytics';
import { rateLimiter } from '@/lib/rateLimit';
import { aiErrorResponse } from '@/app/api/ai/errors';

// Recomputes counts from Crewlink's own publication records. No platform
// analytics API is called, and unsupported metrics are reported as unavailable.
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
      keyPrefix: 'ai-analytics',
    });
    if (!limit.success) return rateLimiter.createResponse(limit);
    return NextResponse.json({
      analytics: await collectCampaignAnalytics(campaign),
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
