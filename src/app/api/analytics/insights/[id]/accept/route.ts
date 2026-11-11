import { NextRequest, NextResponse } from 'next/server';
import storage from '@/lib/storage';
import { requireOwnedProject } from '@/ai/access';
import { analyticsErrorResponse } from '../../../errors';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const insight = await storage.getAnalyticsInsight(id);
    if (!insight) {
      return NextResponse.json({ error: 'Insight not found.' }, { status: 404 });
    }
    await requireOwnedProject(request, insight.projectId);
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const status = body.status === 'dismissed' ? 'dismissed' : 'accepted';
    const updated = await storage.updateAnalyticsInsightStatus(id, status);
    return NextResponse.json({ insight: updated });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
