import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { projectLogoUrl } from '@/projects/logo';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Same lookup as the join page: slug or referral code in the path.
  const project = await storage.getProjectBySlugOrReferralCode(slug);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  // Optional session so the response can include the visitor's own application
  // and whether they own the project. Anonymous requests still work.
  const currentUser = await getCurrentUser(request);
  let existingApplication = null;
  let isOwner = false;

  if (currentUser) {
    isOwner = project.ownerLogin.toLowerCase() === currentUser.login.toLowerCase();
    const applicant = await storage.findApplicant(project.id, currentUser.id);
    if (applicant) {
      existingApplication = {
        id: applicant.id,
        status: applicant.status,
        createdAt: applicant.createdAt,
      };
    }
  }

  // Explicit public projection: referral code, expiry, limit and usage are
  // never included here, so the API cannot leak a working invite.
  return NextResponse.json({
    project: {
      id: project.id,
      slug: project.slug,
      title: project.title,
      description: project.description,
      repoFullName: project.repoFullName,
      repoName: project.repoName,
      repoOwner: project.repoOwner,
      isPrivate: project.isPrivate,
      joinMode: project.joinMode,
      screeningUrl: project.screeningUrl,
      ownerLogin: project.ownerLogin,
      ownerAvatar: project.ownerAvatar,
      roles: project.roles,
      creatorNote: project.creatorNote,
      requireResume: Boolean(project.requireResume),
      requireGithubLink: Boolean(project.requireGithubLink),
      requireLinkedinLink: Boolean(project.requireLinkedinLink),
      requiresReferralCode: project.joinMode === 'referral',
      logoUrl: projectLogoUrl(project),
      githubUrl: project.isPrivate ? null : `https://github.com/${project.repoFullName}`,
    },
    currentUser: currentUser
      ? {
          id: currentUser.id,
          login: currentUser.login,
          avatarUrl: currentUser.avatarUrl,
        }
      : null,
    isOwner,
    existingApplication,
  });
}
