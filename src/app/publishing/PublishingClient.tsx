'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { byId } from '@/platforms/registry';
import { publicationStateFor } from '@/posting/publicationState';
import type { PublicationState } from '@/posting/publicationState';
import { xTextMetrics, threadText, X_WEIGHTED_LIMIT, X_MAX_THREAD_PARTS } from '@/posting/x/text';
import { estimateXThread, formatUsd } from '@/posting/x/pricing';
import type { XCostEstimate } from '@/posting/x/pricing';
import type { XBudgetSummary } from '@/posting/x/usage';
import { renderMarkdownPreview } from '@/posting/reddit/markdown';
import { renderSlackMrkdwn } from '@/posting/slack/mrkdwn';
import { whatsAppShareUrl } from '@/posting/whatsapp/url';
import { ProjectLogo } from '@/components/ProjectLogo';
import type {
  RedditPostRequirements,
  RedditRule,
  RedditSubreddit,
  SlackChannel,
} from '@/posting/adapters/types';
import type {
  Draft,
  DraftCheck,
  PlatformConnection,
  Publication,
} from '@/types/index';

const BOT_PLATFORMS = ['discord', 'telegram'] as const;
const DRAFT_PLATFORMS = ['discord', 'telegram', 'x', 'reddit', 'linkedin', 'slack', 'whatsapp'] as const;
const X_INTENT_URL = 'https://x.com/intent/post?text=';
const REDDIT_TITLE_LIMIT = 300;
const REDDIT_BODY_LIMIT = 40_000;
// Mirrors the registry and the server-side LinkedIn check; the API is final.
const LINKEDIN_POST_LIMIT = byId('linkedin')?.characterLimit ?? 3000;
const SLACK_MESSAGE_LIMIT = byId('slack')?.characterLimit ?? 4000;
const WHATSAPP_MESSAGE_LIMIT = byId('whatsapp')?.characterLimit ?? 1000;

interface XEstimateView {
  estimate: XCostEstimate;
  budget: XBudgetSummary;
  automaticConfigured: boolean;
}

interface PublishingProject {
  id: string;
  title: string;
  slug: string;
  repoFullName: string;
  isPrivate: boolean;
  logoUrl: string | null;
}

interface DraftView extends Draft {
  checks: DraftCheck[];
  publication: Publication | null;
  publicationState: PublicationState;
}

interface RedditFields {
  title: string;
  subreddit: string;
  submissionType: 'self' | 'link';
  linkUrl: string;
  text: string;
}

interface RedditDetailsView {
  subreddit: RedditSubreddit;
  rules: RedditRule[];
  requirements: RedditPostRequirements;
}

interface RedditLiveCheck {
  checks: DraftCheck[];
  unverifiable: string[];
  subreddit: RedditSubreddit;
  requirements: RedditPostRequirements;
}

function redditFieldsFrom(draft: Draft): RedditFields {
  return {
    title: draft.title ?? '',
    subreddit: draft.subreddit ?? '',
    submissionType: draft.submissionType === 'link' ? 'link' : 'self',
    linkUrl: draft.linkUrl ?? '',
    text: draft.text,
  };
}

interface Notice {
  message: string;
  tone: 'success' | 'error';
}

interface PublishingClientProps {
  projects: PublishingProject[];
}

const PLACEHOLDERS: Record<string, string> = {
  discord: 'Channel ID, for example 123456789012345678',
  telegram: 'Channel ID (like -1001234567890) or @username',
};

const statusBadgeClass = (kind: PublicationState['kind']): string => {
  switch (kind) {
    case 'ready':
      return 'border-[#238636]/40 bg-[#238636]/15 text-[#3fb950]';
    case 'published':
      return 'border-[#238636]/40 bg-[#238636]/20 text-[#3fb950]';
    case 'failed':
      return 'border-[#da3633]/40 bg-[#da3633]/15 text-[#f85149]';
    case 'uncertain':
    case 'needs_approval':
      return 'border-[#d29922]/40 bg-[#d29922]/15 text-[#e3b341]';
    default:
      return 'border-line bg-panel-2 text-[#8b949e]';
  }
};

function StatusBadge({ state }: { state: PublicationState }) {
  return (
    <span
      className={`flex-none rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] ${statusBadgeClass(state.kind)}`}
    >
      {state.label}
    </span>
  );
}

