import { NextRequest, NextResponse } from 'next/server';
import { requireAiUser } from '@/ai/access';
import { aiProviderStatus } from '@/ai/provider';
import { aiErrorResponse } from '../errors';

// Reports only whether a provider is configured. Keys, base URLs and models
// chosen by the server are never sent to the browser beyond the model name.
export async function GET(request: NextRequest) {
  try {
    await requireAiUser(request);
    return NextResponse.json({ status: aiProviderStatus() });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
