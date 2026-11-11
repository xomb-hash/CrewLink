import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedCampaign } from '@/ai/access';
import { requireConfiguredProvider } from '@/ai/provider';
import { runCampaign } from '@/ai/orchestrator';
import { rateLimiter } from '@/lib/rateLimit';
import { aiErrorResponse } from '@/app/api/ai/errors';

// A campaign run makes several bounded model calls. The route returns when the
// run finishes; nothing is posted or approved, and no credentials are touched.
export const maxDuration = 120;

function ownerSources(value: unknown): Array<{ title?: string; url: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ title?: string; url: string }> = [];
  for (const entry of value.slice(0, 10)) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const url = String(row.url || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({
      title: typeof row.title === 'string' ? row.title.slice(0, 300) : undefined,
      url,
    });
  }
  return out;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, project, campaign } = await requireOwnedCampaign(request, id);
    const limit = rateLimiter.check(request, {
      limit: 5,
      windowMs: 60_000,
      keyPrefix: 'ai-campaign-run',
    });
    if (!limit.success) return rateLimiter.createResponse(limit);
    const provider = requireConfiguredProvider();

    let body: { sources?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const result = await runCampaign({
      campaignId: campaign.id,
      user,
      project,
      provider,
      ownerSources: ownerSources(body.sources),
    });
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}
