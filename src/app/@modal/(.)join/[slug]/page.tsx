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
    joinUrl: generateShareLinks(project).joinUrl,
    roles: project.roles,
    screeningUrl: project.screeningUrl,
  };

  return <JoinModalClient project={modalProject} />;
}
