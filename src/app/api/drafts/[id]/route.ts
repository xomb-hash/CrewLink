import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { config } from '@/config/index';
import { checkDraft } from '@/posting/checks';

export async function PUT(
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
      { error: 'Only the project owner can edit this draft.' },
      { status: 403 }
    );
  }

  let body: { text?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const text = String(body.text || '').slice(0, 10000);
  const updated = await storage.updateDraft(draftId, text);
  if (!updated) {
    return NextResponse.json({ error: 'Failed to update draft.' }, { status: 500 });
  }

  const joinUrl = `${config.appUrl}/join/${project.slug}`;
  const checks = checkDraft(
    {
      ownerName: project.repoOwner,
      repoName: project.repoName,
      repoFullName: project.repoFullName,
      isPrivate: project.isPrivate,
      joinUrl,
      roles: project.roles,
      description: project.description,
    },
    updated.platformId,
    updated.text
  );

  return NextResponse.json({ draft: { ...updated, checks } });
}
