import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedCampaign } from '@/ai/access';
import { AiForbiddenError } from '@/ai/errors';
import { analyticsErrorResponse } from '../../errors';
import { rangeFromRequest } from '../../params';
import { getCampaignPerformance } from '@/analytics/queries';
import storage from '@/lib/storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { campaign } = await requireOwnedCampaign(request, id);
    const projectId = new URL(request.url).searchParams.get('projectId') || campaign.projectId;
    if (projectId !== campaign.projectId) {
      throw new AiForbiddenError('That campaign belongs to another project.');
    }
    const range = rangeFromRequest(request);
    const campaigns = await getCampaignPerformance(projectId, range);
    const performance = campaigns.find((row) => row.campaignId === campaign.id);
    if (!performance) {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
    }
    const m8 = await storage.getCampaignAnalytics(campaign.id);
    return NextResponse.json({ performance, m8 });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
