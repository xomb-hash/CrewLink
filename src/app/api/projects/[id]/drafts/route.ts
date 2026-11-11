import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { config } from '@/config/index';
import { byId, platforms } from '@/platforms/registry';
import { draftPost } from '@/posting/drafts';
import { checkDraft } from '@/posting/checks';
import { publicationStateFor } from '@/posting/publicationState';

export async function GET(
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
      { error: 'Only the project owner can view drafts.' },
      { status: 403 }
    );
  }

  const allDrafts = await storage.getDraftsByProject(projectId);
  const joinUrl = `${config.appUrl}/join/${project.slug}`;
  const approvedDrafts = allDrafts
    .filter((d) => d.status === 'approved' && d.approvedText && d.approvedAt)
    .map((d) => ({
      platformId: d.platformId,
      approvedText: d.approvedText!,
      approvedAt: d.approvedAt!,
    }));

  const draftsWithChecks = await Promise.all(
    allDrafts.map(async (draft) => {
      const checks = checkDraft(
        {
          ownerName: project.repoOwner,
          repoName: project.repoName,
          repoFullName: project.repoFullName,
          isPrivate: project.isPrivate,
          joinUrl,
          roles: project.roles,
          description: project.description,
          approvedDrafts: approvedDrafts.filter((a) => a.approvedText !== draft.text),
        },
        draft.platformId,
        draft.text,
        draft.threadParts,
        draft.platformId === 'reddit'
          ? {
              title: draft.title,
              subreddit: draft.subreddit,
              submissionType: draft.submissionType,
              linkUrl: draft.linkUrl,
            }
          : undefined
      );
      const publication = await storage.getPublication(draft.id, draft.platformId);
      return {
        ...draft,
        checks,
        publication,
        publicationState: publicationStateFor(draft, publication),
      };
    })
  );

  return NextResponse.json({ drafts: draftsWithChecks });
}

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
      { error: 'Only the project owner can create drafts.' },
      { status: 403 }
    );
  }

  let body: { platforms?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const requestedPlatforms = Array.isArray(body.platforms) && body.platforms.length > 0
    ? body.platforms.filter((id) => byId(id))
    : platforms.map((p) => p.id);

  if (requestedPlatforms.length === 0) {
    return NextResponse.json({ error: 'Choose at least one draft platform.' }, { status: 400 });
  }

  const existingDrafts = await storage.getDraftsByProject(projectId);
  const joinUrl = `${config.appUrl}/join/${project.slug}`;
  const projectDraftContext = {
    ownerName: project.repoOwner,
    repoName: project.repoName,
    repoFullName: project.repoFullName,
    isPrivate: project.isPrivate,
    joinUrl,
    roles: project.roles,
    description: project.description,
  };

  const createdDrafts = [];
  for (const platformId of requestedPlatforms) {
    let draft = existingDrafts.find((d) => d.platformId === platformId && d.status !== 'skipped');
    if (!draft) {
      const text = draftPost(projectDraftContext, platformId);
      draft = await storage.createDraft({
        projectId,
        platformId,
        text,
        // A Reddit submission needs a title and a type from the start. The owner
        // still has to choose a subreddit before it can be approved.
        ...(platformId === 'reddit'
          ? {
              title: `${project.repoOwner}/${project.repoName} is looking for collaborators`.slice(
                0,
                300
              ),
              submissionType: 'self' as const,
            }
          : {}),
      });
    }

    const checks = checkDraft(
      projectDraftContext,
      draft.platformId,
      draft.text,
      draft.threadParts,
      draft.platformId === 'reddit'
        ? {
            title: draft.title,
            subreddit: draft.subreddit,
            submissionType: draft.submissionType,
            linkUrl: draft.linkUrl,
          }
        : undefined
    );
    createdDrafts.push({ ...draft, checks });
  }

  return NextResponse.json({ drafts: createdDrafts }, { status: 201 });
}
