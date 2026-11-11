import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedProject } from '@/ai/access';
import { getBrandProfile, saveBrandProfile } from '@/ai/brand';
import { rateLimiter } from '@/lib/rateLimit';
import { aiErrorResponse } from '@/app/api/ai/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { project } = await requireOwnedProject(request, id);
    return NextResponse.json({ brand: await getBrandProfile(project.id) });
  } catch (error) {
    return aiErrorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { project } = await requireOwnedProject(request, id);
    const limit = rateLimiter.check(request, {
      limit: 30,
      windowMs: 60_000,
      keyPrefix: 'ai-brand',
    });
    if (!limit.success) return rateLimiter.createResponse(limit);
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const brand = await saveBrandProfile(project.id, body);
    return NextResponse.json({ brand });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
