import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { rateLimiter } from '@/lib/rateLimit';
import { notifyOwnerNewApplication } from '@/lib/notifications';
import { formatAccountAge, validateApplicantInput } from '@/lib/validation';
import { deleteResume, ResumeUploadError, saveResume } from '@/lib/uploads';
import { referralCodeMatches } from '@/projects/referral';

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

  let rawMessage = '';
  let rawGithubUrl = '';
  let rawLinkedinUrl = '';
  let rawReferralCode = '';
  let resumeFile: File | null = null;

  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      rawMessage = typeof form.get('message') === 'string' ? String(form.get('message')) : '';
      rawGithubUrl = typeof form.get('githubUrl') === 'string' ? String(form.get('githubUrl')) : '';
      rawLinkedinUrl = typeof form.get('linkedinUrl') === 'string' ? String(form.get('linkedinUrl')) : '';
      rawReferralCode = typeof form.get('referralCode') === 'string' ? String(form.get('referralCode')) : '';
      const candidate = form.get('resume');
      if (candidate && typeof candidate === 'object' && 'arrayBuffer' in candidate) {
        resumeFile = candidate as File;
      }
    } else {
      const body = (await request.json()) as Record<string, unknown>;
      rawMessage = typeof body.message === 'string' ? body.message : '';
      rawGithubUrl = typeof body.githubUrl === 'string' ? body.githubUrl : '';
      rawLinkedinUrl = typeof body.linkedinUrl === 'string' ? body.linkedinUrl : '';
      rawReferralCode = typeof body.referralCode === 'string' ? body.referralCode : '';
    }
  } catch {
    // Empty or non-JSON body: treat as no optional fields.
  }

  const validation = validateApplicantInput({
    message: rawMessage,
    githubUrl: rawGithubUrl,
    linkedinUrl: rawLinkedinUrl,
  });

  const errors = [...validation.errors];
  if (
    project.joinMode === 'referral' &&
    project.referralCode &&
    !referralCodeMatches(project.referralCode, rawReferralCode)
  ) {
    errors.push('This project requires a valid referral code.');
  }
  if (project.requireGithubLink && !validation.data.githubUrl) {
    errors.push('This project requires a GitHub profile link.');
  }
  if (project.requireLinkedinLink && !validation.data.linkedinUrl) {
    errors.push('This project requires a LinkedIn profile link.');
  }
  if (project.requireResume && !resumeFile) {
    errors.push('This project requires a PDF resume.');
  }

  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  let savedResume: { storedName: string; fileName: string } | null = null;
  if (resumeFile) {
    try {
      savedResume = await saveResume(resumeFile);
    } catch (err: unknown) {
      if (err instanceof ResumeUploadError) {
        return NextResponse.json({ errors: [err.message] }, { status: 400 });
      }
      throw err;
    }
  }

  const accountAge = formatAccountAge(currentUser.createdAt);

  try {
    const applicant = await storage.createApplicant({
      projectId: project.id,
      userId: currentUser.id,
      userLogin: currentUser.login,
      userAvatar: currentUser.avatarUrl,
      accountAge,
      publicRepoCount: currentUser.publicRepos || 0,
      message: validation.data.message,
      githubUrl: validation.data.githubUrl,
      linkedinUrl: validation.data.linkedinUrl,
      resumeFileName: savedResume?.fileName,
      resumePath: savedResume?.storedName,
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
  } catch (err) {
    if (savedResume) await deleteResume(savedResume.storedName);
    throw err;
  }
}
