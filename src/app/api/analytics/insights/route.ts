import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedCampaign, requireOwnedProject } from '@/ai/access';
import type { Campaign } from '@/ai/types';
import { AiForbiddenError } from '@/ai/errors';
import { requireConfiguredProvider } from '@/ai/provider';
import { resolveAnalyticsRange } from '@/analytics/range';
import { getInsights } from '@/analytics/queries';
import { runAnalyticsInsight } from '@/analytics/insights';
import { rateLimiter } from '@/lib/rateLimit';
import { analyticsErrorResponse } from '../errors';

export async function GET(request: NextRequest) {
  try {
    const params = new URL(request.url).searchParams;
    const projectId = params.get('projectId')?.trim() || '';
    if (!projectId) {
      return NextResponse.json({ error: 'Choose a project.' }, { status: 400 });
    }
    await requireOwnedProject(request, projectId);
    const campaignId = params.get('campaignId')?.trim() || undefined;
    if (campaignId) {
      const { campaign } = await requireOwnedCampaign(request, campaignId);
      if (campaign.projectId !== projectId) {
        throw new AiForbiddenError('That campaign belongs to another project.');
      }
    }
    const insights = await getInsights(projectId, campaignId, 20);
    return NextResponse.json({ insights });
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const limit = rateLimiter.check(request, {
      limit: 5,
      windowMs: 60_000,
      keyPrefix: 'analytics-insight',
    });
    if (!limit.success) return rateLimiter.createResponse(limit);

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const requestedProjectId = String(body.projectId || '').trim();
    const campaignId = String(body.campaignId || '').trim() || undefined;
    if (!requestedProjectId) {
      return NextResponse.json({ error: 'Choose a project.' }, { status: 400 });
    }
    await requireOwnedProject(request, requestedProjectId);
    let projectId = requestedProjectId;
    let campaign: Campaign | null = null;
    if (campaignId) {
      const owned = await requireOwnedCampaign(request, campaignId);
      if (owned.campaign.projectId !== requestedProjectId) {
        throw new AiForbiddenError('That campaign belongs to another project.');
      }
      campaign = owned.campaign;
      projectId = owned.campaign.projectId;
    }
    const { user, project } = await requireOwnedProject(request, projectId);
    const range = resolveAnalyticsRange({
      days: body.days,
      from: body.from,
      to: body.to,
      timezone: body.timezone,
    });
    const provider = requireConfiguredProvider();
    const result = await runAnalyticsInsight({
      user,
      project,
      campaign,
      range,
      provider,
    });
    return NextResponse.json(
      {
        insight: result.insight,
        sample: {
          postsWithMetrics: result.facts.sample.postsWithMetrics,
          publishedPosts: result.facts.sample.publishedPosts,
          platforms: result.facts.sample.platforms,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
