import React from 'react';
import { storage } from '@/lib/storage';
import { config } from '@/config/index';
import { getCurrentUser } from '@/lib/auth';
import { ExploreClient } from './ExploreClient';
import type { ExploreProject } from '@/types/index';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Explore Projects | Crewlink',
  description: 'Browse open projects looking for collaborators on GitHub.',
};

export default async function ExplorePage() {
  const user = await getCurrentUser();
  let initialProjects: ExploreProject[] = [];

  try {
    const allProjects = (await storage.listProjects()).filter((project) => !project.isPrivate);
    initialProjects = await Promise.all(
      allProjects.map(async (project) => {
        try {
          const applicants = await storage.getApplicantsByProject(project.id);
          return {
            ...project,
            applicantsCount: applicants.length,
            joinUrl: `${config.appUrl}/join/${project.slug}`,
          };
        } catch {
          return {
            ...project,
            applicantsCount: 0,
            joinUrl: `${config.appUrl}/join/${project.slug}`,
          };
        }
      })
    );
  } catch {
    initialProjects = [];
  }

  return <ExploreClient initialProjects={initialProjects} currentUser={user} />;
}
