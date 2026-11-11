import React from 'react';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { formatAccountAge } from '@/lib/validation';
import { normalizeReferralCode, referralCodeMatches } from '@/projects/referral';
import { referralCodeErrorMessage, referralCodeState } from '@/projects/referralState';
import { projectLogoUrl } from '@/projects/logo';
import { JoinClient } from './JoinClient';

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const { slug } = await params;
  const { ref } = await searchParams;

  // Resolve the project from either a referral code in the path (/join/CREW-XXXXX)
  // or a legacy slug (/join/<slug>?ref=CODE).
  const project = await storage.getProjectBySlugOrReferralCode(slug);
  if (!project) {
    notFound();
  }

  // Work out whether the shared referral code is usable: it must be active
  // (not expired, revoked or at its usage limit) and must match the code the
  // visitor actually arrived with, either in the path or the ?ref= query.
  const providedCode = typeof ref === 'string' ? ref : '';
  const requiresReferralCode = project.joinMode === 'referral';
  const usageCount = requiresReferralCode
    ? await storage.countApplicantsByReferralCode(project.id, project.referralCode || '')
    : 0;
  const codeState = requiresReferralCode ? referralCodeState(project, usageCount) : 'active';
  const codeInPath = referralCodeMatches(project.referralCode, slug);
  const codeInQuery = referralCodeMatches(project.referralCode, providedCode);
  const attemptedCode = codeInPath || Boolean(providedCode);
  const codeIsValid =
    !requiresReferralCode || (codeState === 'active' && (codeInPath || codeInQuery));

  // Explain a bad code in the UI instead of silently showing the form; the
  // apply endpoint re-checks everything server side.
  let referralCodeError = '';
  if (requiresReferralCode && attemptedCode && !codeIsValid) {
    referralCodeError =
      codeState === 'active'
        ? 'This referral code is not valid. Check the link the creator shared.'
        : referralCodeErrorMessage(codeState);
  }

  // Strip every referral field before sending the project to the client so a
  // visitor never receives a code they did not arrive with.
  const {
    referralCode: _referralCode,
    referralCodeCreatedAt: _referralCodeCreatedAt,
    referralCodeExpiresAt: _referralCodeExpiresAt,
    referralCodeUsageLimit: _referralCodeUsageLimit,
    referralCodeRevokedAt: _referralCodeRevokedAt,
    referralCodeUsedAt: _referralCodeUsedAt,
    logoPath: _logoPath,
    ...publicProject
  } = project;

  // Creator card details come from the owner account plus the project's note.
  const owner = await storage.getUser(project.ownerId);
  const creator = {
    login: project.ownerLogin,
    name: owner?.name,
    avatarUrl: owner?.avatarUrl || project.ownerAvatar,
    accountAge: owner?.createdAt ? formatAccountAge(owner.createdAt) : '',
    publicRepos: owner?.publicRepos ?? 0,
    note: project.creatorNote,
  };

  // Signed-in visitors get their existing application (if any) so the form can
  // show the pending state; the owner is flagged so they cannot apply to their
  // own project.
  const currentUser = await getCurrentUser();
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

  return (
    <JoinClient
      // Public project only: githubUrl is hidden for private repos, and the
      // referral code is prefilled only when this visitor presented a valid one.
      project={{
        ...publicProject,
        githubUrl: project.isPrivate ? null : `https://github.com/${project.repoFullName}`,
        logoUrl: projectLogoUrl(project),
        requiresReferralCode,
      }}
      initialReferralCode={codeIsValid ? normalizeReferralCode(project.referralCode) : ''}
      referralCodeError={referralCodeError}
      creator={creator}
      currentUser={
        currentUser
          ? {
              id: currentUser.id,
              login: currentUser.login,
              name: currentUser.name,
              avatarUrl: currentUser.avatarUrl,
            }
          : null
      }
      isOwner={isOwner}
      existingApplication={existingApplication}
    />
  );
}
