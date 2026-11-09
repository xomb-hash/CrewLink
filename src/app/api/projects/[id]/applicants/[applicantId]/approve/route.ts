import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { getGitHubClient } from '@/github/index';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; applicantId: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user || !user.accessToken) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const { id: projectId, applicantId } = await params;
  const project = await storage.getProjectById(projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  // Server-side owner check
  if (project.ownerLogin.toLowerCase() !== user.login.toLowerCase()) {
    return NextResponse.json(
      { error: 'Access denied. Only the project owner can approve applicants.' },
      { status: 403 }
    );
  }

  const applicant = await storage.getApplicantById(applicantId);
  if (!applicant || applicant.projectId !== projectId) {
    return NextResponse.json({ error: 'Applicant not found.' }, { status: 404 });
  }

  if (applicant.status === 'approved') {
    return NextResponse.json({
      message: 'Applicant is already approved.',
      applicant,
    });
  }

  try {
    const client = getGitHubClient();
    const [owner, repo] = project.repoFullName.split('/');

    const invitation = await client.inviteCollaborator({
      accessToken: user.accessToken,
      owner,
      repo,
      username: applicant.userLogin,
    });

    const updated = await storage.updateApplicantStatus(applicant.id, 'approved', invitation);

    return NextResponse.json({
      success: true,
      applicant: updated,
      invitation,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Failed to send collaborator invitation:', msg);
    return NextResponse.json(
      {
        error: `GitHub invitation could not be sent: ${msg}. Please verify repository admin permissions.`,
      },
      { status: 502 }
    );
  }
}
