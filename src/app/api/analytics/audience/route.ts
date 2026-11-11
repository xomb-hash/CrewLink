import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedProject } from '@/ai/access';
import { analyticsErrorResponse } from '../errors';
import { projectIdFromRequest, rangeFromRequest } from '../params';
import { getAudience } from '@/analytics/queries';

export async function GET(request: NextRequest) {
  try {
    const projectId = projectIdFromRequest(request);
    await requireOwnedProject(request, projectId);
    const range = rangeFromRequest(request);
    const result = await getAudience({ projectId, range });
    return NextResponse.json(result);
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
