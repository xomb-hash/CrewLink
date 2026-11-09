import { logger } from './logger';
import type { Project, Applicant } from '../types/index';

export interface NotificationPayload {
  type: 'applicant_applied' | 'applicant_approved' | 'applicant_rejected';
  project: {
    id: string;
    slug: string;
    title: string;
    repoFullName: string;
    ownerLogin: string;
  };
  applicant: {
    id: string;
    userLogin: string;
    userId: string;
    accountAge: string;
    publicRepoCount: number;
    message?: string;
  };
  timestamp: string;
}

export async function sendNotification(payload: NotificationPayload): Promise<boolean> {
  logger.info(`Notification dispatched: ${payload.type}`, {
    type: payload.type,
    projectId: payload.project.id,
    applicantId: payload.applicant.id,
    owner: payload.project.ownerLogin,
    applicant: payload.applicant.userLogin,
  });

  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch (err) {
      logger.error('Failed to send webhook notification', err, { webhookUrl });
      return false;
    }
  }

  return true;
}

export async function notifyOwnerNewApplication(
  project: Project,
  applicant: Applicant
): Promise<boolean> {
  return sendNotification({
    type: 'applicant_applied',
    project: {
      id: project.id,
      slug: project.slug,
      title: project.title,
      repoFullName: project.repoFullName,
      ownerLogin: project.ownerLogin,
    },
    applicant: {
      id: applicant.id,
      userLogin: applicant.userLogin,
      userId: applicant.userId,
      accountAge: applicant.accountAge,
      publicRepoCount: applicant.publicRepoCount,
      message: applicant.message,
    },
    timestamp: new Date().toISOString(),
  });
}

export async function notifyApplicantApproved(
  project: Project,
  applicant: Applicant
): Promise<boolean> {
  return sendNotification({
    type: 'applicant_approved',
    project: {
      id: project.id,
      slug: project.slug,
      title: project.title,
      repoFullName: project.repoFullName,
      ownerLogin: project.ownerLogin,
    },
    applicant: {
      id: applicant.id,
      userLogin: applicant.userLogin,
      userId: applicant.userId,
      accountAge: applicant.accountAge,
      publicRepoCount: applicant.publicRepoCount,
    },
    timestamp: new Date().toISOString(),
  });
}

export async function notifyApplicantRejected(
  project: Project,
  applicant: Applicant
): Promise<boolean> {
  return sendNotification({
    type: 'applicant_rejected',
    project: {
      id: project.id,
      slug: project.slug,
      title: project.title,
      repoFullName: project.repoFullName,
      ownerLogin: project.ownerLogin,
    },
    applicant: {
      id: applicant.id,
      userLogin: applicant.userLogin,
      userId: applicant.userId,
      accountAge: applicant.accountAge,
      publicRepoCount: applicant.publicRepoCount,
    },
    timestamp: new Date().toISOString(),
  });
}