export function PublishingClient({ projects }: PublishingClientProps) {
  const [selectedId, setSelectedId] = useState(projects[0]?.id || '');
  const [drafts, setDrafts] = useState<DraftView[]>([]);
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [threadEdits, setThreadEdits] = useState<Record<string, string[]>>({});
  const [redditEdits, setRedditEdits] = useState<Record<string, RedditFields>>({});
  const [redditSearch, setRedditSearch] = useState('');
  const [redditResults, setRedditResults] = useState<RedditSubreddit[]>([]);
  const [redditSearchBusy, setRedditSearchBusy] = useState(false);
  const [redditDetails, setRedditDetails] = useState<RedditDetailsView | null>(null);
  const [redditDetailsBusy, setRedditDetailsBusy] = useState(false);
  const [redditLive, setRedditLive] = useState<RedditLiveCheck | null>(null);
  const [redditNotice, setRedditNotice] = useState<string | undefined>(undefined);
  const [slackChannels, setSlackChannels] = useState<SlackChannel[]>([]);
  const [slackChannelChoice, setSlackChannelChoice] = useState('');
  const [slackChannelsBusy, setSlackChannelsBusy] = useState(false);
  const [slackChannelsError, setSlackChannelsError] = useState<string | undefined>(undefined);
  // Share links are built locally from the approved text after the server has
  // recorded the prepared state. No message content is sent to WhatsApp.
  const [whatsappShares, setWhatsappShares] = useState<Record<string, string>>({});
  const [estimates, setEstimates] = useState<Record<string, XEstimateView>>({});
  const [channelInputs, setChannelInputs] = useState<Record<string, string>>({});
  const [connectErrors, setConnectErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string, tone: Notice['tone'] = 'success') => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ message, tone });
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  // --- Load drafts (with publication state) and connection summaries ---
  const loadProject = useCallback(
    async (projectId: string, silent = false) => {
      if (!projectId) return;
      if (!silent) setLoading(true);
      try {
        const [draftsRes, connectionsRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/drafts`, { cache: 'no-store' }),
          fetch(`/api/platforms/connections?projectId=${encodeURIComponent(projectId)}`, {
            cache: 'no-store',
          }),
        ]);

        if (draftsRes.ok) {
          const data = await draftsRes.json();
          const list: DraftView[] = (Array.isArray(data.drafts) ? data.drafts : []).filter(
            (draft: DraftView) =>
              DRAFT_PLATFORMS.includes(draft.platformId as (typeof DRAFT_PLATFORMS)[number])
          );
          setDrafts(list);
          setDraftEdits((prev) => {
            const next = { ...prev };
            for (const draft of list) {
              if (!(draft.id in next)) next[draft.id] = draft.text;
            }
            for (const id of Object.keys(next)) {
              if (!list.some((draft) => draft.id === id)) delete next[id];
            }
            return next;
          });
          setThreadEdits((prev) => {
            const next: Record<string, string[]> = {};
            for (const draft of list) {
              if (draft.platformId !== 'x') continue;
              next[draft.id] = draft.threadParts?.length
                ? [...draft.threadParts]
                : [prev[draft.id]?.[0] ?? draft.text];
            }
            return next;
          });
          setRedditEdits((prev) => {
            const next: Record<string, RedditFields> = {};
            for (const draft of list) {
              if (draft.platformId !== 'reddit') continue;
              next[draft.id] = prev[draft.id] ?? redditFieldsFrom(draft);
            }
            return next;
          });
          // Each X draft gets its own server estimate; the budget and
          // "configured" flag are app-wide but arrive with the same payload.
          for (const xDraft of list.filter((draft) => draft.platformId === 'x')) {
            fetch(`/api/drafts/${xDraft.id}/x/estimate`, { cache: 'no-store' })
              .then(async (res) => (res.ok ? res.json() : null))
              .then((estimateData) => {
                if (estimateData?.estimate) {
                  setEstimates((prev) => ({ ...prev, [xDraft.id]: estimateData }));
                }
              })
              .catch(() => undefined);
          }
        } else {
          const data = await draftsRes.json().catch(() => ({}));
          notify(data.error || 'Could not load drafts for this project.', 'error');
        }

        if (connectionsRes.ok) {
          const data = await connectionsRes.json();
          setConnections(Array.isArray(data.connections) ? data.connections : []);
        }
      } catch {
        notify('Could not reach the server. Nothing was published.', 'error');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [notify]
  );

  useEffect(() => {
    void loadProject(selectedId);
  }, [selectedId, loadProject]);

  // Switching projects must not leave another project's subreddit results or
  // validation visible.
  useEffect(() => {
    setRedditSearch('');
    setRedditResults([]);
    setRedditDetails(null);
    setRedditLive(null);
    setRedditNotice(undefined);
    setSlackChannels([]);
    setSlackChannelChoice('');
    setSlackChannelsError(undefined);
    setWhatsappShares({});
  }, [selectedId]);

  // The OAuth callback returns here with a short status. The query is removed so
  // a refresh cannot replay the notice.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const xResult = params.get('x');
    const redditResult = params.get('reddit');
    const linkedinResult = params.get('linkedin');
    const slackResult = params.get('slack');
    if (!xResult && !redditResult && !linkedinResult && !slackResult) return;
    if (xResult === 'connected') {
      const account = params.get('account');
      notify(account ? `X account connected as @${account}.` : 'X account connected.');
    } else if (xResult === 'denied') {
      notify('X authorization was cancelled. Nothing was connected.', 'error');
    } else if (xResult) {
      notify('X could not be connected. Start the connection again.', 'error');
    }
    if (redditResult === 'connected') {
      const account = params.get('account');
      notify(account ? `Reddit account connected as u/${account}.` : 'Reddit account connected.');
    } else if (redditResult === 'denied') {
      notify('Reddit authorization was cancelled. Nothing was connected.', 'error');
    } else if (redditResult) {
      notify('Reddit could not be connected. Start the connection again.', 'error');
    }
    if (linkedinResult === 'connected') {
      const account = params.get('account');
      notify(
        account ? `LinkedIn account connected as ${account}.` : 'LinkedIn account connected.'
      );
    } else if (linkedinResult === 'denied') {
      notify('LinkedIn authorization was cancelled. Nothing was connected.', 'error');
    } else if (linkedinResult) {
      notify('LinkedIn could not be connected. Start the connection again.', 'error');
    }
    if (slackResult === 'connected') {
      const workspace = params.get('workspace');
      notify(
        workspace
          ? `Slack workspace connected: ${workspace}. Choose a channel below.`
          : 'Slack workspace connected. Choose a channel below.'
      );
    } else if (slackResult === 'denied') {
      notify('Slack installation was cancelled. Nothing was connected.', 'error');
    } else if (slackResult) {
      notify('Slack could not be connected. Start the installation again.', 'error');
    }
    params.delete('x');
    params.delete('reddit');
    params.delete('linkedin');
    params.delete('slack');
    params.delete('workspace');
    params.delete('account');
    params.delete('reason');
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}`
    );
  }, [notify]);

  const selectedProject = projects.find((project) => project.id === selectedId);
  const xConnection = connections.find(
    (connection) => connection.platformId === 'x' && connection.status === 'active'
  );
  const xDraft = drafts.find((draft) => draft.platformId === 'x');
  const xEstimateView = xDraft ? estimates[xDraft.id] : undefined;
  const redditConnection = connections.find(
    (connection) => connection.platformId === 'reddit' && connection.status === 'active'
  );
  const redditDraft = drafts.find((draft) => draft.platformId === 'reddit');
  const linkedinConnection = connections.find(
    (connection) => connection.platformId === 'linkedin' && connection.status === 'active'
  );
  const linkedinDraft = drafts.find((draft) => draft.platformId === 'linkedin');
  const slackConnection = connections.find(
    (connection) => connection.platformId === 'slack' && connection.status === 'active'
  );
  const slackDraft = drafts.find((draft) => draft.platformId === 'slack');
  const whatsappDraft = drafts.find((draft) => draft.platformId === 'whatsapp');
  // A stable date string avoids a server/client locale mismatch.
  const linkedinTokenExpiry = linkedinConnection?.tokenExpiresAt
    ? linkedinConnection.tokenExpiresAt.slice(0, 10)
    : undefined;

  // Lists only what the Crewlink bot itself can see: public channels plus the
  // private channels the owner invited it to. The owner's Slack access is never
  // used, and Crewlink never joins a channel automatically.
  const loadSlackChannels = useCallback(async (connectionId: string) => {
    if (!connectionId) return;
    setSlackChannelsBusy(true);
    setSlackChannelsError(undefined);
    try {
      const res = await fetch(
        `/api/platforms/slack/channels?connectionId=${encodeURIComponent(connectionId)}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (!res.ok) {
        setSlackChannels([]);
        setSlackChannelsError(data.error || 'Could not load Slack channels.');
        return;
      }
      setSlackChannels(Array.isArray(data.channels) ? data.channels : []);
    } catch {
      setSlackChannels([]);
      setSlackChannelsError('Could not reach the server. No channels were loaded.');
    } finally {
      setSlackChannelsBusy(false);
    }
  }, []);

  const slackConnectionId = slackConnection?.id;
  const slackSelectedChannelId = slackConnection?.channelId;
  useEffect(() => {
    setSlackChannelChoice(slackSelectedChannelId || '');
    if (slackConnectionId) {
      void loadSlackChannels(slackConnectionId);
    } else {
      setSlackChannels([]);
    }
  }, [slackConnectionId, slackSelectedChannelId, loadSlackChannels]);

  const handleGenerateDrafts = async (platforms: readonly string[] = BOT_PLATFORMS) => {
    setBusy('generate');
    try {
      const res = await fetch(`/api/projects/${selectedId}/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms: [...platforms] }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data.error || 'Could not generate drafts.', 'error');
        return;
      }
      notify('Drafts generated. Edit and approve the exact text before publishing.');
      await loadProject(selectedId, true);
    } catch {
      notify('Could not reach the server. No drafts were generated.', 'error');
    } finally {
      setBusy(null);
    }
  };

  // X edits are per-post parts; the server joins them into the canonical text
  // that approval hashes, so a single save covers the whole thread.
  const xPartsFor = (draft: DraftView): string[] =>
    threadEdits[draft.id] ?? draft.threadParts ?? [draft.text];

  const handleSaveDraft = async (draft: DraftView) => {
    const isX = draft.platformId === 'x';
    const parts = xPartsFor(draft);
    if (isX && parts.some((part) => !part.trim())) {
      notify('Each post needs text before it can be saved.', 'error');
      return;
    }

    setBusy(`save:${draft.id}`);
    try {
      const res = await fetch(`/api/drafts/${draft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isX ? { threadParts: parts } : { text: draftEdits[draft.id] ?? '' }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data.error || 'Could not save the draft.', 'error');
        return;
      }
      notify('Draft saved. Approve the exact text before publishing.');
      await loadProject(selectedId, true);
    } catch {
      notify('Could not reach the server. The draft was not saved.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const updateThreadPart = (draftId: string, index: number, value: string) => {
    setThreadEdits((prev) => {
      const parts = [...(prev[draftId] ?? [])];
      parts[index] = value;
      return { ...prev, [draftId]: parts };
    });
  };

  const addThreadPart = (draftId: string) => {
    setThreadEdits((prev) => {
      const parts = prev[draftId] ?? [];
      if (parts.length >= X_MAX_THREAD_PARTS) return prev;
      return { ...prev, [draftId]: [...parts, ''] };
    });
  };

  const removeThreadPart = (draftId: string, index: number) => {
    setThreadEdits((prev) => {
      const parts = prev[draftId] ?? [];
      if (parts.length <= 1) return prev;
      return { ...prev, [draftId]: parts.filter((_, partIndex) => partIndex !== index) };
    });
  };

  const copyText = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(message);
    } catch {
      notify('Copy failed. Select the text and copy it manually.', 'error');
    }
  };

  const handleApproveDraft = async (draftId: string) => {
    setBusy(`approve:${draftId}`);
    try {
      const res = await fetch(`/api/drafts/${draftId}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data.checks)) {
          setDrafts((prev) =>
            prev.map((draft) => (draft.id === draftId ? { ...draft, checks: data.checks } : draft))
          );
        }
        notify(data.error || 'Could not approve the draft.', 'error');
        return;
      }
      notify('Draft approved. Publishing is still a separate, manual step.');
      await loadProject(selectedId, true);
    } catch {
      notify('Could not reach the server. The draft was not approved.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handlePublishDraft = async (draft: DraftView) => {
    // Fail-safe guard: only the explicit, currently allowed action can send.
    // Uncertain, sending and published drafts never reach this call.
    if (!draft.publicationState.canPublish) return;
    setBusy(`publish:${draft.id}`);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/publish`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        notify('Published. Crewlink recorded the result.');
      } else if (data.code === 'uncertain') {
        notify(
          'The result is uncertain. Check the channel; Crewlink will not resend this automatically.',
          'error'
        );
      } else {
        notify(data.error || 'Publishing failed.', 'error');
      }
      await loadProject(selectedId, true);
    } catch {
      notify(
        'The request did not complete. Check the channel before trying again; Crewlink never resends automatically.',
        'error'
      );
      await loadProject(selectedId, true);
    } finally {
      setBusy(null);
    }
  };

  // --- X automatic publishing ---
  // Cost is shown and confirmed here, then checked again on the server. The
  // browser never sees a token: it only redirects to the X authorization page.
  const handlePublishX = async (draft: DraftView) => {
    if (!draft.publicationState.canPublish) return;
    const view = estimates[draft.id];
    if (!view?.automaticConfigured) {
      notify('Automatic X publishing is not configured on this server. Manual publishing is free.', 'error');
      return;
    }
    const parts = xPartsFor(draft);
    const problems = parts.map((part) => xTextMetrics(part));
    if (parts.some((part) => !part.trim()) || problems.some((metrics) => !metrics.valid)) {
      notify('Fix the thread text before publishing.', 'error');
      return;
    }

    // Price the current edit locally; the server recomputes and enforces it.
    const estimate = estimateXThread(parts);
    const confirmed = window.confirm(
      `Publish ${estimate.requests} post${estimate.requests === 1 ? '' : 's'} through the official X API?\n\n` +
        `Estimated cost: ${formatUsd(estimate.costMicros)}\n` +
        `Budget remaining this month: ${formatUsd(view.budget.remainingMicros)}\n\n` +
        'X bills the Crewlink-owned app. The actual charge may differ, and this action cannot be undone.'
    );
    if (!confirmed) return;

    setBusy(`publish:${draft.id}`);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmCost: true, maxCostUsd: estimate.costUsd }),
      });
      const data = await res.json();
      if (res.ok) {
        notify('Published through the X API. Crewlink recorded the returned post ids.');
      } else if (data.code === 'uncertain') {
        notify('The result is uncertain. Check X; Crewlink will not resend this automatically.', 'error');
      } else if (data.code === 'partial_thread') {
        notify('Part of the thread was posted. Crewlink will not restart it; finish it on X.', 'error');
      } else if (data.code === 'budget_exhausted') {
        notify('The X budget is exhausted for this month. Manual publishing is still free.', 'error');
      } else if (data.code === 'cost_limit_exceeded') {
        notify('The confirmed cost limit no longer covers this text. Review the new estimate and try again.', 'error');
      } else {
        notify(data.error || 'Publishing failed.', 'error');
      }
      await loadProject(selectedId, true);
    } catch {
      notify('The request did not complete. Check X before trying again; Crewlink never resends automatically.', 'error');
      await loadProject(selectedId, true);
    } finally {
      setBusy(null);
    }
  };

  // --- X manual publishing ---
  // No request is made to X. The owner's statement is recorded as unverified.
  const handleManualPublished = async (draft: DraftView) => {
    const parts = xPartsFor(draft);
    const confirmed = window.confirm(
      `Confirm you posted this ${parts.length === 1 ? 'post' : 'thread'} on X by hand.\n\n` +
        'Crewlink will record it as manually published. It cannot verify the post on X, and no X API call is made.'
    );
    if (!confirmed) return;

    setBusy(`manual:${draft.id}`);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/manual-published`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        notify(data.error || 'Could not record the manual publication.', 'error');
        return;
      }
      notify('Recorded as manually published. Crewlink did not verify it on X.');
      await loadProject(selectedId, true);
    } catch {
      notify('Could not reach the server. Nothing was recorded.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleConnectX = async () => {
    setBusy('connect:x');
    setConnectErrors((prev) => ({ ...prev, x: undefined }));
    try {
      const res = await fetch('/api/platforms/x/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedId }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.authorizationUrl !== 'string') {
        setConnectErrors((prev) => ({
          ...prev,
          x: data.error || 'X authorization could not be started.',
        }));
        return;
      }
      // The callback URL is fixed by the server; this page only sends the browser
      // to X's authorization page.
      window.location.assign(data.authorizationUrl);
    } catch {
      setConnectErrors((prev) => ({
        ...prev,
        x: 'Could not reach the server. Nothing was connected.',
      }));
    } finally {
      setBusy(null);
    }
  };

  // --- Reddit account, discovery and composer ---
  const updateRedditField = (draftId: string, patch: Partial<RedditFields>) => {
    setRedditEdits((prev) => {
      const current = prev[draftId];
      if (!current) return prev;
      return { ...prev, [draftId]: { ...current, ...patch } };
    });
    // Any edit invalidates the live check for the saved draft.
    setRedditLive(null);
    setRedditNotice(undefined);
  };

  const handleConnectReddit = async () => {
    setBusy('connect:reddit');
    setConnectErrors((prev) => ({ ...prev, reddit: undefined }));
    try {
      const res = await fetch('/api/platforms/reddit/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedId }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.authorizationUrl !== 'string') {
        setConnectErrors((prev) => ({
          ...prev,
          reddit: data.error || 'Reddit authorization could not be started.',
        }));
        return;
      }
      window.location.assign(data.authorizationUrl);
    } catch {
      setConnectErrors((prev) => ({
        ...prev,
        reddit: 'Could not reach the server. Nothing was connected.',
      }));
    } finally {
      setBusy(null);
    }
  };

  const handleSearchSubreddits = async () => {
    if (!redditConnection) {
      setRedditNotice('Connect a Reddit account before searching subreddits.');
      return;
    }
    const query = redditSearch.trim();
    if (!query) {
      setRedditResults([]);
      setRedditNotice('Enter a subreddit name or keyword to search.');
      return;
    }
    setRedditSearchBusy(true);
    setRedditNotice(undefined);
    try {
      const res = await fetch(
        `/api/platforms/reddit/subreddits?projectId=${encodeURIComponent(selectedId)}&q=${encodeURIComponent(query)}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (!res.ok) {
        setRedditNotice(data.error || 'Could not search subreddits.');
        return;
      }
      const results: RedditSubreddit[] = Array.isArray(data.subreddits) ? data.subreddits : [];
      setRedditResults(results);
      if (results.length === 0) {
        setRedditNotice('No subreddits matched that search.');
      }
    } catch {
      setRedditNotice('Could not reach the server. No search was made.');
    } finally {
      setRedditSearchBusy(false);
    }
  };

  const handleSelectSubreddit = async (draft: DraftView, name: string) => {
    updateRedditField(draft.id, { subreddit: name });
    setRedditDetailsBusy(true);
    setRedditNotice(undefined);
    try {
      const res = await fetch(
        `/api/platforms/reddit/subreddits/${encodeURIComponent(name)}?projectId=${encodeURIComponent(selectedId)}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (!res.ok) {
        setRedditDetails(null);
        setRedditNotice(data.error || 'Could not load this subreddit.');
        return;
      }
      setRedditDetails({
        subreddit: data.subreddit,
        rules: Array.isArray(data.rules) ? data.rules : [],
        requirements: data.requirements || {},
      });
    } catch {
      setRedditDetails(null);
      setRedditNotice('Could not reach the server. The subreddit was not loaded.');
    } finally {
      setRedditDetailsBusy(false);
    }
  };

  const handleSaveReddit = async (draft: DraftView) => {
    const fields = redditEdits[draft.id] ?? redditFieldsFrom(draft);
    const subreddit = fields.subreddit.trim().replace(/^\/?r\//i, '');
    if (!fields.title.trim()) {
      notify('Reddit submissions need a title.', 'error');
      return;
    }
    if (fields.title.trim().length > REDDIT_TITLE_LIMIT) {
      notify(`Reddit titles are limited to ${REDDIT_TITLE_LIMIT} characters.`, 'error');
      return;
    }
    if (!/^[A-Za-z0-9_]{2,21}$/.test(subreddit)) {
      notify('Enter a valid subreddit name (2–21 letters, numbers or underscores).', 'error');
      return;
    }
    if (fields.submissionType === 'self' && !fields.text.trim()) {
      notify('A text submission needs a body.', 'error');
      return;
    }
    if (fields.submissionType === 'link') {
      try {
        const url = new URL(fields.linkUrl.trim());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
      } catch {
        notify('Enter a valid http(s) link.', 'error');
        return;
      }
    }

    setBusy(`save:${draft.id}`);
    try {
      const res = await fetch(`/api/drafts/${draft.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: fields.submissionType === 'link' ? '' : fields.text,
          title: fields.title,
          subreddit,
          submissionType: fields.submissionType,
          linkUrl: fields.linkUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data.error || 'Could not save the Reddit draft.', 'error');
        return;
      }
      if (data.draft) {
        setRedditEdits((prev) => ({ ...prev, [draft.id]: redditFieldsFrom(data.draft) }));
      }
      notify('Reddit draft saved. Validate, then approve the exact submission.');
      await loadProject(selectedId, true);
    } catch {
      notify('Could not reach the server. The Reddit draft was not saved.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleValidateReddit = async (draft: DraftView) => {
    setBusy(`validate:${draft.id}`);
    setRedditLive(null);
    setRedditNotice(undefined);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/reddit/check`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setRedditNotice(data.error || 'Reddit validation failed.');
        return;
      }
      const live: RedditLiveCheck = {
        checks: Array.isArray(data.checks) ? data.checks : [],
        unverifiable: Array.isArray(data.unverifiable) ? data.unverifiable : [],
        subreddit: data.subreddit,
        requirements: data.requirements || {},
      };
      setRedditLive(live);
      setRedditDetails((prev) => ({
        subreddit: live.subreddit,
        rules: prev?.rules ?? [],
        requirements: live.requirements,
      }));
      const errors = live.checks.filter((check) => check.level === 'error');
      if (errors.length > 0) {
        setRedditNotice(errors[0].message);
      } else {
        setRedditNotice(
          'Reddit’s public rules allow this submission as far as Crewlink can check. A moderator can still reject it.'
        );
      }
    } catch {
      setRedditNotice('Could not reach the server. Nothing was validated.');
    } finally {
      setBusy(null);
    }
  };

  // --- LinkedIn account and composer ---
  const handleConnectLinkedIn = async () => {
    setBusy('connect:linkedin');
    setConnectErrors((prev) => ({ ...prev, linkedin: undefined }));
    try {
      const res = await fetch('/api/platforms/linkedin/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedId }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.authorizationUrl !== 'string') {
        setConnectErrors((prev) => ({
          ...prev,
          linkedin: data.error || 'LinkedIn authorization could not be started.',
        }));
        return;
      }
      // The callback URL is fixed by the server; this page only sends the browser
      // to LinkedIn's authorization page.
      window.location.assign(data.authorizationUrl);
    } catch {
      setConnectErrors((prev) => ({
        ...prev,
        linkedin: 'Could not reach the server. Nothing was connected.',
      }));
    } finally {
      setBusy(null);
    }
  };

  const handleVerifyLinkedIn = async (connectionId: string) => {
    setBusy('verify:linkedin');
    setConnectErrors((prev) => ({ ...prev, linkedin: undefined }));
    try {
      const res = await fetch(`/api/platforms/connections/${connectionId}/verify`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setConnectErrors((prev) => ({
          ...prev,
          linkedin: data.error || 'Could not verify the LinkedIn connection.',
        }));
        return;
      }
      notify('LinkedIn connection verified.');
      await loadProject(selectedId, true);
    } catch {
      setConnectErrors((prev) => ({
        ...prev,
        linkedin: 'Could not reach the server. The connection was not verified.',
      }));
    } finally {
      setBusy(null);
    }
  };

  // --- Slack workspace installation and channel selection ---
  const handleConnectSlack = async () => {
    setBusy('connect:slack');
    setConnectErrors((prev) => ({ ...prev, slack: undefined }));
    try {
      const res = await fetch('/api/platforms/slack/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedId }),
      });
      const data = await res.json();
      if (!res.ok || typeof data.authorizationUrl !== 'string') {
        setConnectErrors((prev) => ({
          ...prev,
          slack: data.error || 'Slack installation could not be started.',
        }));
        return;
      }
      // The callback URL is fixed by the server; this page only sends the
      // browser to Slack's authorization page.
      window.location.assign(data.authorizationUrl);
    } catch {
      setConnectErrors((prev) => ({
        ...prev,
        slack: 'Could not reach the server. Nothing was connected.',
      }));
    } finally {
      setBusy(null);
    }
  };

  const handleVerifySlack = async (connectionId: string) => {
    setBusy('verify:slack');
    setConnectErrors((prev) => ({ ...prev, slack: undefined }));
    try {
      const res = await fetch(`/api/platforms/connections/${connectionId}/verify`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setConnectErrors((prev) => ({
          ...prev,
          slack: data.error || 'Could not verify the Slack connection.',
        }));
        return;
      }
      notify('Slack connection verified.');
      await loadProject(selectedId, true);
      await loadSlackChannels(connectionId);
    } catch {
      setConnectErrors((prev) => ({
        ...prev,
        slack: 'Could not reach the server. The connection was not verified.',
      }));
    } finally {
      setBusy(null);
    }
  };

  // The server re-reads the channel from Slack, so archived channels and
  // channels the bot was not invited to are rejected here as well.
  const handleSelectSlackChannel = async () => {
    if (!slackConnection) return;
    const channelId = slackChannelChoice.trim();
    if (!channelId) {
      setSlackChannelsError('Choose a channel first.');
      return;
    }
    if (channelId === slackConnection.channelId) {
      setSlackChannelsError('That channel is already selected.');
      return;
    }
    setBusy('slack:select');
    setSlackChannelsError(undefined);
    try {
      const res = await fetch('/api/platforms/slack/channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: slackConnection.id, channelId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSlackChannelsError(data.error || 'The Slack channel could not be selected.');
        return;
      }
      notify('Slack channel selected. Current approvals were cleared; approve the message again.');
      await loadProject(selectedId, true);
    } catch {
      setSlackChannelsError('Could not reach the server. The channel was not changed.');
    } finally {
      setBusy(null);
    }
  };

  // --- WhatsApp manual sharing ---
  // The server records the prepared intent and rechecks ownership, approval and
  // the content hash. The share link is built locally; nothing is sent to
  // WhatsApp and no step below claims the message was delivered.
  const handlePrepareWhatsApp = async (draft: DraftView, copy: boolean) => {
    setBusy(`whatsapp-prepare:${draft.id}`);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/whatsapp/prepare`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || typeof data.shareUrl !== 'string') {
        notify(data.error || 'Could not prepare the WhatsApp message.', 'error');
        return;
      }
      setWhatsappShares((prev) => ({ ...prev, [draft.id]: data.shareUrl }));
      if (copy) {
        try {
          await navigator.clipboard.writeText(draft.text);
          notify('Message copied and prepared. Nothing has been sent.');
        } catch {
          notify(
            'Message prepared, but copying failed. Select the text and copy it manually.',
            'error'
          );
        }
      } else {
        notify('Message prepared. Opening WhatsApp does not send it.');
      }
      await loadProject(selectedId, true);
    } catch {
      notify('Could not reach the server. Nothing was prepared.', 'error');
    } finally {
      setBusy(null);
    }
  };

  // The anchor opens WhatsApp; this only records that the owner opened it. A
  // failed record leaves the publication prepared, which is still accurate.
  const handleWhatsAppOpened = async (draft: DraftView) => {
    try {
      const res = await fetch(`/api/drafts/${draft.id}/whatsapp/opened`, { method: 'POST' });
      if (res.ok) await loadProject(selectedId, true);
    } catch {
      // Opening already happened in the browser; the record can be retried.
    }
  };

  const handleMarkWhatsAppShared = async (draft: DraftView) => {
    const confirmed = window.confirm(
      'Mark this WhatsApp message as shared by hand?\n\n' +
        'Crewlink will record your confirmation. It did not send the message and cannot verify or confirm delivery.'
    );
    if (!confirmed) return;

    setBusy(`whatsapp-shared:${draft.id}`);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/whatsapp/shared`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        notify(data.error || 'Could not record the manual share.', 'error');
        return;
      }
      notify('Recorded as shared by hand. Crewlink did not send or deliver it.');
      setWhatsappShares((prev) => {
        const next = { ...prev };
        delete next[draft.id];
        return next;
      });
      await loadProject(selectedId, true);
    } catch {
      notify('Could not reach the server. Nothing was recorded.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleConnect = async (platformId: string) => {
    const channelId = (channelInputs[platformId] || '').trim();
    if (!channelId) {
      setConnectErrors((prev) => ({ ...prev, [platformId]: 'Enter the channel to publish to.' }));
      return;
    }
    setBusy(`connect:${platformId}`);
    setConnectErrors((prev) => ({ ...prev, [platformId]: undefined }));
    try {
      const res = await fetch('/api/platforms/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedId, platformId, channelId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setConnectErrors((prev) => ({
          ...prev,
          [platformId]: data.error || 'The channel could not be verified.',
        }));
        return;
      }
      setChannelInputs((prev) => ({ ...prev, [platformId]: '' }));
      notify('Channel verified and connected.');
      await loadProject(selectedId, true);
    } catch {
      setConnectErrors((prev) => ({
        ...prev,
        [platformId]: 'Could not reach the server. Nothing was connected.',
      }));
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async (platformId: string, connectionId: string) => {
    setBusy(`disconnect:${platformId}`);
    try {
      const res = await fetch(`/api/platforms/connections/${connectionId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        notify(data.error || 'Could not disconnect this channel.', 'error');
        return;
      }
      notify('Channel disconnected.');
      await loadProject(selectedId, true);
    } catch {
      notify('Could not reach the server. The channel is still connected.', 'error');
    } finally {
      setBusy(null);
    }
  };

  if (projects.length === 0) {
    return (
      <div className="mx-auto max-w-[1100px] px-6 py-8">
        <h1 className="text-lg font-semibold tracking-tight text-ink">Publishing</h1>
        <p className="mt-0.5 text-[12px] text-[#8b949e]">
          Connect a Discord or Telegram channel, a Slack workspace, an X, Reddit or LinkedIn
          account, or prepare a WhatsApp message by hand. Approve the exact text, then publish it
          yourself.
        </p>
        <div className="mt-6 rounded-[10px] border border-dashed border-line-soft bg-panel px-6 py-16 text-center">
          <h2 className="mb-2 text-sm font-normal text-ink">No repositories connected yet</h2>
          <p className="mx-auto mb-6 max-w-md text-[12px] leading-relaxed text-[#8b949e]">
            Create a project from a repository where you have admin access. Publishing drafts are tied
            to a project.
          </p>
          <a
            href="/projects/new"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-success bg-success px-5 text-[13px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis"
          >
            Create a project
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Publishing</h1>
          <p className="mt-0.5 text-[12px] text-[#8b949e]">
            Crewlink never retries automatically. Approve the exact text, then publish it yourself.
            Automatic X publishing asks you to confirm a cost estimate first. Reddit, LinkedIn and
            Slack publishing use your connected account. WhatsApp is manual only: Crewlink prepares
            the message and cannot send or verify it.
          </p>
        </div>
        {projects.length > 1 && (
          <label className="flex items-center gap-2 text-[12px] text-[#8b949e]">
            Project
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="h-8 rounded-md border border-line bg-panel px-2 text-[12px] text-ink"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {selectedProject && (
        <div className="mb-6 flex items-center gap-3 rounded-[10px] border border-line bg-panel p-4">
          <ProjectLogo
            title={selectedProject.title}
            logoUrl={selectedProject.logoUrl}
            className="h-10 w-10"
            textClassName="text-[13px]"
          />
          <div className="min-w-0">
            <p className="truncate text-[13px] text-ink">{selectedProject.title}</p>
            <p className="text-[11px] text-[#8b949e]">
              {selectedProject.repoFullName} &middot; {selectedProject.isPrivate ? 'Private repository' : 'Public repository'}
            </p>
          </div>
        </div>
      )}

      <section className="mb-6">
        <h2 className="mb-3 text-[13px] font-semibold text-ink">Channels</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {BOT_PLATFORMS.map((platformId) => {
            const platform = byId(platformId);
            const connection = connections.find((item) => item.platformId === platformId);
            const active = connection?.status === 'active' && Boolean(connection.channelId);
            const connecting = busy === `connect:${platformId}`;
            const disconnecting = busy === `disconnect:${platformId}`;

            return (
              <div key={platformId} className="rounded-[10px] border border-line bg-panel p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-[13px] text-ink">{platform?.name || platformId}</h3>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-[#8b949e]">
                      {platform?.note || 'Crewlink posts through its own official application.'}
                    </p>
                  </div>
                  <span
                    className={`flex-none rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] ${
                      active
                        ? 'border-[#238636]/40 bg-[#238636]/15 text-[#3fb950]'
                        : 'border-line bg-panel-2 text-[#8b949e]'
                    }`}
                  >
                    {active ? 'Connected' : 'Not connected'}
                  </span>
                </div>

                {active && connection ? (
                  <p className="mt-3 text-[12px] text-[#c9d1d9]">
                    {connection.serverName ? `${connection.serverName} · ` : ''}
                    {connection.channelName || connection.channelId}
                  </p>
                ) : (
                  <p className="mt-3 text-[11px] text-[#8b949e]">
                    Add the Crewlink bot to the channel as an administrator, then paste its channel ID
                    here. The bot verifies its own membership and posting rights before this becomes
                    active.
                  </p>
                )}

                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={channelInputs[platformId] || ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      setChannelInputs((prev) => ({ ...prev, [platformId]: value }));
                      setConnectErrors((prev) => ({ ...prev, [platformId]: undefined }));
                    }}
                    placeholder={PLACEHOLDERS[platformId]}
                    className="h-8 w-full min-w-0 rounded-md border border-line bg-canvas-inset px-2.5 text-[12px] text-ink sm:flex-1"
                    aria-label={`${platform?.name || platformId} channel`}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleConnect(platformId)}
                      disabled={connecting || loading}
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {connecting ? 'Verifying…' : active ? 'Change channel' : 'Verify & connect'}
                    </button>
                    {active && connection && (
                      <button
                        type="button"
                        onClick={() => handleDisconnect(platformId, connection.id)}
                        disabled={disconnecting}
                        className="h-8 rounded-md border border-[#da3633]/40 px-3 text-[12px] text-[#f85149] transition-colors hover:bg-[#da3633]/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    )}
                  </div>
                </div>

                {connectErrors[platformId] && (
                  <p className="mt-2 text-[11px] leading-relaxed text-[#f85149]">
                    {connectErrors[platformId]}
                  </p>
                )}
                {active && (
                  <p className="mt-2 text-[11px] leading-relaxed text-[#8b949e]">
                    Changing the channel revokes current approvals for this platform. Approve the text
                    again afterward.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-ink">Reddit</h2>
          <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] text-[#8b949e]">
            Official API
          </span>
        </div>
        <div className="rounded-[10px] border border-line bg-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-[13px] text-ink">Account connection</h3>
              <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-[#8b949e]">
                Connect through Reddit’s official OAuth flow. Crewlink requests only{' '}
                <span className="font-mono text-[#c9d1d9]">identity</span>,{' '}
                <span className="font-mono text-[#c9d1d9]">read</span> and{' '}
                <span className="font-mono text-[#c9d1d9]">submit</span> so it can read subreddit
                details and submit posts as you. Submissions are still subject to each community’s
                rules and moderator review.
              </p>
            </div>
            <span
              className={`flex-none rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] ${
                redditConnection
                  ? 'border-[#238636]/40 bg-[#238636]/15 text-[#3fb950]'
                  : 'border-line bg-panel-2 text-[#8b949e]'
              }`}
            >
              {redditConnection ? 'Connected' : 'Not connected'}
            </span>
          </div>

          {redditConnection ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[12px] text-[#c9d1d9]">
                u/{redditConnection.externalAccountName || redditConnection.externalAccountId}
                {redditConnection.scopes.length > 0 && (
                  <span className="text-[#8b949e]"> · {redditConnection.scopes.join(', ')}</span>
                )}
              </p>
              <button
                type="button"
                onClick={handleConnectReddit}
                disabled={busy === 'connect:reddit'}
                className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'connect:reddit' ? 'Opening Reddit…' : 'Reconnect'}
              </button>
              <button
                type="button"
                onClick={() => handleDisconnect('reddit', redditConnection.id)}
                disabled={busy === 'disconnect:reddit'}
                className="h-8 rounded-md border border-[#da3633]/40 px-3 text-[12px] text-[#f85149] transition-colors hover:bg-[#da3633]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'disconnect:reddit' ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleConnectReddit}
              disabled={busy === 'connect:reddit' || loading}
              className="mt-3 h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'connect:reddit' ? 'Opening Reddit…' : 'Connect Reddit account'}
            </button>
          )}

          {connectErrors.reddit && (
            <p className="mt-2 text-[11px] leading-relaxed text-[#f85149]">{connectErrors.reddit}</p>
          )}
          {redditConnection && (
            <p className="mt-2 text-[11px] leading-relaxed text-[#8b949e]">
              Switching to a different Reddit account revokes current approval for this platform.
              Reconnecting keeps the same project connection; it does not create a duplicate.
            </p>
          )}
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-ink">LinkedIn</h2>
          <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] text-[#8b949e]">
            Member posts &middot; official API
          </span>
        </div>
        <div className="rounded-[10px] border border-line bg-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-[13px] text-ink">Account connection</h3>
              <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-[#8b949e]">
                Connect through LinkedIn’s official OAuth flow. Crewlink requests only{' '}
                <span className="font-mono text-[#c9d1d9]">openid</span>,{' '}
                <span className="font-mono text-[#c9d1d9]">profile</span> and{' '}
                <span className="font-mono text-[#c9d1d9]">w_member_social</span> so it can
                identify the member and publish a personal text post. Organization page publishing
                needs separate LinkedIn approval and is not supported here.
              </p>
            </div>
            <span
              className={`flex-none rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] ${
                linkedinConnection
                  ? 'border-[#238636]/40 bg-[#238636]/15 text-[#3fb950]'
                  : 'border-line bg-panel-2 text-[#8b949e]'
              }`}
            >
              {linkedinConnection ? 'Connected' : 'Not connected'}
            </span>
          </div>

          {linkedinConnection ? (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[12px] text-[#c9d1d9]">
                  {linkedinConnection.externalAccountName || 'LinkedIn member'}
                  <span className="text-[#8b949e]">
                    {' '}
                    &middot; {linkedinConnection.externalAccountId}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => void handleVerifyLinkedIn(linkedinConnection.id)}
                  disabled={busy === 'verify:linkedin'}
                  className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'verify:linkedin' ? 'Verifying…' : 'Verify'}
                </button>
                <button
                  type="button"
                  onClick={handleConnectLinkedIn}
                  disabled={busy === 'connect:linkedin'}
                  className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'connect:linkedin' ? 'Opening LinkedIn…' : 'Reconnect'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDisconnect('linkedin', linkedinConnection.id)}
                  disabled={busy === 'disconnect:linkedin'}
                  className="h-8 rounded-md border border-[#da3633]/40 px-3 text-[12px] text-[#f85149] transition-colors hover:bg-[#da3633]/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'disconnect:linkedin' ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[#8b949e]">
                Scopes: {linkedinConnection.scopes.length ? linkedinConnection.scopes.join(', ') : 'not reported'}
                {linkedinTokenExpiry ? ` · Access token expires ${linkedinTokenExpiry}` : ''}.
                LinkedIn issues refresh tokens only to approved partners; otherwise reconnect when
                the token expires.
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-[#8b949e]">
                Switching to a different LinkedIn account revokes current approval for this platform.
                Reconnecting keeps the same project connection; it does not create a duplicate.
              </p>
            </>
          ) : (
            <button
              type="button"
              onClick={handleConnectLinkedIn}
              disabled={busy === 'connect:linkedin' || loading}
              className="mt-3 h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'connect:linkedin' ? 'Opening LinkedIn…' : 'Connect LinkedIn account'}
            </button>
          )}

          {connectErrors.linkedin && (
            <p className="mt-2 text-[11px] leading-relaxed text-[#f85149]">
              {connectErrors.linkedin}
            </p>
          )}
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-ink">Slack</h2>
          <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] text-[#8b949e]">
            Workspace bot &middot; official API
          </span>
        </div>
        <div className="rounded-[10px] border border-line bg-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-[13px] text-ink">Workspace installation</h3>
              <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-[#8b949e]">
                Connect through Slack’s official OAuth v2 flow. Crewlink requests only{' '}
                <span className="font-mono text-[#c9d1d9]">chat:write</span>,{' '}
                <span className="font-mono text-[#c9d1d9]">channels:read</span> and{' '}
                <span className="font-mono text-[#c9d1d9]">groups:read</span> so its bot can post
                to the channel you choose. Private channels appear only after you invite the
                Crewlink bot; your own Slack access is never used.
              </p>
            </div>
            <span
              className={`flex-none rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] ${
                slackConnection
                  ? 'border-[#238636]/40 bg-[#238636]/15 text-[#3fb950]'
                  : 'border-line bg-panel-2 text-[#8b949e]'
              }`}
            >
              {slackConnection ? 'Connected' : 'Not connected'}
            </span>
          </div>

          {slackConnection ? (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[12px] text-[#c9d1d9]">
                  {slackConnection.serverName || slackConnection.serverId || 'Slack workspace'}
                  <span className="text-[#8b949e]">
                    {' '}
                    &middot; bot{' '}
                    {slackConnection.externalAccountName || slackConnection.externalAccountId}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={() => void handleVerifySlack(slackConnection.id)}
                  disabled={busy === 'verify:slack'}
                  className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'verify:slack' ? 'Verifying…' : 'Verify'}
                </button>
                <button
                  type="button"
                  onClick={handleConnectSlack}
                  disabled={busy === 'connect:slack'}
                  className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'connect:slack' ? 'Opening Slack…' : 'Reconnect'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDisconnect('slack', slackConnection.id)}
                  disabled={busy === 'disconnect:slack'}
                  className="h-8 rounded-md border border-[#da3633]/40 px-3 text-[12px] text-[#f85149] transition-colors hover:bg-[#da3633]/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'disconnect:slack' ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-[#8b949e]">
                Scopes:{' '}
                {slackConnection.scopes.length
                  ? slackConnection.scopes.join(', ')
                  : 'not reported'}
                . Reconnecting keeps the same project connection; it does not create a duplicate.
              </p>

              <div className="mt-3 rounded-md border border-line-soft bg-canvas-inset p-3">
                <label
                  className="text-[11px] text-[#8b949e]"
                  htmlFor="slack-channel-select"
                >
                  Publish to channel
                </label>
                <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    id="slack-channel-select"
                    value={slackChannelChoice}
                    onChange={(event) => {
                      setSlackChannelChoice(event.target.value);
                      setSlackChannelsError(undefined);
                    }}
                    disabled={slackChannelsBusy || busy === 'slack:select'}
                    className="h-8 w-full min-w-0 rounded-md border border-line bg-panel px-2 text-[12px] text-ink sm:flex-1"
                  >
                    <option value="">Choose a channel…</option>
                    {slackConnection.channelId &&
                      !slackChannels.some(
                        (channel) => channel.id === slackConnection.channelId
                      ) && (
                        <option value={slackConnection.channelId}>
                          {slackConnection.channelName || slackConnection.channelId} (current)
                        </option>
                      )}
                    {slackChannels.map((channel) => (
                      <option
                        key={channel.id}
                        value={channel.id}
                        disabled={channel.isArchived || !channel.isMember}
                      >
                        #{channel.name}
                        {channel.isPrivate ? ' · private' : ''}
                        {channel.isArchived ? ' · archived' : ''}
                        {!channel.isMember ? ' · bot not a member' : ''}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void loadSlackChannels(slackConnection.id)}
                      disabled={slackChannelsBusy}
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {slackChannelsBusy ? 'Loading…' : 'Refresh'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSelectSlackChannel()}
                      disabled={
                        busy === 'slack:select' ||
                        slackChannelsBusy ||
                        !slackChannelChoice ||
                        slackChannelChoice === slackConnection.channelId
                      }
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === 'slack:select' ? 'Selecting…' : 'Use this channel'}
                    </button>
                  </div>
                </div>

                <p className="mt-2 text-[11px] text-[#c9d1d9]">
                  {slackConnection.channelId
                    ? `Selected: #${slackConnection.channelName || slackConnection.channelId}`
                    : 'No channel selected yet. Choose one before approving or publishing.'}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-[#8b949e]">
                  Private channels appear only after you invite the Crewlink bot in Slack. For
                  example, run <span className="font-mono text-[#c9d1d9]">/invite @Crewlink</span>{' '}
                  in that channel, then refresh this list. Crewlink never joins a channel on its
                  own.
                </p>
                {slackChannelsError && (
                  <p className="mt-2 text-[11px] leading-relaxed text-[#f85149]">
                    {slackChannelsError}
                  </p>
                )}
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-[#8b949e]">
                Changing the channel revokes current approvals for Slack. Approve the message again
                afterward. Media and file uploads are not supported in this version.
              </p>
            </>
          ) : (
            <button
              type="button"
              onClick={handleConnectSlack}
              disabled={busy === 'connect:slack' || loading}
              className="mt-3 h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'connect:slack' ? 'Opening Slack…' : 'Install Crewlink in Slack'}
            </button>
          )}

          {connectErrors.slack && (
            <p className="mt-2 text-[11px] leading-relaxed text-[#f85149]">{connectErrors.slack}</p>
          )}
        </div>
      </section>

      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-ink">X (Twitter)</h2>
          <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] text-[#8b949e]">
            Optional &middot; pay per post
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[10px] border border-line bg-panel p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[13px] text-ink">Manual Publishing — Free</h3>
              <span className="flex-none rounded-full border border-[#238636]/40 bg-[#238636]/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] text-[#3fb950]">
                $0
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[#8b949e]">
              Copy the approved text and post it yourself on X. Crewlink records only your
              confirmation and never claims it verified the post.
            </p>
            <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-[#8b949e]">
              <li>No X API access or account connection needed.</li>
              <li>Crewlink makes no network call to X on this path.</li>
            </ul>
          </div>

          <div className="rounded-[10px] border border-line bg-panel p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[13px] text-ink">
                Automatic Publishing — Requires paid X API access
              </h3>
              <span
                className={`flex-none rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] ${
                  xConnection
                    ? 'border-[#238636]/40 bg-[#238636]/15 text-[#3fb950]'
                    : 'border-line bg-panel-2 text-[#8b949e]'
                }`}
              >
                {xConnection ? 'Connected' : 'Not connected'}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[#8b949e]">
              Connect your X account through the official API. X charges the Crewlink app for each
              post; Crewlink shows an estimate and asks for confirmation before every publish.
            </p>

            {xConnection ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[12px] text-[#c9d1d9]">
                  @{xConnection.externalAccountName || xConnection.externalAccountId}
                </p>
                <button
                  type="button"
                  onClick={() => handleDisconnect('x', xConnection.id)}
                  disabled={busy === 'disconnect:x'}
                  className="h-8 rounded-md border border-[#da3633]/40 px-3 text-[12px] text-[#f85149] transition-colors hover:bg-[#da3633]/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'disconnect:x' ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleConnectX}
                disabled={busy === 'connect:x' || loading}
                className="mt-3 h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'connect:x' ? 'Opening X…' : 'Connect X account'}
              </button>
            )}

            {connectErrors.x && (
              <p className="mt-2 text-[11px] leading-relaxed text-[#f85149]">{connectErrors.x}</p>
            )}

            {xEstimateView && (
              <p className="mt-2 text-[11px] leading-relaxed text-[#8b949e]">
                Monthly budget: {formatUsd(xEstimateView.budget.spentMicros)} of{' '}
                {formatUsd(xEstimateView.budget.budgetMicros)} used &middot;{' '}
                {formatUsd(xEstimateView.budget.remainingMicros)} remaining. X bills the
                Crewlink-owned app.
              </p>
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-ink">Approved drafts</h2>
          <button
            type="button"
            onClick={() => handleGenerateDrafts()}
            disabled={busy === 'generate' || loading}
            className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'generate' ? 'Generating…' : 'Generate missing drafts'}
          </button>
        </div>

        {loading ? (
          <div className="rounded-[10px] border border-line bg-panel px-5 py-10 text-center text-[12px] text-[#8b949e]">
            Loading drafts…
          </div>
        ) : (
          <div className="space-y-4">
            {BOT_PLATFORMS.map((platformId) => {
              const platform = byId(platformId);
              const draft = drafts.find((item) => item.platformId === platformId);
              const connection = connections.find(
                (item) => item.platformId === platformId && item.status === 'active'
              );

              if (!draft) {
                return (
                  <div
                    key={platformId}
                    className="rounded-[10px] border border-dashed border-line-soft bg-panel px-5 py-8 text-center"
                  >
                    <h3 className="text-[13px] text-ink">No {platform?.name || platformId} draft yet</h3>
                    <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-[#8b949e]">
                      Generate drafts for Discord and Telegram, then approve the exact text before
                      publishing.
                    </p>
                  </div>
                );
              }

              const text = draftEdits[draft.id] ?? draft.text;
              const dirty = text !== draft.text;
              const state = publicationStateFor(draft, draft.publication);
              const errors = draft.checks.filter((check) => check.level === 'error');
              const warnings = draft.checks.filter((check) => check.level === 'warning');
              const locked =
                state.kind === 'published' || state.kind === 'sending' || state.kind === 'uncertain';
              const hasConnection = Boolean(connection?.channelId);
              const overLimit = platform ? text.length > platform.characterLimit : false;
              const publishing = busy === `publish:${draft.id}`;
              const approving = busy === `approve:${draft.id}`;
              const saving = busy === `save:${draft.id}`;

              return (
                <article key={draft.id} className="rounded-[10px] border border-line bg-panel p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[13px] font-semibold text-ink">
                        {platform?.name || platformId}
                      </h3>
                      <span
                        className={`text-[11px] ${overLimit ? 'text-[#f85149]' : 'text-[#8b949e]'}`}
                      >
                        {text.length}/{platform?.characterLimit ?? '—'}
                      </span>
                    </div>
                    <StatusBadge state={state} />
                  </div>

                  {connection?.channelName || connection?.channelId ? (
                    <p className="mt-0.5 text-[11px] text-[#8b949e]">
                      Destination: {connection.channelName || connection.channelId}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-[#e3b341]">
                      Connect a channel above before publishing.
                    </p>
                  )}

                  <textarea
                    value={text}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraftEdits((prev) => ({ ...prev, [draft.id]: value }));
                    }}
                    rows={7}
                    disabled={locked}
                    className="mt-3 w-full resize-y rounded-md border border-line bg-canvas-inset px-3 py-2 font-mono text-[12px] leading-relaxed text-ink disabled:opacity-70"
                    aria-label={`${platform?.name || platformId} draft text`}
                  />

                  {(errors.length > 0 || warnings.length > 0) && (
                    <ul className="mt-2 space-y-1">
                      {errors.map((check) => (
                        <li key={check.code} className="text-[11px] text-[#f85149]">
                          {check.message}
                        </li>
                      ))}
                      {warnings.map((check) => (
                        <li key={check.code} className="text-[11px] text-[#e3b341]">
                          {check.message}
                        </li>
                      ))}
                    </ul>
                  )}

                  {(state.kind === 'failed' || state.kind === 'uncertain' || state.kind === 'published') &&
                    state.detail && (
                      <p
                        className={`mt-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed ${
                          state.kind === 'published'
                            ? 'border-[#238636]/40 bg-[#238636]/10 text-[#3fb950]'
                            : state.kind === 'failed'
                              ? 'border-[#da3633]/40 bg-[#da3633]/10 text-[#f85149]'
                              : 'border-[#d29922]/40 bg-[#d29922]/10 text-[#e3b341]'
                        }`}
                      >
                        {state.detail}
                      </p>
                    )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveDraft(draft)}
                      disabled={!dirty || locked || saving}
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleApproveDraft(draft.id)}
                      disabled={dirty || errors.length > 0 || locked || approving || draft.status === 'approved'}
                      title={errors.length > 0 ? 'Fix errors before approving.' : undefined}
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {approving ? 'Approving…' : draft.status === 'approved' ? 'Approved' : 'Approve text'}
                    </button>

                    {state.canPublish && (
                      <button
                        type="button"
                        onClick={() => handlePublishDraft(draft)}
                        disabled={!hasConnection || dirty || publishing}
                        title={
                          !hasConnection
                            ? 'Connect a channel above before publishing.'
                            : dirty
                              ? 'Save your changes before publishing.'
                              : undefined
                        }
                        className="h-8 rounded-md border border-success bg-success px-4 text-[12px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {publishing ? 'Publishing…' : state.canRetry ? 'Retry publish' : 'Publish now'}
                      </button>
                    )}

                    {state.kind === 'sending' && (
                      <button
                        type="button"
                        disabled
                        className="h-8 cursor-not-allowed rounded-md border border-line px-4 text-[12px] text-[#8b949e] opacity-70"
                      >
                        Publishing…
                      </button>
                    )}

                    {dirty && (
                      <span className="text-[11px] text-[#8b949e]">
                        Unsaved changes — save before approving or publishing.
                      </span>
                    )}
                  </div>
                </article>
              );
            })}

            {(() => {
              const draft = xDraft;
              if (!draft) {
                return (
                  <div
                    key="x-empty"
                    className="rounded-[10px] border border-dashed border-line-soft bg-panel px-5 py-8 text-center"
                  >
                    <h3 className="text-[13px] text-ink">No X draft yet</h3>
                    <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-[#8b949e]">
                      Generate an X draft, then edit and approve it. Manual publishing is free;
                      automatic publishing needs a connected X account and a confirmed estimate.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleGenerateDrafts(['x'])}
                      disabled={busy === 'generate' || loading}
                      className="mt-3 h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === 'generate' ? 'Generating…' : 'Generate X draft'}
                    </button>
                  </div>
                );
              }

              const parts = xPartsFor(draft);
              const text = threadText(parts);
              const dirty = text !== draft.text;
              const state = draft.publicationState;
              const errors = draft.checks.filter((check) => check.level === 'error');
              const warnings = draft.checks.filter((check) => check.level === 'warning');
              const locked =
                state.kind === 'published' || state.kind === 'sending' || state.kind === 'uncertain';
              const saving = busy === `save:${draft.id}`;
              const approving = busy === `approve:${draft.id}`;
              const publishing = busy === `publish:${draft.id}`;
              const markingManual = busy === `manual:${draft.id}`;
              const localEstimate = estimateXThread(parts);
              const blank = parts.some((part) => !part.trim());
              const overLimit = parts.some(
                (part) => xTextMetrics(part).weightedLength > X_WEIGHTED_LIMIT
              );
              const automaticConfigured = xEstimateView?.automaticConfigured ?? false;
              const budget = xEstimateView?.budget;
              const budgetBlocks = budget
                ? localEstimate.costMicros > budget.remainingMicros
                : false;
              const hasManualBlock =
                !locked &&
                !dirty &&
                draft.status === 'approved' &&
                !(draft.publication?.externalIds?.length ?? 0);
              const canAuto =
                state.canPublish &&
                Boolean(xConnection) &&
                automaticConfigured &&
                !dirty &&
                !blank &&
                !overLimit &&
                !budgetBlocks;

              return (
                <article key={draft.id} className="rounded-[10px] border border-line bg-panel p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[13px] font-semibold text-ink">X (Twitter)</h3>
                      <span
                        className={`text-[11px] ${
                          blank || overLimit ? 'text-[#f85149]' : 'text-[#8b949e]'
                        }`}
                      >
                        {parts.length} {parts.length === 1 ? 'post' : 'posts'}
                      </span>
                    </div>
                    <StatusBadge state={state} />
                  </div>

                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#8b949e]">
                    Manual publishing is free. Automatic publishing is billed per post by X and
                    requires a connected account.
                  </p>

                  {parts.map((part, index) => {
                    const metrics = xTextMetrics(part);
                    return (
                      <div
                        key={index}
                        className="mt-3 rounded-md border border-line-soft bg-canvas-inset p-2"
                      >
                        <div className="flex items-center justify-between gap-2 px-1 pb-1">
                          <span className="text-[11px] text-[#8b949e]">Post {index + 1}</span>
                          <span
                            className={`text-[11px] ${
                              metrics.weightedLength > X_WEIGHTED_LIMIT
                                ? 'text-[#f85149]'
                                : 'text-[#8b949e]'
                            }`}
                          >
                            {metrics.weightedLength}/{X_WEIGHTED_LIMIT}
                          </span>
                        </div>
                        <textarea
                          value={part}
                          onChange={(event) =>
                            updateThreadPart(draft.id, index, event.target.value)
                          }
                          rows={3}
                          disabled={locked}
                          className="w-full resize-y rounded-md border border-line bg-canvas-inset px-3 py-2 font-mono text-[12px] leading-relaxed text-ink disabled:opacity-70"
                          aria-label={`X post ${index + 1}`}
                        />
                        {parts.length > 1 && !locked && (
                          <div className="mt-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => removeThreadPart(draft.id, index)}
                              className="text-[11px] text-[#f85149] hover:underline"
                            >
                              Remove post
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {!locked && parts.length < X_MAX_THREAD_PARTS && (
                    <button
                      type="button"
                      onClick={() => addThreadPart(draft.id)}
                      className="mt-2 text-[11px] text-[#58a6ff] hover:underline"
                    >
                      + Add another post
                    </button>
                  )}
                  <p className="mt-1 text-[10px] leading-relaxed text-[#8b949e]">
                    X counts links as 23 characters and emoji or CJK characters as 2. Threads are
                    posted in order, each as a reply to the one before it.
                  </p>

                  {(errors.length > 0 || warnings.length > 0) && (
                    <ul className="mt-2 space-y-1">
                      {errors.map((check) => (
                        <li key={check.code} className="text-[11px] text-[#f85149]">
                          {check.message}
                        </li>
                      ))}
                      {warnings.map((check) => (
                        <li key={check.code} className="text-[11px] text-[#e3b341]">
                          {check.message}
                        </li>
                      ))}
                    </ul>
                  )}

                  {(state.kind === 'failed' || state.kind === 'uncertain' || state.kind === 'published') &&
                    state.detail && (
                      <p
                        className={`mt-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed ${
                          state.kind === 'published'
                            ? 'border-[#238636]/40 bg-[#238636]/10 text-[#3fb950]'
                            : state.kind === 'failed'
                              ? 'border-[#da3633]/40 bg-[#da3633]/10 text-[#f85149]'
                              : 'border-[#d29922]/40 bg-[#d29922]/10 text-[#e3b341]'
                        }`}
                      >
                        {state.detail}
                      </p>
                    )}

                  <div className="mt-3 rounded-md border border-line-soft bg-panel-2 px-3 py-2 text-[11px] leading-relaxed text-[#8b949e]">
                    <p className="text-[#c9d1d9]">
                      Automatic estimate: {localEstimate.requests}{' '}
                      {localEstimate.requests === 1 ? 'request' : 'requests'} &middot;{' '}
                      {formatUsd(localEstimate.costMicros)}
                      {budget
                        ? ` · ${formatUsd(budget.remainingMicros)} of ${formatUsd(
                            budget.budgetMicros
                          )} budget remaining`
                        : ''}
                    </p>
                    <p className="mt-0.5">{localEstimate.disclaimer}</p>
                    <p className="mt-0.5">
                      Manual publishing: $0. Crewlink makes no X API call on the manual path.{' '}
                      <a
                        href={localEstimate.source}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-[#f0f6fc]"
                      >
                        X’s published pricing
                      </a>{' '}
                      (verified {localEstimate.verifiedAt}).
                    </p>
                    {!automaticConfigured && (
                      <p className="mt-1 text-[#e3b341]">
                        Automatic X publishing is not configured on this server. Manual publishing
                        still works.
                      </p>
                    )}
                    {automaticConfigured && !xConnection && (
                      <p className="mt-1 text-[#e3b341]">
                        Connect an X account above to use automatic publishing.
                      </p>
                    )}
                    {budgetBlocks && (
                      <p className="mt-1 text-[#e3b341]">
                        This estimate exceeds the remaining monthly budget, so automatic publishing
                        is blocked. Manual publishing is still free.
                      </p>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveDraft(draft)}
                      disabled={!dirty || blank || locked || saving}
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleApproveDraft(draft.id)}
                      disabled={dirty || errors.length > 0 || locked || approving || draft.status === 'approved'}
                      title={errors.length > 0 ? 'Fix errors before approving.' : undefined}
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {approving ? 'Approving…' : draft.status === 'approved' ? 'Approved' : 'Approve text'}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void copyText(
                          parts[0],
                          'Post copied. Paste it into X and publish there.'
                        )
                      }
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc]"
                    >
                      Copy post
                    </button>

                    {parts.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          void copyText(
                            text,
                            'Thread copied. Post each part in order on X.'
                          )
                        }
                        className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc]"
                      >
                        Copy thread
                      </button>
                    )}

                    <a
                      href={`${X_INTENT_URL}${encodeURIComponent(parts[0])}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc]"
                    >
                      Open X composer
                    </a>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
                    <button
                      type="button"
                      onClick={() => handleManualPublished(draft)}
                      disabled={!hasManualBlock || markingManual}
                      title={
                        draft.status !== 'approved'
                          ? 'Approve the text before marking it published.'
                          : dirty
                            ? 'Save your changes before marking it published.'
                            : undefined
                      }
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {markingManual ? 'Recording…' : 'Mark as published — free'}
                    </button>

                    {state.canPublish && (
                      <button
                        type="button"
                        onClick={() => handlePublishX(draft)}
                        disabled={!canAuto || publishing}
                        title={
                          !automaticConfigured
                            ? 'Automatic X publishing is not configured on this server.'
                            : !xConnection
                              ? 'Connect an X account first.'
                              : dirty
                                ? 'Save your changes before publishing.'
                                : budgetBlocks
                                  ? 'This exceeds the remaining monthly budget.'
                                  : !state.canPublish
                                    ? 'Approve the text before publishing.'
                                    : undefined
                        }
                        className="h-8 rounded-md border border-success bg-success px-4 text-[12px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {publishing
                          ? 'Publishing…'
                          : state.canRetry
                            ? 'Retry automatic publish'
                            : 'Publish automatically'}
                      </button>
                    )}

                    {state.kind === 'sending' && (
                      <button
                        type="button"
                        disabled
                        className="h-8 cursor-not-allowed rounded-md border border-line px-4 text-[12px] text-[#8b949e] opacity-70"
                      >
                        Publishing…
                      </button>
                    )}

                    {dirty && (
                      <span className="text-[11px] text-[#8b949e]">
                        Unsaved changes — save before approving or publishing.
                      </span>
                    )}
                  </div>
                </article>
              );
            })()}

            {(() => {
              const draft = redditDraft;
              if (!draft) {
                return (
                  <div
                    key="reddit-empty"
                    className="rounded-[10px] border border-dashed border-line-soft bg-panel px-5 py-8 text-center"
                  >
                    <h3 className="text-[13px] text-ink">No Reddit draft yet</h3>
                    <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-[#8b949e]">
                      Generate a Reddit draft, search for a subreddit, validate the submission, then
                      approve and publish it.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleGenerateDrafts(['reddit'])}
                      disabled={busy === 'generate' || loading}
                      className="mt-3 h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === 'generate' ? 'Generating…' : 'Generate Reddit draft'}
                    </button>
                  </div>
                );
              }

              const fields = redditEdits[draft.id] ?? redditFieldsFrom(draft);
              const dirty =
                fields.title !== (draft.title ?? '') ||
                fields.subreddit !== (draft.subreddit ?? '') ||
                fields.submissionType !== (draft.submissionType === 'link' ? 'link' : 'self') ||
                fields.linkUrl !== (draft.linkUrl ?? '') ||
                fields.text !== draft.text;
              const state = draft.publicationState;
              const errors = draft.checks.filter((check) => check.level === 'error');
              const warnings = draft.checks.filter((check) => check.level === 'warning');
              const liveErrors = (redditLive?.checks ?? []).filter(
                (check) => check.level === 'error'
              );
              const liveWarnings = (redditLive?.checks ?? []).filter(
                (check) => check.level === 'warning'
              );
              const locked =
                state.kind === 'published' || state.kind === 'sending' || state.kind === 'uncertain';
              const saving = busy === `save:${draft.id}`;
              const approving = busy === `approve:${draft.id}`;
              const validating = busy === `validate:${draft.id}`;
              const publishing = busy === `publish:${draft.id}`;
              const titleLength = fields.title.trim().length;
              const subredditName = fields.subreddit.trim().replace(/^\/?r\//i, '');
              const subredditValid = /^[A-Za-z0-9_]{2,21}$/.test(subredditName);
              const previewName = subredditName || 'subreddit';
              const previewAccount =
                redditConnection?.externalAccountName ||
                redditConnection?.externalAccountId ||
                'your_account';
              const publishedSubreddit =
                draft.publication?.status === 'published'
                  ? draft.publication.targetName
                  : undefined;
              const publishedUrl =
                draft.publication?.status === 'published'
                  ? draft.publication.externalUrl
                  : undefined;
              const requirements = redditDetails?.requirements;

              return (
                <article key={draft.id} className="rounded-[10px] border border-line bg-panel p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[13px] font-semibold text-ink">Reddit</h3>
                      <span className="text-[11px] text-[#8b949e]">
                        {titleLength}/{REDDIT_TITLE_LIMIT} title · {fields.text.length}/
                        {REDDIT_BODY_LIMIT} body
                      </span>
                    </div>
                    <StatusBadge state={state} />
                  </div>

                  {redditConnection ? (
                    <p className="mt-0.5 text-[11px] text-[#8b949e]">
                      Posting as u/{previewAccount} through Reddit’s official API.
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-[#e3b341]">
                      Connect a Reddit account above before searching or publishing.
                    </p>
                  )}

                  {publishedSubreddit && (
                    <p className="mt-1 text-[11px] text-[#8b949e]">
                      Published to r/{publishedSubreddit}
                      {publishedUrl && (
                        <>
                          {' · '}
                          <a
                            href={publishedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#58a6ff] underline hover:text-[#f0f6fc]"
                          >
                            View on Reddit
                          </a>
                        </>
                      )}
                    </p>
                  )}

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-[11px] text-[#8b949e]" htmlFor={`reddit-sub-${draft.id}`}>
                        Subreddit
                      </label>
                      <input
                        id={`reddit-sub-${draft.id}`}
                        value={fields.subreddit}
                        onChange={(event) =>
                          updateRedditField(draft.id, { subreddit: event.target.value })
                        }
                        disabled={locked}
                        placeholder="e.g. opensource"
                        className="mt-1 h-8 w-full rounded-md border border-line bg-canvas-inset px-2.5 text-[12px] text-ink disabled:opacity-70"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#8b949e]" htmlFor={`reddit-search-${draft.id}`}>
                        Search subreddits
                      </label>
                      <div className="mt-1 flex gap-2">
                        <input
                          id={`reddit-search-${draft.id}`}
                          value={redditSearch}
                          onChange={(event) => setRedditSearch(event.target.value)}
                          placeholder="Name or keyword"
                          className="h-8 w-full min-w-0 rounded-md border border-line bg-canvas-inset px-2.5 text-[12px] text-ink"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSearchSubreddits()}
                          disabled={redditSearchBusy || !redditConnection}
                          className="h-8 flex-none rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {redditSearchBusy ? 'Searching…' : 'Search'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {redditResults.length > 0 && (
                    <ul className="mt-2 divide-y divide-line-soft rounded-md border border-line-soft bg-canvas-inset">
                      {redditResults.slice(0, 8).map((result) => (
                        <li key={result.name}>
                          <button
                            type="button"
                            onClick={() => void handleSelectSubreddit(draft, result.name)}
                            disabled={locked || redditDetailsBusy}
                            className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-[11px] transition-colors hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <span className="min-w-0">
                              <span className="text-[#c9d1d9]">r/{result.name}</span>
                              {result.title && (
                                <span className="ml-2 text-[#8b949e]">{result.title}</span>
                              )}
                            </span>
                            <span className="flex-none text-[#8b949e]">
                              {typeof result.subscribers === 'number'
                                ? `${result.subscribers.toLocaleString()} members`
                                : ''}
                              {result.submissionType ? ` · ${result.submissionType} posts` : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {redditDetailsBusy && (
                    <p className="mt-2 text-[11px] text-[#8b949e]">Loading subreddit details…</p>
                  )}

                  {redditDetails && (
                    <div className="mt-2 rounded-md border border-line-soft bg-panel-2 px-3 py-2 text-[11px] leading-relaxed text-[#8b949e]">
                      <p className="text-[#c9d1d9]">
                        r/{redditDetails.subreddit.name}
                        {redditDetails.subreddit.title ? ` · ${redditDetails.subreddit.title}` : ''}
                      </p>
                      <p className="mt-0.5">
                        {typeof redditDetails.subreddit.subscribers === 'number'
                          ? `${redditDetails.subreddit.subscribers.toLocaleString()} members · `
                          : ''}
                        {redditDetails.subreddit.subredditType || 'unknown'} community ·{' '}
                        {redditDetails.subreddit.submissionType || 'unknown'} submissions
                        {redditDetails.subreddit.over18 ? ' · 18+' : ''}
                      </p>
                      {redditDetails.subreddit.description && (
                        <p className="mt-1 whitespace-pre-line">
                          {redditDetails.subreddit.description.slice(0, 400)}
                        </p>
                      )}
                      {redditDetails.rules.length > 0 && (
                        <div className="mt-1">
                          <p className="text-[#c9d1d9]">Community rules</p>
                          <ul className="mt-0.5 space-y-0.5">
                            {redditDetails.rules.slice(0, 6).map((rule, index) => (
                              <li key={`${rule.name}-${index}`}>· {rule.name}</li>
                            ))}
                          </ul>
                          <p className="mt-0.5">
                            Crewlink cannot verify every rule. A moderator can still remove the post.
                          </p>
                        </div>
                      )}
                      {requirements && (
                        <div className="mt-1">
                          <p className="text-[#c9d1d9]">Posting requirements reported by Reddit</p>
                          <ul className="mt-0.5 space-y-0.5">
                            {(requirements.titleMinLength ?? 0) > 0 && (
                              <li>· Title at least {requirements.titleMinLength} characters</li>
                            )}
                            {(requirements.titleMaxLength ?? 0) > 0 && (
                              <li>· Title at most {requirements.titleMaxLength} characters</li>
                            )}
                            {(requirements.bodyMinLength ?? 0) > 0 && (
                              <li>· Body at least {requirements.bodyMinLength} characters</li>
                            )}
                            {(requirements.bodyMaxLength ?? 0) > 0 && (
                              <li>· Body at most {requirements.bodyMaxLength} characters</li>
                            )}
                            {requirements.linkRestrictionPolicy && (
                              <li>· Link policy: {requirements.linkRestrictionPolicy}</li>
                            )}
                            {requirements.flairRequired && (
                              <li className="text-[#e3b341]">
                                · This community requires flair. Crewlink cannot set flair, so
                                automatic publishing is blocked.
                              </li>
                            )}
                            {requirements.galleryRequired && (
                              <li className="text-[#e3b341]">
                                · This community requires a gallery post. Crewlink can only submit
                                text or link posts.
                              </li>
                            )}
                            {requirements.domainWhitelist?.length ? (
                              <li>· Allowed domains: {requirements.domainWhitelist.join(', ')}</li>
                            ) : null}
                            {requirements.domainBlacklist?.length ? (
                              <li>· Blocked domains: {requirements.domainBlacklist.join(', ')}</li>
                            ) : null}
                            {requirements.titleRequiredStrings?.length ? (
                              <li>
                                · Title must contain: {requirements.titleRequiredStrings.join(', ')}
                              </li>
                            ) : null}
                            {requirements.titleBlacklistedStrings?.length ? (
                              <li>
                                · Title cannot contain:{' '}
                                {requirements.titleBlacklistedStrings.join(', ')}
                              </li>
                            ) : null}
                            {requirements.bodyRequiredStrings?.length ? (
                              <li>
                                · Body must contain: {requirements.bodyRequiredStrings.join(', ')}
                              </li>
                            ) : null}
                            {requirements.bodyBlacklistedStrings?.length ? (
                              <li>
                                · Body cannot contain:{' '}
                                {requirements.bodyBlacklistedStrings.join(', ')}
                              </li>
                            ) : null}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {redditNotice && (
                    <p className="mt-2 text-[11px] leading-relaxed text-[#e3b341]">
                      {redditNotice}
                    </p>
                  )}

                  <div className="mt-3">
                    <p className="text-[11px] text-[#8b949e]">Submission type</p>
                    <div className="mt-1 flex gap-2">
                      {(['self', 'link'] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => updateRedditField(draft.id, { submissionType: kind })}
                          disabled={locked}
                          className={`h-8 rounded-md border px-3 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            fields.submissionType === kind
                              ? 'border-[#6e7681] bg-panel-2 text-[#f0f6fc]'
                              : 'border-line text-[#c9d1d9] hover:border-[#6e7681] hover:text-[#f0f6fc]'
                          }`}
                        >
                          {kind === 'self' ? 'Text post' : 'Link post'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[11px] text-[#8b949e]" htmlFor={`reddit-title-${draft.id}`}>
                        Title
                      </label>
                      <span
                        className={`text-[11px] ${
                          titleLength > REDDIT_TITLE_LIMIT ? 'text-[#f85149]' : 'text-[#8b949e]'
                        }`}
                      >
                        {titleLength}/{REDDIT_TITLE_LIMIT}
                      </span>
                    </div>
                    <input
                      id={`reddit-title-${draft.id}`}
                      value={fields.title}
                      onChange={(event) => updateRedditField(draft.id, { title: event.target.value })}
                      disabled={locked}
                      className="mt-1 h-8 w-full rounded-md border border-line bg-canvas-inset px-2.5 text-[12px] text-ink disabled:opacity-70"
                    />
                  </div>

                  {fields.submissionType === 'link' && (
                    <div className="mt-3">
                      <label className="text-[11px] text-[#8b949e]" htmlFor={`reddit-link-${draft.id}`}>
                        Link URL
                      </label>
                      <input
                        id={`reddit-link-${draft.id}`}
                        value={fields.linkUrl}
                        onChange={(event) =>
                          updateRedditField(draft.id, { linkUrl: event.target.value })
                        }
                        disabled={locked}
                        placeholder="https://…"
                        className="mt-1 h-8 w-full rounded-md border border-line bg-canvas-inset px-2.5 text-[12px] text-ink disabled:opacity-70"
                      />
                    </div>
                  )}

                  <div
                    className={`mt-3 grid gap-3 ${
                      fields.submissionType === 'self' ? 'md:grid-cols-2' : ''
                    }`}
                  >
                    {/* Link submissions send only the URL; Reddit ignores body text. */}
                    {fields.submissionType === 'self' && (
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <label
                            className="text-[11px] text-[#8b949e]"
                            htmlFor={`reddit-body-${draft.id}`}
                          >
                            Body
                          </label>
                          <span
                            className={`text-[11px] ${
                              fields.text.length > REDDIT_BODY_LIMIT
                                ? 'text-[#f85149]'
                                : 'text-[#8b949e]'
                            }`}
                          >
                            {fields.text.length}/{REDDIT_BODY_LIMIT}
                          </span>
                        </div>
                        <textarea
                          id={`reddit-body-${draft.id}`}
                          value={fields.text}
                          onChange={(event) =>
                            updateRedditField(draft.id, { text: event.target.value })
                          }
                          rows={10}
                          disabled={locked}
                          className="mt-1 w-full resize-y rounded-md border border-line bg-canvas-inset px-3 py-2 font-mono text-[12px] leading-relaxed text-ink disabled:opacity-70"
                        />
                        <p className="mt-1 text-[10px] text-[#8b949e]">
                          Markdown is supported. The preview escapes HTML and links only http(s).
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-[11px] text-[#8b949e]">Reddit-style preview</p>
                      <div className="mt-1 rounded-md border border-line bg-canvas-inset p-3">
                        <p className="text-[10px] text-[#8b949e]">
                          r/{previewName} · Posted by u/{previewAccount}
                        </p>
                        <p className="mt-1 text-[13px] font-medium leading-snug text-[#f0f6fc]">
                          {fields.title.trim() || 'Your title appears here'}
                        </p>
                        {fields.submissionType === 'link' ? (
                          <a
                            href={fields.linkUrl.trim() || '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block truncate text-[11px] text-[#58a6ff] underline"
                          >
                            {fields.linkUrl.trim() || 'https://example.com'}
                          </a>
                        ) : fields.text.trim() ? (
                          <div
                            className="mt-1 text-[12px] leading-relaxed text-[#c9d1d9] [&_a]:text-[#58a6ff] [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-[#8b949e] [&_code]:rounded [&_code]:bg-panel-2 [&_code]:px-1 [&_code]:font-mono [&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-[14px] [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-[12px] [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:ml-4 [&_ol]:list-decimal [&_p]:mt-1 [&_pre]:mt-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-panel-2 [&_pre]:p-2 [&_pre]:font-mono [&_ul]:ml-4 [&_ul]:list-disc"
                            dangerouslySetInnerHTML={{
                              __html: renderMarkdownPreview(fields.text),
                            }}
                          />
                        ) : (
                          <p className="mt-1 text-[11px] text-[#8b949e]">No body text yet.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {(errors.length > 0 || warnings.length > 0) && (
                    <ul className="mt-2 space-y-1">
                      {errors.map((check) => (
                        <li key={check.code} className="text-[11px] text-[#f85149]">
                          {check.message}
                        </li>
                      ))}
                      {warnings.map((check) => (
                        <li key={check.code} className="text-[11px] text-[#e3b341]">
                          {check.message}
                        </li>
                      ))}
                    </ul>
                  )}

                  {redditLive && (
                    <div className="mt-2 rounded-md border border-line-soft bg-panel-2 px-3 py-2 text-[11px] leading-relaxed">
                      {(liveErrors.length > 0 || liveWarnings.length > 0) && (
                        <ul className="space-y-1">
                          {liveErrors.map((check) => (
                            <li key={`live-${check.code}`} className="text-[#f85149]">
                              {check.message}
                            </li>
                          ))}
                          {liveWarnings.map((check) => (
                            <li key={`live-${check.code}`} className="text-[#e3b341]">
                              {check.message}
                            </li>
                          ))}
                        </ul>
                      )}
                      {redditLive.unverifiable.length > 0 && (
                        <div className="mt-1 text-[#8b949e]">
                          <p className="text-[#c9d1d9]">Crewlink cannot verify</p>
                          <ul className="mt-0.5 space-y-0.5">
                            {redditLive.unverifiable.map((item) => (
                              <li key={item}>· {item}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <p className="mt-1 text-[#8b949e]">
                        Passing these checks does not guarantee a moderator will accept the post.
                      </p>
                    </div>
                  )}

                  {(state.kind === 'failed' || state.kind === 'uncertain' || state.kind === 'published') &&
                    state.detail && (
                      <p
                        className={`mt-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed ${
                          state.kind === 'published'
                            ? 'border-[#238636]/40 bg-[#238636]/10 text-[#3fb950]'
                            : state.kind === 'failed'
                              ? 'border-[#da3633]/40 bg-[#da3633]/10 text-[#f85149]'
                              : 'border-[#d29922]/40 bg-[#d29922]/10 text-[#e3b341]'
                        }`}
                      >
                        {state.detail}
                      </p>
                    )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSaveReddit(draft)}
                      disabled={!dirty || locked || saving}
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleValidateReddit(draft)}
                      disabled={
                        dirty || errors.length > 0 || locked || validating || !redditConnection || !subredditValid
                      }
                      title={
                        !redditConnection
                          ? 'Connect a Reddit account first.'
                          : dirty
                            ? 'Save your changes before validating.'
                            : !subredditValid
                              ? 'Choose a valid subreddit first.'
                              : errors.length > 0
                                ? 'Fix errors before validating.'
                                : undefined
                      }
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {validating ? 'Validating…' : 'Validate with Reddit'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleApproveDraft(draft.id)}
                      disabled={
                        dirty ||
                        errors.length > 0 ||
                        liveErrors.length > 0 ||
                        locked ||
                        approving ||
                        draft.status === 'approved'
                      }
                      title={
                        errors.length > 0 || liveErrors.length > 0
                          ? 'Fix errors before approving.'
                          : dirty
                            ? 'Save your changes before approving.'
                            : undefined
                      }
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {approving ? 'Approving…' : draft.status === 'approved' ? 'Approved' : 'Approve submission'}
                    </button>

                    {state.canPublish && (
                      <button
                        type="button"
                        onClick={() => handlePublishDraft(draft)}
                        disabled={
                          !redditConnection || dirty || publishing || liveErrors.length > 0
                        }
                        title={
                          !redditConnection
                            ? 'Connect a Reddit account first.'
                            : dirty
                              ? 'Save your changes before publishing.'
                              : liveErrors.length > 0
                                ? 'Fix the Reddit validation errors first.'
                                : undefined
                        }
                        className="h-8 rounded-md border border-success bg-success px-4 text-[12px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {publishing ? 'Publishing…' : state.canRetry ? 'Retry publish' : 'Publish to Reddit'}
                      </button>
                    )}

                    {state.kind === 'sending' && (
                      <button
                        type="button"
                        disabled
                        className="h-8 cursor-not-allowed rounded-md border border-line px-4 text-[12px] text-[#8b949e] opacity-70"
                      >
                        Publishing…
                      </button>
                    )}

                    {dirty && (
                      <span className="text-[11px] text-[#8b949e]">
                        Unsaved changes — save before validating, approving or publishing.
                      </span>
                    )}
                  </div>
                </article>
              );
            })()}

            {(() => {
              const draft = linkedinDraft;
              if (!draft) {
                return (
                  <div
                    key="linkedin-empty"
                    className="rounded-[10px] border border-dashed border-line-soft bg-panel px-5 py-8 text-center"
                  >
                    <h3 className="text-[13px] text-ink">No LinkedIn draft yet</h3>
                    <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-[#8b949e]">
                      Generate a LinkedIn draft, edit and preview it, then approve and publish it
                      through your connected member account.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleGenerateDrafts(['linkedin'])}
                      disabled={busy === 'generate' || loading}
                      className="mt-3 h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === 'generate' ? 'Generating…' : 'Generate LinkedIn draft'}
                    </button>
                  </div>
                );
              }

              const text = draftEdits[draft.id] ?? draft.text;
              const dirty = text !== draft.text;
              const state = draft.publicationState;
              const errors = draft.checks.filter((check) => check.level === 'error');
              const warnings = draft.checks.filter((check) => check.level === 'warning');
              const locked =
                state.kind === 'published' || state.kind === 'sending' || state.kind === 'uncertain';
              const saving = busy === `save:${draft.id}`;
              const approving = busy === `approve:${draft.id}`;
              const publishing = busy === `publish:${draft.id}`;
              const overLimit = text.length > LINKEDIN_POST_LIMIT;
              const authorName =
                linkedinConnection?.externalAccountName || 'Your LinkedIn profile';
              const initials = authorName
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase() ?? '')
                .join('');
              const publishedUrl =
                draft.publication?.status === 'published'
                  ? draft.publication.externalUrl
                  : undefined;

              return (
                <article key={draft.id} className="rounded-[10px] border border-line bg-panel p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[13px] font-semibold text-ink">LinkedIn</h3>
                      <span
                        className={`text-[11px] ${overLimit ? 'text-[#f85149]' : 'text-[#8b949e]'}`}
                      >
                        {text.length}/{LINKEDIN_POST_LIMIT}
                      </span>
                    </div>
                    <StatusBadge state={state} />
                  </div>

                  {linkedinConnection ? (
                    <p className="mt-0.5 text-[11px] text-[#8b949e]">
                      Posting as {authorName} through LinkedIn’s official Posts API.
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-[#e3b341]">
                      Connect a LinkedIn account above before publishing.
                    </p>
                  )}

                  {publishedUrl && (
                    <p className="mt-1 text-[11px] text-[#8b949e]">
                      <a
                        href={publishedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#58a6ff] underline hover:text-[#f0f6fc]"
                      >
                        View on LinkedIn
                      </a>
                    </p>
                  )}

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <label
                          className="text-[11px] text-[#8b949e]"
                          htmlFor={`linkedin-text-${draft.id}`}
                        >
                          Post text
                        </label>
                        <span
                          className={`text-[11px] ${overLimit ? 'text-[#f85149]' : 'text-[#8b949e]'}`}
                        >
                          {text.length}/{LINKEDIN_POST_LIMIT}
                        </span>
                      </div>
                      <textarea
                        id={`linkedin-text-${draft.id}`}
                        value={text}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDraftEdits((prev) => ({ ...prev, [draft.id]: value }));
                        }}
                        rows={10}
                        disabled={locked}
                        className="mt-1 w-full resize-y rounded-md border border-line bg-canvas-inset px-3 py-2 font-mono text-[12px] leading-relaxed text-ink disabled:opacity-70"
                      />
                      <p className="mt-1 text-[10px] text-[#8b949e]">
                        Plain text. LinkedIn applies its own formatting; media posts are not
                        supported in this version.
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#8b949e]">LinkedIn-style preview</p>
                      <div className="mt-1 rounded-md border border-line bg-canvas-inset p-3">
                        <div className="flex items-start gap-2">
                          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-panel-2 text-[12px] text-[#c9d1d9]">
                            {initials || 'in'}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-semibold text-[#f0f6fc]">
                              {authorName}
                            </p>
                            <p className="text-[10px] text-[#8b949e]">Just now &middot; Public</p>
                          </div>
                        </div>
                        <p className="mt-2 whitespace-pre-line break-words text-[12px] leading-relaxed text-[#c9d1d9]">
                          {text.trim() || 'Your post preview appears here.'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {(errors.length > 0 || warnings.length > 0) && (
                    <ul className="mt-2 space-y-1">
                      {errors.map((check) => (
                        <li key={check.code} className="text-[11px] text-[#f85149]">
                          {check.message}
                        </li>
                      ))}
                      {warnings.map((check) => (
                        <li key={check.code} className="text-[11px] text-[#e3b341]">
                          {check.message}
                        </li>
                      ))}
                    </ul>
                  )}

                  {(state.kind === 'failed' || state.kind === 'uncertain' || state.kind === 'published') &&
                    state.detail && (
                      <p
                        className={`mt-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed ${
                          state.kind === 'published'
                            ? 'border-[#238636]/40 bg-[#238636]/10 text-[#3fb950]'
                            : state.kind === 'failed'
                              ? 'border-[#da3633]/40 bg-[#da3633]/10 text-[#f85149]'
                              : 'border-[#d29922]/40 bg-[#d29922]/10 text-[#e3b341]'
                        }`}
                      >
                        {state.detail}
                      </p>
                    )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveDraft(draft)}
                      disabled={!dirty || locked || saving}
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleApproveDraft(draft.id)}
                      disabled={
                        dirty ||
                        errors.length > 0 ||
                        locked ||
                        approving ||
                        draft.status === 'approved'
                      }
                      title={errors.length > 0 ? 'Fix errors before approving.' : undefined}
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {approving
                        ? 'Approving…'
                        : draft.status === 'approved'
                          ? 'Approved'
                          : 'Approve post'}
                    </button>

                    {state.canPublish && (
                      <button
                        type="button"
                        onClick={() => {
                          // LinkedIn has no idempotency key, so the send needs an
                          // explicit confirmation before the one allowed attempt.
                          const confirmed = window.confirm(
                            'Publish this approved text to LinkedIn now? Crewlink sends it once through the official API and records the result.'
                          );
                          if (confirmed) void handlePublishDraft(draft);
                        }}
                        disabled={!linkedinConnection || dirty || publishing}
                        title={
                          !linkedinConnection
                            ? 'Connect a LinkedIn account first.'
                            : dirty
                              ? 'Save your changes before publishing.'
                              : undefined
                        }
                        className="h-8 rounded-md border border-success bg-success px-4 text-[12px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {publishing
                          ? 'Publishing…'
                          : state.canRetry
                            ? 'Retry publish'
                            : 'Publish to LinkedIn'}
                      </button>
                    )}

                    {state.kind === 'sending' && (
                      <button
                        type="button"
                        disabled
                        className="h-8 cursor-not-allowed rounded-md border border-line px-4 text-[12px] text-[#8b949e] opacity-70"
                      >
                        Publishing…
                      </button>
                    )}

                    {dirty && (
                      <span className="text-[11px] text-[#8b949e]">
                        Unsaved changes — save before approving or publishing.
                      </span>
                    )}
                  </div>
                </article>
              );
            })()}

            {(() => {
              const draft = slackDraft;
              if (!draft) {
                return (
                  <div
                    key="slack-empty"
                    className="rounded-[10px] border border-dashed border-line-soft bg-panel px-5 py-8 text-center"
                  >
                    <h3 className="text-[13px] text-ink">No Slack draft yet</h3>
                    <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-[#8b949e]">
                      Generate a Slack draft, preview its mrkdwn formatting, then approve and
                      publish it to the channel you selected above.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleGenerateDrafts(['slack'])}
                      disabled={busy === 'generate' || loading}
                      className="mt-3 h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === 'generate' ? 'Generating…' : 'Generate Slack draft'}
                    </button>
                  </div>
                );
              }

              const text = draftEdits[draft.id] ?? draft.text;
              const dirty = text !== draft.text;
              const state = draft.publicationState;
              const errors = draft.checks.filter((check) => check.level === 'error');
              const warnings = draft.checks.filter((check) => check.level === 'warning');
              const locked =
                state.kind === 'published' || state.kind === 'sending' || state.kind === 'uncertain';
              const saving = busy === `save:${draft.id}`;
              const approving = busy === `approve:${draft.id}`;
              const publishing = busy === `publish:${draft.id}`;
              const overLimit = text.length > SLACK_MESSAGE_LIMIT;
              const destinationId = slackConnection?.channelId;
              const destination = slackConnection?.channelName || destinationId;
              const workspaceName = slackConnection?.serverName || 'Slack workspace';
              const botName = slackConnection?.externalAccountName || 'Crewlink';
              const published = state.kind === 'published' ? draft.publication : null;

              return (
                <article key={draft.id} className="rounded-[10px] border border-line bg-panel p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[13px] font-semibold text-ink">Slack</h3>
                      <span
                        className={`text-[11px] ${overLimit ? 'text-[#f85149]' : 'text-[#8b949e]'}`}
                      >
                        {text.length}/{SLACK_MESSAGE_LIMIT}
                      </span>
                    </div>
                    <StatusBadge state={state} />
                  </div>

                  {destination ? (
                    <p className="mt-0.5 text-[11px] text-[#8b949e]">
                      Publishing to #{destination} in {workspaceName} through the Crewlink bot.
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-[#e3b341]">
                      Choose a Slack channel above before publishing.
                    </p>
                  )}

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <label
                          className="text-[11px] text-[#8b949e]"
                          htmlFor={`slack-text-${draft.id}`}
                        >
                          Message text
                        </label>
                        <span
                          className={`text-[11px] ${overLimit ? 'text-[#f85149]' : 'text-[#8b949e]'}`}
                        >
                          {text.length}/{SLACK_MESSAGE_LIMIT}
                        </span>
                      </div>
                      <textarea
                        id={`slack-text-${draft.id}`}
                        value={text}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDraftEdits((prev) => ({ ...prev, [draft.id]: value }));
                        }}
                        rows={10}
                        disabled={locked}
                        className="mt-1 w-full resize-y rounded-md border border-line bg-canvas-inset px-3 py-2 font-mono text-[12px] leading-relaxed text-ink disabled:opacity-70"
                      />
                      <p className="mt-1 text-[10px] leading-relaxed text-[#8b949e]">
                        Slack uses mrkdwn, not Markdown: *bold*, _italic_, ~strike~, `code`,
                        ```fenced code``` and &lt;https://example.com|label&gt;. Text only; files
                        and media are not supported.
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#8b949e]">Slack-style preview</p>
                      <div className="mt-1 rounded-md border border-line bg-canvas-inset p-3">
                        <p className="text-[10px] uppercase tracking-[0.05em] text-[#8b949e]">
                          {workspaceName}
                        </p>
                        <div className="mt-2 flex items-start gap-2">
                          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-panel-2 text-[12px] text-[#c9d1d9]">
                            {botName.charAt(0).toUpperCase() || 'S'}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-semibold text-[#f0f6fc]">
                              {botName}
                              <span className="ml-1 rounded bg-[#30363d] px-1 py-0.5 text-[9px] uppercase tracking-[0.05em] text-[#8b949e]">
                                app
                              </span>
                            </p>
                            <p className="text-[10px] text-[#8b949e]">Just now</p>
                          </div>
                        </div>
                        {text.trim() ? (
                          <div
                            className="mt-2 break-words text-[12px] leading-relaxed text-[#c9d1d9]"
                            dangerouslySetInnerHTML={{ __html: renderSlackMrkdwn(text) }}
                          />
                        ) : (
                          <p className="mt-2 text-[11px] text-[#8b949e]">
                            Your message preview appears here.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {(errors.length > 0 || warnings.length > 0) && (
                    <ul className="mt-2 space-y-1">
                      {errors.map((check) => (
                        <li key={check.code} className="text-[11px] text-[#f85149]">
                          {check.message}
                        </li>
                      ))}
                      {warnings.map((check) => (
                        <li key={check.code} className="text-[11px] text-[#e3b341]">
                          {check.message}
                        </li>
                      ))}
                    </ul>
                  )}

                  {(state.kind === 'failed' || state.kind === 'uncertain' || state.kind === 'published') &&
                    state.detail && (
                      <p
                        className={`mt-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed ${
                          state.kind === 'published'
                            ? 'border-[#238636]/40 bg-[#238636]/10 text-[#3fb950]'
                            : state.kind === 'failed'
                              ? 'border-[#da3633]/40 bg-[#da3633]/10 text-[#f85149]'
                              : 'border-[#d29922]/40 bg-[#d29922]/10 text-[#e3b341]'
                        }`}
                      >
                        {state.detail}
                      </p>
                    )}

                  {published && (
                    <p className="mt-2 text-[11px] leading-relaxed text-[#8b949e]">
                      Slack message{' '}
                      <span className="font-mono text-[#c9d1d9]">
                        {published.externalId || 'ts not recorded'}
                      </span>
                      {published.targetName ? ` in channel ${published.targetName}` : ''}
                      {published.confirmedAt
                        ? ` · ${published.confirmedAt.slice(0, 16).replace('T', ' ')} UTC`
                        : ''}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveDraft(draft)}
                      disabled={!dirty || locked || saving}
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleApproveDraft(draft.id)}
                      disabled={
                        dirty ||
                        errors.length > 0 ||
                        locked ||
                        approving ||
                        draft.status === 'approved'
                      }
                      title={errors.length > 0 ? 'Fix errors before approving.' : undefined}
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {approving
                        ? 'Approving…'
                        : draft.status === 'approved'
                          ? 'Approved'
                          : 'Approve message'}
                    </button>

                    {state.canPublish && (
                      <button
                        type="button"
                        onClick={() => {
                          // Slack has no idempotency key, so the single allowed
                          // send needs an explicit confirmation.
                          const confirmed = window.confirm(
                            `Publish this approved message to ${
                              destination ? `#${destination}` : 'the selected channel'
                            } now?\n\nCrewlink sends it once through the Slack API and records the result.`
                          );
                          if (confirmed) void handlePublishDraft(draft);
                        }}
                        disabled={!destinationId || dirty || publishing}
                        title={
                          !destinationId
                            ? 'Choose a Slack channel first.'
                            : dirty
                              ? 'Save your changes before publishing.'
                              : undefined
                        }
                        className="h-8 rounded-md border border-success bg-success px-4 text-[12px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {publishing
                          ? 'Publishing…'
                          : state.canRetry
                            ? 'Retry publish'
                            : 'Publish to Slack'}
                      </button>
                    )}

                    {state.kind === 'sending' && (
                      <button
                        type="button"
                        disabled
                        className="h-8 cursor-not-allowed rounded-md border border-line px-4 text-[12px] text-[#8b949e] opacity-70"
                      >
                        Publishing…
                      </button>
                    )}

                    {dirty && (
                      <span className="text-[11px] text-[#8b949e]">
                        Unsaved changes — save before approving or publishing.
                      </span>
                    )}
                  </div>
                </article>
              );
            })()}

            {(() => {
              const draft = whatsappDraft;
              if (!draft) {
                return (
                  <div
                    key="whatsapp-empty"
                    className="rounded-[10px] border border-dashed border-line-soft bg-panel px-5 py-8 text-center"
                  >
                    <h3 className="text-[13px] text-ink">No WhatsApp draft yet</h3>
                    <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-[#8b949e]">
                      Generate a WhatsApp message, approve it, then copy it or open WhatsApp’s
                      official share screen. Crewlink never sends the message and cannot verify
                      delivery.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleGenerateDrafts(['whatsapp'])}
                      disabled={busy === 'generate' || loading}
                      className="mt-3 h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === 'generate' ? 'Generating…' : 'Generate WhatsApp draft'}
                    </button>
                  </div>
                );
              }

              const text = draftEdits[draft.id] ?? draft.text;
              const dirty = text !== draft.text;
              const state = draft.publicationState;
              const errors = draft.checks.filter((check) => check.level === 'error');
              const warnings = draft.checks.filter((check) => check.level === 'warning');
              const locked = state.kind === 'published';
              const saving = busy === `save:${draft.id}`;
              const approving = busy === `approve:${draft.id}`;
              const preparing = busy === `whatsapp-prepare:${draft.id}`;
              const marking = busy === `whatsapp-shared:${draft.id}`;
              const overLimit = text.length > WHATSAPP_MESSAGE_LIMIT;
              const approved = draft.status === 'approved' && !dirty;
              const shareUrl = whatsappShares[draft.id];
              const publication = draft.publication;
              const prepared =
                publication?.status === 'prepared' || publication?.status === 'opened';

              return (
                <article key={draft.id} className="rounded-[10px] border border-line bg-panel p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[13px] font-semibold text-ink">WhatsApp</h3>
                      <span
                        className={`text-[11px] ${overLimit ? 'text-[#f85149]' : 'text-[#8b949e]'}`}
                      >
                        {text.length}/{WHATSAPP_MESSAGE_LIMIT}
                      </span>
                      <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] text-[#8b949e]">
                        Manual only
                      </span>
                    </div>
                    <StatusBadge state={state} />
                  </div>

                  <p className="mt-0.5 text-[11px] leading-relaxed text-[#8b949e]">
                    Manual sharing only. Crewlink does not use the WhatsApp Business API and never
                    sends or delivers this message. Copy it, or open WhatsApp’s official share
                    screen, choose a recipient, and send it yourself.
                  </p>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <label
                          className="text-[11px] text-[#8b949e]"
                          htmlFor={`whatsapp-text-${draft.id}`}
                        >
                          Message text
                        </label>
                        <span
                          className={`text-[11px] ${overLimit ? 'text-[#f85149]' : 'text-[#8b949e]'}`}
                        >
                          {text.length}/{WHATSAPP_MESSAGE_LIMIT}
                        </span>
                      </div>
                      <textarea
                        id={`whatsapp-text-${draft.id}`}
                        value={text}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDraftEdits((prev) => ({ ...prev, [draft.id]: value }));
                          // A prepared link would carry the old text.
                          setWhatsappShares((prev) => {
                            if (!(draft.id in prev)) return prev;
                            const next = { ...prev };
                            delete next[draft.id];
                            return next;
                          });
                        }}
                        rows={10}
                        disabled={locked}
                        className="mt-1 w-full resize-y rounded-md border border-line bg-canvas-inset px-3 py-2 font-mono text-[12px] leading-relaxed text-ink disabled:opacity-70"
                      />
                      <p className="mt-1 text-[10px] leading-relaxed text-[#8b949e]">
                        Plain text only. Line breaks and URLs are preserved exactly. Crewlink does
                        not add formatting; WhatsApp applies its own link previews.
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#8b949e]">WhatsApp-style preview</p>
                      <div className="mt-1 rounded-md border border-line bg-canvas-inset p-3">
                        <div className="ml-auto max-w-[92%] whitespace-pre-wrap break-words rounded-lg border border-line bg-panel-2 px-3 py-2 text-[12px] leading-relaxed text-[#c9d1d9]">
                          {text.trim() || 'Your message preview appears here.'}
                        </div>
                        <p className="mt-2 text-right text-[10px] text-[#8b949e]">
                          Preview · not sent
                        </p>
                      </div>
                    </div>
                  </div>

                  {(errors.length > 0 || warnings.length > 0) && (
                    <ul className="mt-2 space-y-1">
                      {errors.map((check) => (
                        <li key={check.code} className="text-[11px] text-[#f85149]">
                          {check.message}
                        </li>
                      ))}
                      {warnings.map((check) => (
                        <li key={check.code} className="text-[11px] text-[#e3b341]">
                          {check.message}
                        </li>
                      ))}
                    </ul>
                  )}

                  {(state.kind === 'failed' ||
                    state.kind === 'uncertain' ||
                    state.kind === 'published' ||
                    state.kind === 'prepared' ||
                    state.kind === 'opened') &&
                    state.detail && (
                      <p
                        className={`mt-2 rounded-md border px-3 py-2 text-[11px] leading-relaxed ${
                          state.kind === 'published'
                            ? 'border-[#238636]/40 bg-[#238636]/10 text-[#3fb950]'
                            : state.kind === 'failed'
                              ? 'border-[#da3633]/40 bg-[#da3633]/10 text-[#f85149]'
                              : 'border-[#d29922]/40 bg-[#d29922]/10 text-[#e3b341]'
                        }`}
                      >
                        {state.detail}
                      </p>
                    )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveDraft(draft)}
                      disabled={!dirty || locked || saving}
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleApproveDraft(draft.id)}
                      disabled={
                        dirty ||
                        errors.length > 0 ||
                        locked ||
                        approving ||
                        draft.status === 'approved'
                      }
                      title={errors.length > 0 ? 'Fix errors before approving.' : undefined}
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {approving
                        ? 'Approving…'
                        : draft.status === 'approved'
                          ? 'Approved'
                          : 'Approve message'}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handlePrepareWhatsApp(draft, true)}
                      disabled={dirty || !approved || locked || preparing}
                      title={
                        !approved
                          ? 'Approve the message first.'
                          : dirty
                            ? 'Save your changes before preparing.'
                            : undefined
                      }
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {preparing ? 'Preparing…' : 'Copy message'}
                    </button>

                    {shareUrl ? (
                      <a
                        href={shareUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => void handleWhatsAppOpened(draft)}
                        className="inline-flex h-8 items-center rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc]"
                      >
                        Open WhatsApp
                      </a>
                    ) : (
                      <button
                        type="button"
                        disabled
                        title="Copy or prepare the message first."
                        className="h-8 cursor-not-allowed rounded-md border border-line px-3 text-[12px] text-[#8b949e] opacity-70"
                      >
                        Open WhatsApp
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleMarkWhatsAppShared(draft)}
                      disabled={!prepared || dirty || locked || marking}
                      title={
                        !prepared
                          ? 'Prepare or copy the message first.'
                          : dirty
                            ? 'Save your changes before marking it shared.'
                            : undefined
                      }
                      className="h-8 rounded-md border border-line px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {marking ? 'Recording…' : 'Mark shared by hand'}
                    </button>

                    {dirty && (
                      <span className="text-[11px] text-[#8b949e]">
                        Unsaved changes — save before preparing or marking it shared.
                      </span>
                    )}
                  </div>

                  <p className="mt-2 text-[10px] leading-relaxed text-[#8b949e]">
                    Opening WhatsApp does not send anything. Crewlink cannot see the recipient, the
                    chat, or whether the message was delivered.
                  </p>
                </article>
              );
            })()}
          </div>
        )}
      </section>

      {notice && (
        <div
          role="status"
          className={`fixed bottom-24 left-1/2 z-[300] w-[min(92vw,540px)] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-[12px] shadow-lg md:bottom-7 ${
            notice.tone === 'error'
              ? 'border-[#da3633]/50 bg-[#2d1214] text-[#f85149]'
              : 'border-line bg-panel text-ink'
          }`}
        >
          {notice.message}
        </div>
      )}
    </div>
  );
}

export default PublishingClient;
