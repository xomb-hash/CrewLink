import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { config } from '@/config/index';
import { checkDraft } from '@/posting/checks';
import { threadText, X_MAX_THREAD_PARTS } from '@/posting/x/text';
import {
  normalizeSubreddit,
  REDDIT_BODY_LIMIT,
  REDDIT_TITLE_LIMIT,
} from '@/posting/reddit/validate';
import { LINKEDIN_POST_LIMIT } from '@/posting/linkedin/config';

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

  let body: {
    text?: string;
    threadParts?: unknown;
    title?: unknown;
    subreddit?: unknown;
    submissionType?: unknown;
    linkUrl?: unknown;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const hasRedditFields =
    body.title !== undefined ||
    body.subreddit !== undefined ||
    body.submissionType !== undefined ||
    body.linkUrl !== undefined;
  if (hasRedditFields && draft.platformId !== 'reddit') {
    return NextResponse.json(
      { error: 'Title, subreddit and submission type are only used for Reddit drafts.' },
      { status: 400 }
    );
  }

  // Reddit submissions carry structured fields as well as a body. Unknown values
  // are rejected rather than guessed.
  let redditPatch:
    | {
        title: string;
        subreddit: string;
        submissionType: 'self' | 'link';
        linkUrl: string;
      }
    | undefined;
  if (draft.platformId === 'reddit') {
    const submissionType =
      body.submissionType === undefined ? draft.submissionType || 'self' : body.submissionType;
    if (submissionType !== 'self' && submissionType !== 'link') {
      return NextResponse.json(
        { error: 'Choose a text or link submission.' },
        { status: 400 }
      );
    }
    const title = String(body.title ?? draft.title ?? '').trim();
    if (title.length > REDDIT_TITLE_LIMIT) {
      return NextResponse.json(
        { error: `The title is limited to ${REDDIT_TITLE_LIMIT} characters.` },
        { status: 400 }
      );
    }
    const subreddit = normalizeSubreddit(body.subreddit ?? draft.subreddit ?? '');
    if (subreddit && !/^[A-Za-z0-9_]{2,21}$/.test(subreddit)) {
      return NextResponse.json({ error: 'Enter a valid subreddit name.' }, { status: 400 });
    }
    const linkUrl =
      submissionType === 'link' ? String(body.linkUrl ?? draft.linkUrl ?? '').trim() : '';
    redditPatch = { title, subreddit, submissionType, linkUrl };
  }

  // Only X supports threads. The joined text stays canonical so approval and
  // duplicate checks work exactly as they do for single posts.
  let threadParts: string[] | undefined;
  if (body.threadParts !== undefined && !redditPatch) {
    if (draft.platformId !== 'x') {
      return NextResponse.json(
        { error: 'Only X drafts can be threads.' },
        { status: 400 }
      );
    }
    if (!Array.isArray(body.threadParts) || body.threadParts.length === 0) {
      return NextResponse.json({ error: 'Add at least one post.' }, { status: 400 });
    }
    if (body.threadParts.length > X_MAX_THREAD_PARTS) {
      return NextResponse.json(
        { error: `A thread can contain at most ${X_MAX_THREAD_PARTS} posts.` },
        { status: 400 }
      );
    }
    threadParts = body.threadParts.map((part) =>
      typeof part === 'string' ? part.trim().slice(0, 10000) : ''
    );
    if (threadParts.some((part) => !part)) {
      return NextResponse.json({ error: 'Each post needs text.' }, { status: 400 });
    }
  }

  if (redditPatch && String(body.text ?? draft.text ?? '').length > REDDIT_BODY_LIMIT) {
    return NextResponse.json(
      { error: `The body is limited to ${REDDIT_BODY_LIMIT.toLocaleString()} characters.` },
      { status: 400 }
    );
  }
  // LinkedIn posts are never silently truncated: over-limit text is rejected so
  // the owner edits it and approves the exact text that will be sent.
  if (
    draft.platformId === 'linkedin' &&
    String(body.text ?? draft.text ?? '').length > LINKEDIN_POST_LIMIT
  ) {
    return NextResponse.json(
      { error: `A LinkedIn post is limited to ${LINKEDIN_POST_LIMIT.toLocaleString()} characters.` },
      { status: 400 }
    );
  }
  const textLimit = redditPatch
    ? REDDIT_BODY_LIMIT
    : draft.platformId === 'linkedin'
      ? LINKEDIN_POST_LIMIT
      : 10000;
  const text = redditPatch
    ? String(body.text ?? draft.text ?? '')
    : threadParts
      ? threadText(threadParts)
      : String(body.text || '').slice(0, textLimit);
  const updated = await storage.updateDraft(
    draftId,
    text,
    threadParts ?? null,
    redditPatch,
    textLimit
  );
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
    updated.text,
    updated.threadParts,
    updated.platformId === 'reddit'
      ? {
          title: updated.title,
          subreddit: updated.subreddit,
          submissionType: updated.submissionType,
          linkUrl: updated.linkUrl,
        }
      : undefined
  );

  return NextResponse.json({ draft: { ...updated, checks } });
}
