import type { Draft, Publication } from '../types/index';

// A `sending` row older than this almost certainly means the process stopped
// mid-send. It is never retried automatically; the owner must check the channel.
export const STALE_SENDING_MS = 15 * 60 * 1000;

export type PublicationStateKind =
  | 'needs_approval'
  | 'ready'
  | 'sending'
  | 'published'
  | 'failed'
  | 'uncertain'
  // Manual sharing: prepared and opened are deliberately not "sent".
  | 'prepared'
  | 'opened';

// UI-facing derivation of the publication row. `uncertain` is never written to
// storage: it is a stale `sending` row, which must never be resent automatically.
export interface PublicationState {
  kind: PublicationStateKind;
  label: string;
  detail?: string;
  canPublish: boolean;
  canRetry: boolean;
}

const FAILURE_DETAILS: Record<string, string> = {
  bot_token_missing: 'The Crewlink bot is not configured for this platform.',
  bot_unauthorized: 'The Crewlink bot credentials were rejected.',
  bot_not_member: 'The Crewlink bot is no longer a member of this channel.',
  missing_permissions: 'The Crewlink bot no longer has permission to post here.',
  chat_not_found: 'The channel could not be found.',
  unsupported_channel: 'This channel type cannot receive posts.',
  rate_limited: 'The platform rate-limited the request. Try again later.',
  transport_error: 'The platform could not be reached.',
  auth_revoked: 'The connected account no longer authorises Crewlink. Reconnect it.',
  validation_error: 'The platform rejected the post text. Edit it and approve it again.',
  instance_error: 'The platform returned an unexpected error.',
  connection_inactive: 'The account connection is not active. Reconnect it.',
  partial_thread: 'The thread stopped partway. Check X and finish it by hand.',
  cost_ledger_error: 'The cost record could not be written, so nothing was sent.',
  slack_not_in_channel:
    'The Crewlink bot is not a member of this Slack channel. Invite it in Slack, then try again.',
  slack_channel_not_found:
    'Slack could not find this channel. It may have been deleted; choose the channel again.',
  slack_channel_archived: 'This Slack channel is archived and cannot receive messages.',
  slack_restricted_action:
    'A Slack workspace policy prevents the Crewlink app from posting here.',
  slack_missing_scope:
    'The Crewlink Slack app is missing a required permission. Reinstall it with the documented scopes.',
};

function failureDetail(errorCode?: string): string {
  return (errorCode && FAILURE_DETAILS[errorCode]) || 'The platform rejected the message.';
}

const approved = (draft: Pick<Draft, 'status' | 'approvedText' | 'approvedAt'>): boolean =>
  draft.status === 'approved' && Boolean(draft.approvedText) && Boolean(draft.approvedAt);

export function publicationStateFor(
  draft: Pick<Draft, 'status' | 'approvedText' | 'approvedAt'>,
  publication: Publication | null,
  now: number = Date.now()
): PublicationState {
  if (publication) {
    if (publication.status === 'prepared' || publication.status === 'opened') {
      const opened = publication.status === 'opened';
      return {
        kind: opened ? 'opened' : 'prepared',
        label: opened ? 'Opened in WhatsApp' : 'Prepared — not sent',
        detail: opened
          ? 'WhatsApp was opened. Crewlink did not send the message and cannot confirm delivery.'
          : 'Copy the message or open WhatsApp to share it yourself. Nothing has been sent yet.',
        canPublish: false,
        canRetry: false,
      };
    }

    if (publication.status === 'published' || publication.externalId) {
      if (publication.mode === 'manual') {
        const whatsapp = publication.platformId === 'whatsapp';
        return {
          kind: 'published',
          label: whatsapp ? 'Marked shared manually' : 'Marked published manually',
          detail: whatsapp
            ? 'You marked this as shared by hand. Crewlink did not send or deliver it through WhatsApp.'
            : 'You marked this as published by hand. Crewlink did not verify it on X.',
          canPublish: false,
          canRetry: false,
        };
      }
      return {
        kind: 'published',
        label: 'Published',
        detail: 'The platform confirmed this post and returned its id.',
        canPublish: false,
        canRetry: false,
      };
    }

    if (publication.status === 'failed' && (publication.externalIds?.length ?? 0) > 0) {
      return {
        kind: 'failed',
        label: 'Partial thread — check X',
        detail:
          'Some posts were published before the thread stopped. Crewlink will not restart it; finish the remaining posts by hand.',
        canPublish: false,
        canRetry: false,
      };
    }

    if (publication.status === 'sending') {
      const updatedAt = new Date(publication.updatedAt).getTime();
      if (Number.isFinite(updatedAt) && now - updatedAt > STALE_SENDING_MS) {
        return {
          kind: 'uncertain',
          label: 'Check the channel',
          detail:
            'A previous attempt did not finish. Crewlink will not resend it automatically. Check the channel before doing anything else.',
          canPublish: false,
          canRetry: false,
        };
      }
      return {
        kind: 'sending',
        label: 'Publishing…',
        detail: 'Crewlink is sending this draft now.',
        canPublish: false,
        canRetry: false,
      };
    }

    // A failed attempt may be retried only by an explicit owner action, and only
    // while the draft is still approved for exactly the current text.
    if (!approved(draft)) {
      return {
        kind: 'needs_approval',
        label: 'Needs approval',
        detail: 'The draft changed after the failed attempt. Approve it again before retrying.',
        canPublish: false,
        canRetry: false,
      };
    }
    return {
      kind: 'failed',
      label: 'Failed',
      detail: failureDetail(publication.errorCode),
      canPublish: true,
      canRetry: true,
    };
  }

  if (!approved(draft)) {
    return {
      kind: 'needs_approval',
      label: 'Needs approval',
      detail: 'Approve the exact text before publishing.',
      canPublish: false,
      canRetry: false,
    };
  }

  return {
    kind: 'ready',
    label: 'Ready to publish',
    canPublish: true,
    canRetry: false,
  };
}

export default { publicationStateFor, STALE_SENDING_MS };
