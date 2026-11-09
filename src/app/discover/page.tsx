import React from 'react';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { projectLogoUrl } from '@/projects/logo';
import { DiscoverClient, type DiscoverProject } from './DiscoverClient';

export default async function DiscoverPage() {
  const user = await getCurrentUser();
  const allProjects = await storage.listProjects();

  const appliedStatus = new Map<string, DiscoverProject['appliedStatus']>();
  if (user) {
    const applications = await storage.getApplicantsByUser(user.id);
    for (const application of applications) {
      appliedStatus.set(application.projectId, application.status);
    }
  }

  const projects: DiscoverProject[] = allProjects
    .filter((project) => !project.isPrivate)
    .filter(
      (project) =>
        !user || project.ownerLogin.toLowerCase() !== user.login.toLowerCase()
    )
    .map((project) => ({
      id: project.id,
      slug: project.slug,
      title: project.title,
      description: project.description || '',
      ownerLogin: project.ownerLogin,
      joinMode: project.joinMode,
      roles: project.roles || [],
      logoUrl: projectLogoUrl(project),
      requiresCode: project.joinMode === 'referral' && Boolean(project.referralCode),
      appliedStatus: appliedStatus.get(project.id) ?? null,
    }));

  return <DiscoverClient projects={projects} />;
}
