import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedCampaign } from '@/ai/access';
import { getCampaignDetail } from '@/ai/campaigns';
import { aiProviderStatus } from '@/ai/provider';
import { aiErrorResponse } from '@/app/api/ai/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireOwnedCampaign(request, id);
    return NextResponse.json({
      detail: await getCampaignDetail(id),
      status: aiProviderStatus(),
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
