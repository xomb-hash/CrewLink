import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { config } from '@/config/index';
import { draftPersonalPost, type PersonalPostOptions } from '@/posting/drafts';
import { checkDraft } from '@/posting/checks';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const { id: projectId } = await params;
  const project = await storage.getProjectById(projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  if (project.ownerLogin.toLowerCase() !== user.login.toLowerCase()) {
    return NextResponse.json(
      { error: 'Only the project owner can generate personal posts.' },
      { status: 403 }
    );
  }

  let body: {
    roles?: string[];
    tone?: 'professional' | 'casual';
    extraLine?: string;
    includeScreeningLink?: boolean;
  } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const requestedRoles = Array.isArray(body.roles)
    ? body.roles.map((r) => String(r || '').trim()).filter(Boolean).slice(0, 5)
    : project.roles;

  const joinUrl = `${config.appUrl}/join/${project.slug}`;
  const projectDraftContext = {
    ownerName: project.repoOwner,
    repoName: project.repoName,
    repoFullName: project.repoFullName,
    isPrivate: project.isPrivate,
    joinUrl,
    roles: requestedRoles,
    description: project.description,
    mode: project.joinMode,
    screeningUrl: project.screeningUrl,
  };

  const text = draftPersonalPost(projectDraftContext, body as PersonalPostOptions);
  const checks = checkDraft(projectDraftContext, 'personal', text);

  return NextResponse.json({ text, checks });
}
