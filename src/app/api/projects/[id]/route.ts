import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { deleteLogo, deleteResume } from '@/lib/uploads';
import { generateShareLinks } from '@/projects/share';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const { id } = await params;
  const project = await storage.getProjectById(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  if (project.ownerLogin.toLowerCase() !== user.login.toLowerCase()) {
    return NextResponse.json(
      { error: 'Access denied. You are not the owner of this project.' },
      { status: 403 }
    );
  }

  const rawApplicants = await storage.getApplicantsByProject(project.id);
  const applicants = rawApplicants.map((applicant) => ({
    id: applicant.id,
    userLogin: applicant.userLogin,
    userAvatar: applicant.userAvatar,
    accountAge: applicant.accountAge,
    publicRepoCount: applicant.publicRepoCount,
    message: applicant.message,
    status: applicant.status,
    invitationSent: applicant.invitationSent,
    createdAt: applicant.createdAt,
  }));

  // Usage count drives the join URL: a code at its limit falls back to the
  // permanent slug URL in generateShareLinks.
  const referralUsageCount =
    project.joinMode === 'referral' && project.referralCode
      ? rawApplicants.filter((applicant) => applicant.referralCode === project.referralCode).length
      : 0;

  return NextResponse.json({
    project: {
      ...project,
      shareLinks: generateShareLinks(project, undefined, referralUsageCount),
      referralUsageCount,
      applicants,
    },
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const { id } = await params;
  const project = await storage.getProjectById(id);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  const isOwner =
    project.ownerLogin.toLowerCase() === user.login.toLowerCase() ||
    String(project.ownerId) === String(user.id);
  if (!isOwner) {
    return NextResponse.json({ error: 'Only the project owner can delete this project.' }, { status: 403 });
  }

  const applicants = await storage.getApplicantsByProject(project.id);
  await storage.deleteProject(project.id);

  await Promise.all([
    deleteLogo(project.logoPath),
    ...applicants.map((applicant) => deleteResume(applicant.resumePath)),
  ]);

  return NextResponse.json({ success: true });
}
