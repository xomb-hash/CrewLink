import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedProject } from '@/ai/access';
import { createCampaign } from '@/ai/campaigns';
import storage from '@/lib/storage';
import { rateLimiter } from '@/lib/rateLimit';
import { aiErrorResponse } from '@/app/api/ai/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { project } = await requireOwnedProject(request, id);
    return NextResponse.json({
      campaigns: await storage.getCampaignsByProject(project.id),
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user, project } = await requireOwnedProject(request, id);
    const limit = rateLimiter.check(request, {
      limit: 10,
      windowMs: 60_000,
      keyPrefix: 'ai-campaign-create',
    });
    if (!limit.success) return rateLimiter.createResponse(limit);
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const campaign = await createCampaign({
      userId: String(user.id),
      projectId: project.id,
      body,
    });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
