import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedProject } from '@/ai/access';
import { analyticsErrorResponse } from '../errors';
import {
  assertCampaignScope,
  campaignIdFromRequest,
  projectIdFromRequest,
  rangeFromRequest,
} from '../params';
import { getTiming } from '@/analytics/queries';

export async function GET(request: NextRequest) {
  try {
    const projectId = projectIdFromRequest(request);
    await requireOwnedProject(request, projectId);
    const campaignId = campaignIdFromRequest(request);
    await assertCampaignScope(request, projectId, campaignId);
    const range = rangeFromRequest(request);
    const result = await getTiming({
      projectId,
      range,
      ...(campaignId ? { campaignId } : {}),
    });
    return NextResponse.json(result);
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
