import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedProject } from '@/ai/access';
import { isAnalyticsPlatform } from '@/analytics/platforms';
import { syncProjectAnalytics } from '@/analytics/sync';
import { rateLimiter } from '@/lib/rateLimit';
import { analyticsErrorResponse } from '../errors';

export async function POST(request: NextRequest) {
  try {
    const limit = rateLimiter.check(request, {
      limit: 6,
      windowMs: 60_000,
      keyPrefix: 'analytics-sync',
    });
    if (!limit.success) return rateLimiter.createResponse(limit);

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const projectId = String(body.projectId || '').trim();
    if (!projectId) {
      return NextResponse.json({ error: 'Choose a project.' }, { status: 400 });
    }
    const { user, project } = await requireOwnedProject(request, projectId);
    const requested = Array.isArray(body.platformIds)
      ? body.platformIds
          .filter((value): value is string => typeof value === 'string')
          .filter((value) => isAnalyticsPlatform(value))
      : undefined;
    const result = await syncProjectAnalytics({
      user,
      project,
      platformIds: requested,
      trigger: 'manual',
    });
    return NextResponse.json(result);
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
