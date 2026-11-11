import React from 'react';
import { notFound } from 'next/navigation';
import { storage } from '@/lib/storage';
import { generateShareLinks } from '@/projects/share';
import type { ProjectModalData } from '@/components/ProjectDetailsModal';
import { JoinModalClient } from './ModalClient';

export const dynamic = 'force-dynamic';

export default async function JoinModalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await storage.getProjectBySlug(slug);
  if (!project) {
    notFound();
  }

  const applicants = await storage.getApplicantsByProject(project.id);
  const owner = await storage.getUser(project.ownerId);
  // The modal shows a public join URL only: if the reusable code is at its
  // limit, generateShareLinks falls back to this project's slug URL. The code
  // itself is never rendered here.
  const referralUsageCount =
    project.joinMode === 'referral' && project.referralCode
      ? applicants.filter((applicant) => applicant.referralCode === project.referralCode).length
      : 0;

  const modalProject: ProjectModalData = {
    slug: project.slug,
    title: project.title,
    repoFullName: project.repoFullName,
    isPrivate: project.isPrivate,
    joinMode: project.joinMode,
    description: project.description,
    ownerLogin: project.ownerLogin,
    ownerAvatar: owner?.avatarUrl || project.ownerAvatar,
    applicantsCount: applicants.length,
    createdAt: project.createdAt,
    joinUrl: generateShareLinks(project, undefined, referralUsageCount).joinUrl,
    roles: project.roles,
    screeningUrl: project.screeningUrl,
  };

  return <JoinModalClient project={modalProject} />;
}
