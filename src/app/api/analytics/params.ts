import type { NextRequest } from 'next/server';
import { resolveAnalyticsRange } from '@/analytics/range';
import { AnalyticsError } from '@/analytics/sync';
import type { AnalyticsRange } from '@/analytics/types';
import { requireOwnedCampaign } from '@/ai/access';
import { AiForbiddenError } from '@/ai/errors';

export function projectIdFromRequest(request: NextRequest): string {
  const projectId = new URL(request.url).searchParams.get('projectId')?.trim() || '';
  if (!projectId) {
    throw new AnalyticsError('Choose a project.', 'invalid_input');
  }
  return projectId;
}

export function rangeFromRequest(request: NextRequest): AnalyticsRange {
  const params = new URL(request.url).searchParams;
  return resolveAnalyticsRange({
    days: params.get('days') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    timezone: params.get('timezone') ?? undefined,
  });
}

export function campaignIdFromRequest(request: NextRequest): string | undefined {
  return new URL(request.url).searchParams.get('campaignId')?.trim() || undefined;
}

export function optionalPlatformId(request: NextRequest): string | undefined {
  return new URL(request.url).searchParams.get('platformId')?.trim() || undefined;
}

// A campaign filter must belong to the selected project and to the signed-in
// owner; otherwise analytics for another project could be reached by id.
export async function assertCampaignScope(
  request: NextRequest,
  projectId: string,
  campaignId?: string
): Promise<void> {
  if (!campaignId) return;
  const { campaign } = await requireOwnedCampaign(request, campaignId);
  if (campaign.projectId !== projectId) {
    throw new AiForbiddenError('That campaign belongs to another project.');
  }
}
