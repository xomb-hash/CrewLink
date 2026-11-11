import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/config/index';
import { getCurrentUser } from '@/lib/auth';
import { rateLimiter } from '@/lib/rateLimit';
import { storage } from '@/lib/storage';
import { estimateXThread, X_MANUAL_COST } from '@/posting/x/pricing';
import { getXBudgetSummary } from '@/posting/x/usage';

// Owner-only cost preview for the automatic X path. Manual publishing is shown
// separately as free; nothing here calls X.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const rateLimitCheck = rateLimiter.check(request, {
    limit: 60,
    windowMs: 60_000,
    keyPrefix: 'x-estimate',
  });
  if (!rateLimitCheck.success) {
    return rateLimiter.createResponse(rateLimitCheck);
  }

  const { id } = await params;
  const draft = await storage.getDraftById(id);
  if (!draft) {
    return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });
  }
  if (draft.platformId !== 'x') {
    return NextResponse.json({ error: 'Only X drafts have an X cost estimate.' }, { status: 400 });
  }
  const project = await storage.getProjectById(draft.projectId);
  if (!project || project.ownerLogin.toLowerCase() !== user.login.toLowerCase()) {
    return NextResponse.json(
      { error: 'Only the project owner can view this estimate.' },
      { status: 403 }
    );
  }

  const parts = draft.threadParts && draft.threadParts.length
    ? draft.threadParts
    : [draft.text];
  const estimate = estimateXThread(parts);
  const budget = await getXBudgetSummary();

  return NextResponse.json({
    estimate,
    budget,
    automaticConfigured: Boolean(config.xClientId),
    manual: X_MANUAL_COST,
  });
}
