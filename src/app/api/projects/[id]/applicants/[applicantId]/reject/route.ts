import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; applicantId: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
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
      { error: 'Access denied. Only the project owner can reject applicants.' },
      { status: 403 }
    );
  }

  const applicant = await storage.getApplicantById(applicantId);
  if (!applicant || applicant.projectId !== projectId) {
    return NextResponse.json({ error: 'Applicant not found.' }, { status: 404 });
  }

  const updated = await storage.updateApplicantStatus(applicant.id, 'rejected');

  return NextResponse.json({
    success: true,
    applicant: updated,
  });
}
