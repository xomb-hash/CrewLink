import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const project = await storage.getProjectBySlug(slug);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

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
        invitationSent: applicant.invitationSent,
      };
    }
  }

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
