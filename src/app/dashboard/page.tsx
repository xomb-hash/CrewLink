import React from 'react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { generateShareLinks } from '@/projects/share';
import { projectLogoUrl } from '@/projects/logo';
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
        githubUrl: applicant.githubUrl,
        linkedinUrl: applicant.linkedinUrl,
        resumeFileName: applicant.resumeFileName,
        referralCode: applicant.referralCode,
        status: applicant.status,
        invitationSent: applicant.invitationSent,
        createdAt: applicant.createdAt,
        updatedAt: applicant.updatedAt,
      }));

      // Usage count = applications that arrived with the project's current
      // code. Regenerating the code naturally resets this to zero.
      const referralUsageCount =
        project.joinMode === 'referral' && project.referralCode
          ? rawApplicants.filter((applicant) => applicant.referralCode === project.referralCode)
              .length
          : 0;

      const { logoPath: _logoPath, ...publicProject } = project;
      return {
        ...publicProject,
        logoUrl: projectLogoUrl(project),
        shareLinks: generateShareLinks(project, undefined, referralUsageCount),
        applicants,
      };
    })
  );

  const applications = await storage.getApplicantsByUser(user.id);
  const joinedProjects = [];
  for (const application of applications) {
    const project = await storage.getProjectById(application.projectId);
    if (!project) continue;
    joinedProjects.push({
      id: project.id,
      slug: project.slug,
      title: project.title,
      description: project.description,
      logoUrl: projectLogoUrl(project),
      ownerLogin: project.ownerLogin,
      status: application.status,
      isPrivate: project.isPrivate,
    });
  }

  return (
    <DashboardClient
      initialProjects={projects}
      joinedProjects={joinedProjects}
      user={{ login: user.login, name: user.name, avatarUrl: user.avatarUrl }}
    />
  );
}
