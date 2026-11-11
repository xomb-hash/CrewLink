import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedProject } from '@/ai/access';
import { analyticsErrorResponse } from '../errors';
import { projectIdFromRequest, rangeFromRequest } from '../params';
import { getCampaignPerformance } from '@/analytics/queries';

export async function GET(request: NextRequest) {
  try {
    const projectId = projectIdFromRequest(request);
    await requireOwnedProject(request, projectId);
    const range = rangeFromRequest(request);
    const campaigns = await getCampaignPerformance(projectId, range);
    return NextResponse.json({ campaigns });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
