import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { generateShareLinks } from '@/projects/share';
import { referralCodeExpiresAt } from '@/projects/referralState';
import { generateReferralCode } from '@/projects/referral';

export async function POST(
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
    return NextResponse.json({ error: 'Only the project owner can generate referral codes.' }, { status: 403 });
  }

  if (project.joinMode !== 'referral') {
    return NextResponse.json(
      { error: 'Referral codes are only available for referral projects.' },
      { status: 400 }
    );
  }

  const referralCode = generateReferralCode();
  const updated = await storage.updateProjectReferralCode(project.id, referralCode);
  if (!updated) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  return NextResponse.json({
    referralCode,
    referralCodeCreatedAt: updated.referralCodeCreatedAt,
    expiresAt: referralCodeExpiresAt(updated),
    shareLinks: generateShareLinks(updated),
  });
}
