import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { rateLimiter } from '@/lib/rateLimit';
import { notifyOwnerNewApplication } from '@/lib/notifications';
import { formatAccountAge, validateApplicantInput } from '@/lib/validation';
import { deleteResume, ResumeUploadError, saveResume } from '@/lib/uploads';
import { referralCodeMatches, normalizeReferralCode } from '@/projects/referral';
import { referralCodeErrorMessage, referralCodeState } from '@/projects/referralState';

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

  // --- 1. Require a signed-in applicant ---
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ error: 'Please sign in with GitHub to apply.' }, { status: 401 });
  }

  // --- 2. Resolve the project by slug or reusable code ---
  const { slug } = await params;
  const project = await storage.getProjectBySlugOrReferralCode(slug);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  // --- 3. Owners cannot apply to their own project ---
  if (project.ownerLogin.toLowerCase() === currentUser.login.toLowerCase()) {
    return NextResponse.json(
      { error: 'You are the owner of this project and cannot apply to it.' },
      { status: 400 }
    );
  }

  // --- 4. One application per user per project, even through the same link ---
  const existing = await storage.findApplicant(project.id, currentUser.id);
  if (existing) {
    return NextResponse.json(
      { error: 'You have already applied to this project.' },
      { status: 400 }
    );
  }

  // --- 5. Read JSON or multipart fields (multipart also carries the resume) ---
  let rawMessage = '';
  let rawGithubUrl = '';
  let rawLinkedinUrl = '';
  let rawProofUrl = '';
  let rawReferralCode = '';
  let resumeFile: File | null = null;

  const contentType = request.headers.get('content-type') || '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      rawMessage = typeof form.get('message') === 'string' ? String(form.get('message')) : '';
      rawGithubUrl = typeof form.get('githubUrl') === 'string' ? String(form.get('githubUrl')) : '';
      rawLinkedinUrl = typeof form.get('linkedinUrl') === 'string' ? String(form.get('linkedinUrl')) : '';
      rawProofUrl = typeof form.get('proofUrl') === 'string' ? String(form.get('proofUrl')) : '';
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
      rawProofUrl = typeof body.proofUrl === 'string' ? body.proofUrl : '';
      rawReferralCode = typeof body.referralCode === 'string' ? body.referralCode : '';
    }
  } catch {
    // Empty or non-JSON body: treat as no optional fields.
  }

  // --- 6. Validate free-text and profile-link fields ---
  const validation = validateApplicantInput({
    message: rawMessage,
    githubUrl: rawGithubUrl,
    linkedinUrl: rawLinkedinUrl,
    proofUrl: rawProofUrl,
  });

  // --- 7. Enforce referral state and code on the server, never only in the UI ---
  // --- Also counts usage so a reached limit closes the link ---
  const errors = [...validation.errors];
  const usageCount =
    project.joinMode === 'referral'
      ? await storage.countApplicantsByReferralCode(project.id, project.referralCode || '')
      : 0;
  const codeState = project.joinMode === 'referral' ? referralCodeState(project, usageCount) : 'active';
  const codeFromPath = referralCodeMatches(project.referralCode, slug)
    ? normalizeReferralCode(project.referralCode)
    : '';
  const suppliedCode = codeFromPath || normalizeReferralCode(rawReferralCode);
  if (project.joinMode === 'referral') {
    if (codeState !== 'active') {
      errors.push(referralCodeErrorMessage(codeState));
    } else if (!referralCodeMatches(project.referralCode, suppliedCode)) {
      errors.push('This referral code is not valid.');
    }
  }
  // --- 8. Enforce the credentials the owner marked as required ---
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

  // --- 9. Store the resume only after every check has passed ---
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

  // --- 10. Each use creates its own applicant record, tagged with the code used ---
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
      proofUrl: validation.data.proofUrl,
      resumeFileName: savedResume?.fileName,
      resumePath: savedResume?.storedName,
      referralCode: project.joinMode === 'referral' ? suppliedCode : undefined,
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
