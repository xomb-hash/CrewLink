import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { rateLimiter } from '@/lib/rateLimit';
import { notifyOwnerNewApplication } from '@/lib/notifications';
import { formatAccountAge, validateApplicantInput } from '@/lib/validation';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  // Apply rate limiting: 10 requests per minute per IP
  const rateLimitCheck = rateLimiter.check(request, {
    limit: 10,
    windowMs: 60_000,
    keyPrefix: 'join-apply',
  });
  if (!rateLimitCheck.success) {
    return rateLimiter.createResponse(rateLimitCheck);
  }

  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: 'Please sign in with GitHub to apply.' }, { status: 401 });
  }

  const { slug } = await params;
  const project = await storage.getProjectBySlug(slug);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  // Prevent project owners from applying to their own project
  if (project.ownerLogin.toLowerCase() === currentUser.login.toLowerCase()) {
    return NextResponse.json(
      { error: 'You are the owner of this project and cannot apply to it.' },
      { status: 400 }
    );
  }

  // Prevent duplicate applications
  const existing = await storage.findApplicant(project.id, currentUser.id);
  if (existing) {
    return NextResponse.json(
      { error: 'You have already applied to this project.' },
      { status: 400 }
    );
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // optional body
  }

  const validation = validateApplicantInput(body as Parameters<typeof validateApplicantInput>[0]);
  if (!validation.isValid) {
    return NextResponse.json({ errors: validation.errors }, { status: 400 });
  }

  const accountAge = formatAccountAge(currentUser.createdAt);

  const applicant = await storage.createApplicant({
    projectId: project.id,
    userId: currentUser.id,
    userLogin: currentUser.login,
    userAvatar: currentUser.avatarUrl,
    accountAge,
    publicRepoCount: currentUser.publicRepos || 0,
    message: validation.data.message,
    proofUrl: validation.data.proofUrl,
    linkedinUrl: validation.data.linkedinUrl,
  });

  // Non-blocking notification dispatch
  notifyOwnerNewApplication(project, applicant).catch(() => {});

  return NextResponse.json(
    {
      applicant: {
        id: applicant.id,
        status: applicant.status,
        createdAt: applicant.createdAt,
      },
    },
    { status: 201 }
  );
}

