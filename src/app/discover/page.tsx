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

  const projects: DiscoverProject[] = await Promise.all(
    allProjects
      .filter((project) => !project.isPrivate)
      .filter(
        (project) =>
          !user || project.ownerLogin.toLowerCase() !== user.login.toLowerCase()
      )
      .map(async (project) => {
        let applicantsCount = 0;
        try {
          applicantsCount = (await storage.getApplicantsByProject(project.id)).length;
        } catch {
          applicantsCount = 0;
        }

        return {
          id: project.id,
          slug: project.slug,
          title: project.title,
          description: project.description || '',
          ownerLogin: project.ownerLogin,
          ownerAvatar: project.ownerAvatar || '',
          repoFullName: project.repoFullName,
          isPrivate: project.isPrivate,
          joinMode: project.joinMode,
          roles: project.roles || [],
          logoUrl: projectLogoUrl(project),
          requiresCode: project.joinMode === 'referral',
          appliedStatus: appliedStatus.get(project.id) ?? null,
          applicantsCount,
          createdAt: project.createdAt,
        };
      })
  );

  return <DiscoverClient projects={projects} />;
}
