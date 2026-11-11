import React from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { projectLogoUrl } from '@/projects/logo';
import { AiWorkspaceClient } from './AiWorkspaceClient';

export const metadata = {
  title: 'AI Studio — Crewlink',
};

export default async function AiPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/auth/github?redirect_to=/ai');
  }

  const projects = await storage.getProjectsByOwner(user.login);

  return (
    <AiWorkspaceClient
      projects={projects.map((project) => ({
        id: project.id,
        title: project.title,
        slug: project.slug,
        repoFullName: project.repoFullName,
        isPrivate: project.isPrivate,
        logoUrl: projectLogoUrl(project),
      }))}
    />
  );
}
