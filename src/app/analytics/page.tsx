import React from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { projectLogoUrl } from '@/projects/logo';
import { AnalyticsClient } from './AnalyticsClient';

export const metadata = {
  title: 'Analytics — Crewlink',
};

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/auth/github?redirect_to=/analytics');
  }

  const projects = await storage.getProjectsByOwner(user.login);

  return (
    <AnalyticsClient
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
