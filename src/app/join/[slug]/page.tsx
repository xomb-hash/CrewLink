import React from 'react';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { formatAccountAge } from '@/lib/validation';
import { normalizeReferralCode, referralCodeMatches } from '@/projects/referral';
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
  const project = await storage.getProjectBySlug(slug);
  if (!project) {
    notFound();
  }

  const providedCode = typeof ref === 'string' ? ref : '';
  const requiresReferralCode = project.joinMode === 'referral' && Boolean(project.referralCode);
  const codeIsValid = !requiresReferralCode || referralCodeMatches(project.referralCode, providedCode);
  const { referralCode: _referralCode, logoPath: _logoPath, ...publicProject } = project;

  const owner = await storage.getUser(project.ownerId);
  const creator = {
    login: project.ownerLogin,
    name: owner?.name,
    avatarUrl: owner?.avatarUrl || project.ownerAvatar,
    accountAge: owner?.createdAt ? formatAccountAge(owner.createdAt) : '',
    publicRepos: owner?.publicRepos ?? 0,
    note: project.creatorNote,
  };

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
        invitationSent: applicant.invitationSent,
      };
    }
  }

  return (
    <JoinClient
      project={{
        ...publicProject,
        githubUrl: project.isPrivate ? null : `https://github.com/${project.repoFullName}`,
        logoUrl: projectLogoUrl(project),
        requiresReferralCode,
      }}
      initialReferralCode={codeIsValid ? normalizeReferralCode(providedCode) : ''}
      referralCodeInvalid={Boolean(providedCode) && !codeIsValid}
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
