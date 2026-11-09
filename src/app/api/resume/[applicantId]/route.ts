import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { readResume, resumeDownloadName } from '@/lib/uploads';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ applicantId: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in to view this resume.' }, { status: 401 });
  }

  const { applicantId } = await params;
  const applicant = await storage.getApplicantById(applicantId);
  if (!applicant?.resumePath || !applicant.resumeFileName) {
    return NextResponse.json({ error: 'Resume not found.' }, { status: 404 });
  }

  const project = await storage.getProjectById(applicant.projectId);
  if (!project) {
    return NextResponse.json({ error: 'Resume not found.' }, { status: 404 });
  }

  const isOwner = project.ownerLogin.toLowerCase() === user.login.toLowerCase();
  const isApplicant = String(applicant.userId) === String(user.id);
  if (!isOwner && !isApplicant) {
    return NextResponse.json({ error: 'You are not allowed to view this resume.' }, { status: 403 });
  }

  const buffer = await readResume(applicant.resumePath);
  if (!buffer) {
    return NextResponse.json({ error: 'Resume file is missing.' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${resumeDownloadName(applicant.resumeFileName)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
