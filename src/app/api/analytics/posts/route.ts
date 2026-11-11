import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedProject } from '@/ai/access';
import { analyticsErrorResponse } from '../errors';
import {
  assertCampaignScope,
  campaignIdFromRequest,
  projectIdFromRequest,
  rangeFromRequest,
} from '../params';
import { getPostRows, type PostFilter } from '@/analytics/queries';

const SORTS = new Set(['publishedAt', 'engagement', 'impressions', 'likes', 'comments']);
const PERFORMANCE = new Set(['top', 'weak', 'typical', 'unknown']);

export async function GET(request: NextRequest) {
  try {
    const projectId = projectIdFromRequest(request);
    await requireOwnedProject(request, projectId);
    const campaignId = campaignIdFromRequest(request);
    await assertCampaignScope(request, projectId, campaignId);
    const range = rangeFromRequest(request);
    const params = new URL(request.url).searchParams;
    const sort = params.get('sort') || 'publishedAt';
    const performance = params.get('performance') || '';
    const filter: PostFilter = {
      platformId: params.get('platformId') || undefined,
      campaignId,
      contentType: params.get('contentType') || undefined,
      performance: PERFORMANCE.has(performance) ? (performance as PostFilter['performance']) : undefined,
      sort: SORTS.has(sort) ? (sort as PostFilter['sort']) : 'publishedAt',
      order: params.get('order') === 'asc' ? 'asc' : 'desc',
      limit: Number(params.get('limit')) || 50,
      offset: Number(params.get('offset')) || 0,
    };
    const result = await getPostRows({ projectId, range, ...(campaignId ? { campaignId } : {}) }, filter);
    return NextResponse.json(result);
  } catch (error) {
    return analyticsErrorResponse(error);
  }
}
