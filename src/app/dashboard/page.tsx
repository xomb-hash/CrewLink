import React from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { generateShareLinks } from '@/projects/share';
import { DashboardClient } from './DashboardClient';

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/auth/github?redirect_to=/dashboard');
  }

  const rawProjects = await storage.getProjectsByOwner(user.login);

  const projects = await Promise.all(
    rawProjects.map(async (project) => {
      const rawApplicants = await storage.getApplicantsByProject(project.id);
      const applicants = rawApplicants.map((applicant) => ({
        id: applicant.id,
        projectId: applicant.projectId,
        userId: applicant.userId,
        userLogin: applicant.userLogin,
        userAvatar: applicant.userAvatar,
        accountAge: applicant.accountAge,
        publicRepoCount: applicant.publicRepoCount,
        message: applicant.message,
        status: applicant.status,
        invitationSent: applicant.invitationSent,
        createdAt: applicant.createdAt,
        updatedAt: applicant.updatedAt,
      }));

      return {
        ...project,
        shareLinks: generateShareLinks(project),
        applicants,
      };
    })
  );

  return <DashboardClient initialProjects={projects} />;
}
