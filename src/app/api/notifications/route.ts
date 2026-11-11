import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';

interface NotificationItem {
  id: string;
  kind: 'join_request' | 'application_status';
  title: string;
  detail?: string;
  href: string;
  createdAt: string;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Please sign in with GitHub.' }, { status: 401 });
  }

  const notifications: NotificationItem[] = [];
  let pendingCount = 0;

  const ownedProjects = await storage.getProjectsByOwner(user.login);
  for (const project of ownedProjects) {
    const applicants = await storage.getApplicantsByProject(project.id);
    for (const applicant of applicants) {
      if (applicant.status !== 'pending') continue;
      pendingCount += 1;
      notifications.push({
        id: `request-${applicant.id}`,
        kind: 'join_request',
        title: `@${applicant.userLogin} requested to join`,
        detail: project.title,
        href: '/dashboard',
        createdAt: applicant.createdAt,
      });
    }
  }

  const applications = await storage.getApplicantsByUser(user.id);
  for (const application of applications) {
    if (application.status === 'pending') continue;
    const project = await storage.getProjectById(application.projectId);
    if (!project) continue;
    const approved = application.status === 'approved';
    notifications.push({
      id: `status-${application.id}`,
      kind: 'application_status',
      title: approved
        ? `You were approved for ${project.title}`
        : `Your request to ${project.title} was declined`,
      detail: approved
        ? project.isPrivate
          ? 'You are a contributor. This repository is private, so its code stays with the owner.'
          : 'You are a contributor. Fork the repo and open a pull request.'
        : 'The creator reviewed your request.',
      href: `/join/${project.slug}`,
      createdAt: application.updatedAt,
    });
  }

  notifications.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return NextResponse.json({
    notifications: notifications.slice(0, 12),
    pendingCount,
  });
}
