import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { config } from '@/config/index';
import { checkDraft } from '@/posting/checks';
import { redditApprovalHash } from '@/posting/reddit/validate';

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
      { error: 'Only the project owner can approve this draft.' },
      { status: 403 }
    );
  }

  const joinUrl = `${config.appUrl}/join/${project.slug}`;
  const allDrafts = await storage.getDraftsByProject(project.id);
  const approvedDrafts = allDrafts
    .filter((d) => d.status === 'approved' && d.id !== draft.id && d.approvedText && d.approvedAt)
    .map((d) => ({
      platformId: d.platformId,
      approvedText: d.approvedText!,
      approvedAt: d.approvedAt!,
    }));

  const checks = checkDraft(
    {
      ownerName: project.repoOwner,
      repoName: project.repoName,
      repoFullName: project.repoFullName,
      isPrivate: project.isPrivate,
      joinUrl,
      roles: project.roles,
      description: project.description,
      approvedDrafts,
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

  if (checks.some((c) => c.level === 'error')) {
    return NextResponse.json(
      { error: 'Fix errors before approving.', checks },
      { status: 400 }
    );
  }

  // A Reddit approval covers the title, subreddit, type and link as well as the
  // body, so editing any of them requires a new approval.
  const approved = await storage.approveDraft(
    draftId,
    user.login,
    draft.platformId === 'reddit'
      ? {
          approvedText: draft.text,
          approvedHash: redditApprovalHash({
            title: draft.title,
            subreddit: draft.subreddit,
            submissionType: draft.submissionType,
            text: draft.text,
            linkUrl: draft.linkUrl,
          }),
        }
      : undefined
  );
  if (!approved) {
    return NextResponse.json({ error: 'Failed to approve draft.' }, { status: 500 });
  }

  return NextResponse.json({ draft: { ...approved, checks } });
}
