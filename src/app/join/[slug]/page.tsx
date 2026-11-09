import React from 'react';
import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { JoinClient } from './JoinClient';

export default async function JoinPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await storage.getProjectBySlug(slug);
  if (!project) {
    notFound();
  }

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
        ...project,
        githubUrl: project.isPrivate ? null : `https://github.com/${project.repoFullName}`,
      }}
      currentUser={currentUser}
      isOwner={isOwner}
      existingApplication={existingApplication}
    />
  );
}
