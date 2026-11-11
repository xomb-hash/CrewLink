import React from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { projectLogoUrl } from '@/projects/logo';
import { PublishingClient } from './PublishingClient';

export default async function PublishingPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/auth/github?redirect_to=/publishing');
  }

  const projects = await storage.getProjectsByOwner(user.login);

  return (
    <PublishingClient
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
