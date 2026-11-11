import crypto from 'node:crypto';
import { config } from '../../config/index';
import { storage } from '../../lib/storage';
import { checkDraft } from '../checks';
import { PublishError } from '../publish';
import { WHATSAPP_SHARE_ORIGIN, whatsAppShareUrl } from './url';
import type { Draft, Publication } from '../../types/index';

// WhatsApp has no official publishing API for personal accounts. Crewlink only
// prepares a click-to-chat link: the owner copies the message, opens WhatsApp,
// picks a recipient and sends it themselves. Nothing is transmitted to WhatsApp
// to build the link, and no state below claims that a message was delivered.
export { WHATSAPP_SHARE_ORIGIN };

export function buildWhatsAppShareUrl(text: string): string {
  const url = whatsAppShareUrl(text);
  if (!url) {
    throw new PublishError('The WhatsApp message is empty.', 'invalid_post');
  }
  return url;
}

const hashText = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

async function requireOwnedWhatsAppDraft(
  userId: string,
  draftId: string
): Promise<{ draft: Draft; project: Awaited<ReturnType<typeof storage.getProjectById>> }> {
  const id = String(draftId || '').trim();
  if (!id) throw new PublishError('Choose a draft to prepare.', 'invalid_input');

  const draft = await storage.getDraftById(id);
  if (!draft) throw new PublishError('Draft not found.', 'draft_not_found');
  if (draft.platformId !== 'whatsapp') {
    throw new PublishError(
      'This action is only for WhatsApp drafts.',
      'unsupported_platform'
    );
  }

  const project = await storage.getProjectById(draft.projectId);
  if (!project) throw new PublishError('Project not found.', 'project_not_found');
  if (project.ownerId !== userId) {
    throw new PublishError(
      'Only the project owner can prepare this draft.',
      'forbidden'
    );
  }
  return { draft, project };
}

// The approved text and its hash must still match at every manual step, so a
// draft edited after approval can never be shared in a different form.
function requireCurrentApproval(draft: Draft): string {
  if (draft.status !== 'approved' || !draft.approvedText || !draft.approvedAt) {
    throw new PublishError(
      'Approve this draft before sharing it.',
      'draft_not_approved'
    );
  }
  const contentHash = hashText(draft.text);
  if (draft.approvedText !== draft.text || draft.approvedHash !== contentHash) {
    throw new PublishError(
      'The draft changed after approval. Approve it again.',
      'draft_changed'
    );
  }
  return contentHash;
}

async function runComposerChecks(
  project: NonNullable<Awaited<ReturnType<typeof storage.getProjectById>>>,
  draft: Draft
): Promise<void> {
  const allDrafts = await storage.getDraftsByProject(project.id);
  const approvedDrafts = allDrafts
    .filter(
      (candidate) =>
        candidate.status === 'approved' &&
        candidate.id !== draft.id &&
        candidate.approvedText &&
        candidate.approvedAt
    )
    .map((candidate) => ({
      platformId: candidate.platformId,
      approvedText: candidate.approvedText!,
      approvedAt: candidate.approvedAt!,
    }));

  const checks = checkDraft(
    {
      ownerName: project.repoOwner,
      repoName: project.repoName,
      repoFullName: project.repoFullName,
      isPrivate: project.isPrivate,
      joinUrl: `${config.appUrl.replace(/\/+$/, '')}/join/${project.slug}`,
      roles: project.roles,
      description: project.description,
      approvedDrafts,
    },
    'whatsapp',
    draft.text
  );
  const error = checks.find((check) => check.level === 'error');
  if (error) {
    throw new PublishError(error.message, 'invalid_post');
  }
}

export interface WhatsAppShareResult {
  publication: Publication;
  shareUrl: string;
  // Crewlink never observed a WhatsApp send, so this is always false.
  verified: false;
}

