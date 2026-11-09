import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const { id: draftId } = await params;
  const draft = await storage.getDraftById(draftId);
  if (!draft) {
    return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });
  }

  const project = await storage.getProjectById(draft.projectId);
  if (!project || project.ownerLogin.toLowerCase() !== user.login.toLowerCase()) {
    return NextResponse.json(
      { error: 'Only the project owner can skip this draft.' },
      { status: 403 }
    );
  }

  const skipped = await storage.skipDraft(draftId);
  if (!skipped) {
    return NextResponse.json({ error: 'Failed to skip draft.' }, { status: 500 });
  }

  return NextResponse.json({ draft: skipped });
}
