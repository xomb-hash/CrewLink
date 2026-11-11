import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedProject } from '@/ai/access';
import { analyticsErrorResponse } from '../errors';
import { projectIdFromRequest } from '../params';
import { getAnalyticsStatus } from '@/analytics/queries';

export async function GET(request: NextRequest) {
  try {
    const projectId = projectIdFromRequest(request);
    await requireOwnedProject(request, projectId);
    const result = await getAnalyticsStatus(projectId);
    return NextResponse.json(result);
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