// --- Prepare: validate, record the intent, and return a local share link ---
export async function prepareWhatsAppShare(input: {
  userId: string;
  draftId: string;
}): Promise<WhatsAppShareResult> {
  const { draft, project } = await requireOwnedWhatsAppDraft(
    input.userId,
    input.draftId
  );
  if (!project) throw new PublishError('Project not found.', 'project_not_found');

  const contentHash = requireCurrentApproval(draft);
  await runComposerChecks(project, draft);

  const shareUrl = buildWhatsAppShareUrl(draft.text);
  const existing = await storage.getPublication(draft.id, 'whatsapp');

  if (existing) {
    if (existing.status === 'published' || existing.externalId) {
      throw new PublishError(
        'This draft has already been marked as shared.',
        'already_published'
      );
    }
    if (existing.status === 'prepared' || existing.status === 'opened') {
      if (existing.contentHash === contentHash) {
        return { publication: existing, shareUrl, verified: false };
      }
      // Re-approving an edited draft resets the manual record to prepared.
      const reset = await storage.transitionPublication(
        existing.id,
        ['prepared', 'opened'],
        { status: 'prepared', mode: 'manual', contentHash }
      );
      if (reset) return { publication: reset, shareUrl, verified: false };
    }
    throw new PublishError(
      'The sharing record is in an unexpected state.',
      'send_failed'
    );
  }

  const now = new Date().toISOString();
  const claim = await storage.createPublicationIfAbsent({
    id: `pub_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    userId: input.userId,
    projectId: project.id,
    draftId: draft.id,
    connectionId: undefined,
    platformId: 'whatsapp',
    status: 'prepared',
    mode: 'manual',
    contentHash,
    externalIds: [],
    targetName: 'WhatsApp',
    createdAt: now,
    updatedAt: now,
  });
  if (claim.created) {
    return { publication: claim.publication, shareUrl, verified: false };
  }
  // A concurrent prepare won the insert. Reuse it if it is still shareable.
  const latest = claim.publication;
  if (latest.status === 'published' || latest.externalId) {
    throw new PublishError(
      'This draft has already been marked as shared.',
      'already_published'
    );
  }
  if (latest.status === 'prepared' || latest.status === 'opened') {
    return { publication: latest, shareUrl, verified: false };
  }
  throw new PublishError(
    'The sharing record could not be created.',
    'send_failed'
  );
}

// --- The owner opened WhatsApp; Crewlink still did not send anything ---
export async function markWhatsAppOpened(input: {
  userId: string;
  draftId: string;
}): Promise<{ publication: Publication; verified: false }> {
  const { draft } = await requireOwnedWhatsAppDraft(input.userId, input.draftId);
  requireCurrentApproval(draft);

  const existing = await storage.getPublication(draft.id, 'whatsapp');
  if (!existing) {
    throw new PublishError(
      'Prepare the message before opening WhatsApp.',
      'invalid_input'
    );
  }
  if (existing.status === 'published' || existing.externalId) {
    throw new PublishError(
      'This draft has already been marked as shared.',
      'already_published'
    );
  }
  if (existing.status === 'opened') {
    return { publication: existing, verified: false };
  }

  const opened = await storage.transitionPublication(existing.id, ['prepared'], {
    status: 'opened',
  });
  if (opened) return { publication: opened, verified: false };

  const latest = await storage.getPublication(draft.id, 'whatsapp');
  if (latest?.status === 'opened') {
    return { publication: latest, verified: false };
  }
  if (latest?.status === 'published' || latest?.externalId) {
    throw new PublishError(
      'This draft has already been marked as shared.',
      'already_published'
    );
  }
  throw new PublishError(
    'The sharing record could not be updated.',
    'send_failed'
  );
}

// --- The owner says they shared it by hand. Not verified, not delivered. ---
export async function markWhatsAppShared(input: {
  userId: string;
  draftId: string;
}): Promise<{ publication: Publication; verified: false }> {
  const { draft } = await requireOwnedWhatsAppDraft(input.userId, input.draftId);
  requireCurrentApproval(draft);

  const existing = await storage.getPublication(draft.id, 'whatsapp');
  if (!existing) {
    throw new PublishError(
      'Prepare the message before marking it shared.',
      'invalid_input'
    );
  }
  if (existing.status === 'published' || existing.externalId) {
    throw new PublishError(
      'This draft has already been marked as shared.',
      'already_published'
    );
  }

  const shared = await storage.transitionPublication(
    existing.id,
    ['prepared', 'opened'],
    {
      status: 'published',
      mode: 'manual',
      confirmedAt: new Date().toISOString(),
      externalIds: [],
    }
  );
  if (shared) return { publication: shared, verified: false };

  const latest = await storage.getPublication(draft.id, 'whatsapp');
  if (latest?.status === 'published' || latest?.externalId) {
    throw new PublishError(
      'This draft has already been marked as shared.',
      'already_published'
    );
  }
  throw new PublishError(
    'The sharing record could not be updated.',
    'send_failed'
  );
}

export default {
  WHATSAPP_SHARE_ORIGIN,
  buildWhatsAppShareUrl,
  prepareWhatsAppShare,
  markWhatsAppOpened,
  markWhatsAppShared,
};
