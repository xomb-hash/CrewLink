import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { storage } from '@/lib/storage';
import { logger } from '@/lib/logger';

function verifyWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const digest = `sha256=${hmac.digest('hex')}`;

  try {
    const signatureBuffer = Buffer.from(signatureHeader);
    const digestBuffer = Buffer.from(digest);
    if (signatureBuffer.length !== digestBuffer.length) return false;
    return crypto.timingSafeEqual(signatureBuffer, digestBuffer);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const signature = request.headers.get('x-hub-signature-256');
  const event = request.headers.get('x-github-event') || 'unknown';

  const rawBody = await request.text();

  // If secret is configured, enforce strict HMAC signature verification
  if (secret) {
    const isValid = verifyWebhookSignature(rawBody, signature, secret);
    if (!isValid) {
      logger.warn('GitHub webhook signature verification failed', { event });
      return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 401 });
    }
  }

  let payload: Record<string, any> = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  logger.info(`Received GitHub webhook: ${event}`, { action: payload.action });

  // Handle ping event
  if (event === 'ping') {
    return NextResponse.json({ message: 'pong', zen: payload.zen }, { status: 200 });
  }

  // Handle member added event (collaborator accepted invitation)
  if (event === 'member' && payload.action === 'added') {
    const repoFullName = payload.repository?.full_name;
    const memberLogin = payload.member?.login;
    const memberId = payload.member?.id;

    if (repoFullName && (memberLogin || memberId)) {
      const projects = await storage.listProjects();
      const project = projects.find(
        (p) => p.repoFullName.toLowerCase() === repoFullName.toLowerCase()
      );

      if (project) {
        let applicant = memberId ? await storage.findApplicant(project.id, memberId) : null;
        if (!applicant && memberLogin) {
          const applicants = await storage.getApplicantsByProject(project.id);
          applicant = applicants.find(
            (a) => a.userLogin.toLowerCase() === memberLogin.toLowerCase()
          ) || null;
        }

        if (applicant) {
          await storage.updateApplicantStatus(applicant.id, 'approved', {
            acceptedOnGitHubAt: new Date().toISOString(),
            githubEvent: 'member.added',
          });
          logger.info(`Applicant confirmed acceptance via GitHub webhook`, {
            applicantId: applicant.id,
            userLogin: applicant.userLogin,
            repo: repoFullName,
          });
        }
      }
    }
  }

  return NextResponse.json({ received: true, event }, { status: 200 });
}
