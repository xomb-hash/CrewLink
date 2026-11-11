'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PenLine,
  Play,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';
import { byId } from '@/platforms/registry';
import { ProjectLogo } from '@/components/ProjectLogo';
import type {
  AiProviderStatus,
  BrandProfile,
  Campaign,
  CampaignDetail,
  CampaignSchedule,
  CampaignTask,
  ContentIdea,
  GeneratedPost,
  QualityIssue,
} from '@/ai/types';
import type { Draft, DraftCheck } from '@/types/index';

const AI_PLATFORMS = ['linkedin', 'x', 'reddit', 'bluesky', 'telegram', 'slack'];

interface AiProject {
  id: string;
  title: string;
  slug: string;
  repoFullName: string;
  isPrivate: boolean;
  logoUrl: string | null;
}

interface DraftView extends Draft {
  checks?: DraftCheck[];
}

interface Notice {
  tone: 'success' | 'error';
  message: string;
}

interface CampaignFormState {
  brief: string;
  name: string;
  objective: string;
  audience: string;
  platforms: string[];
  durationDays: number;
  timezone: string;
  startDate: string;
  redditSubreddit: string;
  themes: string;
  postingFrequency: string;
  desiredOutcomes: string;
}

interface BrandFormState {
  brandName: string;
  description: string;
  audience: string;
  tone: string;
  vocabulary: string;
  style: string;
  avoidTopics: string;
  avoidWords: string;
  ctas: string;
  examplePosts: string;
}

interface StrategyFormState {
  name: string;
  objective: string;
  audience: string;
  themes: string;
  postingFrequency: string;
  desiredOutcomes: string;
  startDate: string;
  timezone: string;
  redditSubreddit: string;
  ideas: Array<{ id: string; day: number; platformId: string; topic: string; angle: string }>;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'The request failed.');
  }
  return data as T;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The request failed.';
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function emptyCampaignForm(): CampaignFormState {
  return {
    brief: '',
    name: '',
    objective: '',
    audience: '',
    platforms: ['linkedin'],
    durationDays: 7,
    timezone: localTimezone(),
    startDate: '',
    redditSubreddit: '',
    themes: '',
    postingFrequency: '',
    desiredOutcomes: '',
  };
}

function emptyBrandForm(): BrandFormState {
  return {
    brandName: '',
    description: '',
    audience: '',
    tone: '',
    vocabulary: '',
    style: '',
    avoidTopics: '',
    avoidWords: '',
    ctas: '',
    examplePosts: '',
  };
}

function brandFormFrom(brand: BrandProfile | null): BrandFormState {
  if (!brand) return emptyBrandForm();
  return {
    brandName: brand.brandName,
    description: brand.description,
    audience: brand.audience,
    tone: brand.tone,
    vocabulary: brand.vocabulary.join(', '),
    style: brand.style,
    avoidTopics: brand.avoidTopics.join(', '),
    avoidWords: brand.avoidWords.join(', '),
    ctas: brand.ctas.join(', '),
    examplePosts: brand.examplePosts.join('\n'),
  };
}

function strategyFormFrom(detail: CampaignDetail): StrategyFormState {
  return {
    name: detail.campaign.name,
    objective: detail.campaign.objective,
    audience: detail.campaign.audience,
    themes: detail.campaign.themes.join(', '),
    postingFrequency: detail.campaign.postingFrequency,
    desiredOutcomes: detail.campaign.desiredOutcomes.join(', '),
    startDate: detail.campaign.startDate,
    timezone: detail.campaign.timezone,
    redditSubreddit: detail.campaign.redditSubreddit || '',
    ideas: detail.ideas.map((idea) => ({
      id: idea.id,
      day: idea.day,
      platformId: idea.platformId,
      topic: idea.topic,
      angle: idea.angle,
    })),
  };
}

function toLocalInput(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatInZone(value: string, timezone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

const inputClass =
  'h-9 w-full min-w-0 rounded-md border border-line bg-canvas-inset px-2.5 text-[12px] text-ink placeholder:text-[#6e7681]';
const areaClass =
  'w-full rounded-md border border-line bg-canvas-inset px-2.5 py-2 text-[12px] leading-relaxed text-ink placeholder:text-[#6e7681]';
const labelClass = 'mb-1 block text-[11px] font-medium uppercase tracking-[0.05em] text-[#8b949e]';
const buttonPrimary =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-success bg-success px-3 text-[12px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis disabled:cursor-not-allowed disabled:opacity-50';
const buttonSecondary =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel-2 px-3 text-[12px] text-ink transition-colors hover:border-[#484f58] disabled:cursor-not-allowed disabled:opacity-50';

const severityClass: Record<QualityIssue['severity'], string> = {
  error: 'border-[#da3633]/40 bg-[#da3633]/10 text-[#f85149]',
  warning: 'border-[#d29922]/40 bg-[#d29922]/10 text-[#e3b341]',
  info: 'border-line bg-panel-2 text-[#8b949e]',
};

const taskStatusClass: Record<CampaignTask['status'], string> = {
  completed: 'text-[#3fb950]',
  running: 'text-[#58a6ff]',
  failed: 'text-[#f85149]',
  skipped: 'text-[#8b949e]',
  pending: 'text-[#e3b341]',
};

function Panel({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[10px] border border-line bg-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 text-[#8b949e]">{icon}</span>
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
            {description && (
              <p className="mt-0.5 text-[11px] leading-relaxed text-[#8b949e]">{description}</p>
            )}
          </div>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: string }) {
  const classes =
    tone === 'success'
      ? 'border-[#238636]/40 bg-[#238636]/15 text-[#3fb950]'
      : tone === 'warning'
        ? 'border-[#d29922]/40 bg-[#d29922]/15 text-[#e3b341]'
        : tone === 'error'
          ? 'border-[#da3633]/40 bg-[#da3633]/15 text-[#f85149]'
          : 'border-line bg-panel-2 text-[#8b949e]';
  return (
    <span className={`inline-flex flex-none rounded-full border px-2 py-0.5 text-[10px] ${classes}`}>
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-line-soft px-4 py-8 text-center text-[12px] text-[#8b949e]">
      {children}
    </p>
  );
}

export function AiWorkspaceClient({ projects }: { projects: AiProject[] }) {
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? '');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [drafts, setDrafts] = useState<DraftView[]>([]);
  const [brand, setBrand] = useState<BrandProfile | null>(null);
  const [status, setStatus] = useState<AiProviderStatus | null>(null);
  const [campaignForm, setCampaignForm] = useState<CampaignFormState>(emptyCampaignForm);
  const [brandForm, setBrandForm] = useState<BrandFormState>(emptyBrandForm);
  const [strategyForm, setStrategyForm] = useState<StrategyFormState | null>(null);
  const [sourceUrls, setSourceUrls] = useState('');
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let alive = true;
    api<{ status: AiProviderStatus }>('/api/ai/status')
      .then((data) => {
        if (alive) setStatus(data.status);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const loadDetail = useCallback(async (campaignId: string, projectId: string) => {
    setLoadingDetail(true);
    try {
      const [campaignData, draftData] = await Promise.all([
        api<{ detail: CampaignDetail; status: AiProviderStatus }>(
          `/api/ai/campaigns/${campaignId}`
        ),
        api<{ drafts: DraftView[] }>(`/api/projects/${projectId}/drafts`),
      ]);
      setDetail(campaignData.detail);
      setStatus(campaignData.status);
      setDrafts(draftData.drafts.filter((draft) => draft.campaignId === campaignId));
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    let alive = true;
    setCampaigns([]);
    setSelectedCampaignId('');
    setDetail(null);
    setDrafts([]);
    setBrand(null);
    setNotice(null);
    Promise.all([
      api<{ campaigns: Campaign[] }>(`/api/ai/projects/${selectedProjectId}/campaigns`),
      api<{ brand: BrandProfile | null }>(`/api/ai/projects/${selectedProjectId}/brand`),
    ])
      .then(([campaignData, brandData]) => {
        if (!alive) return;
        setCampaigns(campaignData.campaigns);
        setBrand(brandData.brand);
        if (campaignData.campaigns[0]) setSelectedCampaignId(campaignData.campaigns[0].id);
      })
      .catch((error) => {
        if (alive) setNotice({ tone: 'error', message: errorText(error) });
      });
    return () => {
      alive = false;
    };
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedCampaignId && selectedProjectId) {
      void loadDetail(selectedCampaignId, selectedProjectId);
    }
  }, [selectedCampaignId, selectedProjectId, loadDetail]);

  const strategyKey = detail
    ? `${detail.campaign.id}:${detail.campaign.updatedAt}`
    : '';
  useEffect(() => {
    if (detail) setStrategyForm(strategyFormFrom(detail));
    // The strategy form resets only when the saved campaign actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyKey]);

  const brandKey = brand ? `${brand.id}:${brand.updatedAt}` : 'empty';
  useEffect(() => {
    setBrandForm(brandFormFrom(brand));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandKey, selectedProjectId]);

  const scheduleKey = detail?.schedules.map((schedule) => `${schedule.id}:${schedule.scheduledFor}`).join('|') || '';
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const schedule of detail?.schedules || []) {
      next[schedule.id] = toLocalInput(schedule.scheduledFor);
    }
    setScheduleInputs(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleKey]);

  const draftById = useMemo(() => {
    const map = new Map<string, DraftView>();
    for (const draft of drafts) map.set(draft.id, draft);
    return map;
  }, [drafts]);

  const generatedByIdea = useMemo(() => {
    const map = new Map<string, GeneratedPost[]>();
    for (const post of detail?.generated || []) {
      const rows = map.get(post.ideaId) || [];
      rows.push(post);
      map.set(post.ideaId, rows);
    }
    for (const rows of map.values()) rows.sort((a, b) => a.variationIndex - b.variationIndex);
    return map;
  }, [detail]);

  const latestTasks = useMemo(() => {
    return (detail?.tasks || [])
      .slice()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 6);
  }, [detail]);

  const canUseAgent = Boolean(status?.configured);

  const refreshCampaigns = useCallback(async (projectId: string) => {
    const data = await api<{ campaigns: Campaign[] }>(
      `/api/ai/projects/${projectId}/campaigns`
    );
    setCampaigns(data.campaigns);
    return data.campaigns;
  }, []);

  const runAgent = async (campaignId: string, sources: string[] = []) => {
    if (!selectedProjectId) return;
    setBusy('run');
    setNotice(null);
    try {
      await api(`/api/ai/campaigns/${campaignId}/run`, {
        method: 'POST',
        body: JSON.stringify({ sources }),
      });
      await refreshCampaigns(selectedProjectId);
      await loadDetail(campaignId, selectedProjectId);
      setNotice({ tone: 'success', message: 'Campaign run finished. Drafts are waiting for review.' });
    } catch (error) {
      await loadDetail(campaignId, selectedProjectId).catch(() => undefined);
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const createCampaign = async (run: boolean) => {
    if (!selectedProjectId) return;
    setBusy(run ? 'create-run' : 'create');
    setNotice(null);
    try {
      const created = await api<{ campaign: Campaign }>(
        `/api/ai/projects/${selectedProjectId}/campaigns`,
        {
          method: 'POST',
          body: JSON.stringify({
            brief: campaignForm.brief,
            name: campaignForm.name,
            objective: campaignForm.objective,
            audience: campaignForm.audience,
            platforms: campaignForm.platforms,
            durationDays: Number(campaignForm.durationDays),
            timezone: campaignForm.timezone,
            startDate: campaignForm.startDate,
            redditSubreddit: campaignForm.platforms.includes('reddit')
              ? campaignForm.redditSubreddit
              : undefined,
            themes: splitList(campaignForm.themes),
            postingFrequency: campaignForm.postingFrequency,
            desiredOutcomes: splitList(campaignForm.desiredOutcomes),
          }),
        }
      );
      await refreshCampaigns(selectedProjectId);
      setSelectedCampaignId(created.campaign.id);
      setCampaignForm(emptyCampaignForm());
      if (run) {
        await runAgent(created.campaign.id, splitLines(sourceUrls));
      } else {
        setNotice({ tone: 'success', message: 'Campaign saved. Run the agent when you are ready.' });
      }
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const saveBrand = async () => {
    if (!selectedProjectId) return;
    setBusy('brand');
    setNotice(null);
    try {
      const saved = await api<{ brand: BrandProfile }>(
        `/api/ai/projects/${selectedProjectId}/brand`,
        {
          method: 'PUT',
          body: JSON.stringify({
            brandName: brandForm.brandName,
            description: brandForm.description,
            audience: brandForm.audience,
            tone: brandForm.tone,
            vocabulary: splitList(brandForm.vocabulary),
            style: brandForm.style,
            avoidTopics: splitList(brandForm.avoidTopics),
            avoidWords: splitList(brandForm.avoidWords),
            ctas: splitList(brandForm.ctas),
            examplePosts: splitLines(brandForm.examplePosts),
          }),
        }
      );
      setBrand(saved.brand);
      setNotice({ tone: 'success', message: 'Brand voice saved. New generations use it.' });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const saveStrategy = async () => {
    if (!detail || !strategyForm) return;
    setBusy('strategy');
    setNotice(null);
    try {
      const data = await api<{ detail: CampaignDetail }>(
        `/api/ai/campaigns/${detail.campaign.id}/strategy`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            name: strategyForm.name,
            objective: strategyForm.objective,
            audience: strategyForm.audience,
            themes: splitList(strategyForm.themes),
            postingFrequency: strategyForm.postingFrequency,
            desiredOutcomes: splitList(strategyForm.desiredOutcomes),
            startDate: strategyForm.startDate,
            timezone: strategyForm.timezone,
            redditSubreddit: strategyForm.redditSubreddit,
            ideas: strategyForm.ideas,
          }),
        }
      );
      setDetail(data.detail);
      setDrafts((current) => current);
      setNotice({ tone: 'success', message: 'Strategy saved.' });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const generateIdea = async (ideaId: string, force: boolean) => {
    if (!detail || !selectedProjectId) return;
    setBusy(force ? `regen:${ideaId}` : `gen:${ideaId}`);
    setNotice(null);
    try {
      const data = await api<{ detail: CampaignDetail }>(
        `/api/ai/campaigns/${detail.campaign.id}/ideas/${ideaId}/generate`,
        { method: 'POST', body: JSON.stringify({ force }) }
      );
      setDetail(data.detail);
      await loadDetail(detail.campaign.id, selectedProjectId);
      setNotice({ tone: 'success', message: 'Draft saved as a normal Crewlink draft.' });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const reviewDraft = async (draftId: string) => {
    if (!detail || !selectedProjectId) return;
    setBusy(`review:${draftId}`);
    try {
      await api(`/api/ai/drafts/${draftId}/quality`, { method: 'POST' });
      await loadDetail(detail.campaign.id, selectedProjectId);
      setNotice({ tone: 'success', message: 'Review updated.' });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const approveDraft = async (draftId: string) => {
    if (!detail || !selectedProjectId) return;
    setBusy(`approve:${draftId}`);
    try {
      await api(`/api/drafts/${draftId}/approve`, { method: 'POST' });
      await loadDetail(detail.campaign.id, selectedProjectId);
      setNotice({ tone: 'success', message: 'Draft approved with the existing approval check.' });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const recompute = async () => {
    if (!detail || !selectedProjectId) return;
    setBusy('schedule');
    try {
      await api(`/api/ai/campaigns/${detail.campaign.id}/schedule`, { method: 'POST' });
      await loadDetail(detail.campaign.id, selectedProjectId);
      setNotice({ tone: 'success', message: 'Schedule suggestions rebuilt. Manual times were kept.' });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const overrideTime = async (scheduleId: string) => {
    if (!detail || !selectedProjectId) return;
    const value = scheduleInputs[scheduleId];
    if (!value) {
      setNotice({ tone: 'error', message: 'Choose a date and time first.' });
      return;
    }
    setBusy(`schedule:${scheduleId}`);
    try {
      await api(`/api/ai/campaigns/${detail.campaign.id}/schedules/${scheduleId}`, {
        method: 'PATCH',
        body: JSON.stringify({ scheduledFor: new Date(value).toISOString() }),
      });
      await loadDetail(detail.campaign.id, selectedProjectId);
      setNotice({ tone: 'success', message: 'Manual time saved.' });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const refreshAnalytics = async () => {
    if (!detail || !selectedProjectId) return;
    setBusy('analytics');
    try {
      await api(`/api/ai/campaigns/${detail.campaign.id}/analytics`, { method: 'POST' });
      await loadDetail(detail.campaign.id, selectedProjectId);
      setNotice({ tone: 'success', message: 'Analytics refreshed from Crewlink records.' });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  if (projects.length === 0) {
    return (
      <div className="mx-auto max-w-[1100px] px-6 py-8">
        <h1 className="text-lg font-semibold tracking-tight text-ink">AI Studio</h1>
        <p className="mt-0.5 text-[12px] text-[#8b949e]">
          Plan a campaign, research it, and turn the plan into normal Crewlink drafts you review and
          publish yourself.
        </p>
        <div className="mt-6 rounded-[10px] border border-dashed border-line-soft bg-panel px-6 py-16 text-center">
          <h2 className="mb-2 text-sm font-normal text-ink">No repositories connected yet</h2>
          <p className="mx-auto mb-6 max-w-md text-[12px] leading-relaxed text-[#8b949e]">
            AI campaigns belong to a project. Create a project from a repository where you have
            admin access first.
          </p>
          <Link href="/projects/new" className={buttonPrimary}>
            Create a project
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
            <Sparkles className="h-[18px] w-[18px] text-[#8b949e]" strokeWidth={1.5} />
            AI Studio
          </h1>
          <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-[#8b949e]">
            The agent researches, proposes a strategy, and writes drafts. You review every draft and
            use the existing Publishing page to approve and publish. The AI never publishes, approves,
            or reads platform credentials.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status && (
            <Badge tone={status.configured ? 'success' : 'warning'}>
              {status.provider} · {status.model || 'no model'} ·{' '}
              {status.configured ? 'configured' : 'not configured'}
            </Badge>
          )}
          {status && (
            <Badge tone={status.researchConfigured ? 'success' : 'neutral'}>
              research: {status.researchConfigured ? status.researchProvider : 'not configured'}
            </Badge>
          )}
        </div>
      </div>

      {status && !status.configured && (
        <div className="mb-5 rounded-[10px] border border-[#d29922]/40 bg-[#d29922]/10 px-4 py-3 text-[12px] leading-relaxed text-[#e3b341]">
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" /> AI provider not configured
          </div>
          Add a server-side API key (OpenAI, Anthropic or Gemini) and set <code>AI_PROVIDER</code>, or
          set <code>AI_PROVIDER=mock</code> for local exploration. Campaigns cannot run until a provider
          is configured. No fallback provider is used.
        </div>
      )}

      {notice && (
        <div
          className={`mb-5 rounded-[10px] border px-4 py-2.5 text-[12px] ${
            notice.tone === 'success'
              ? 'border-[#238636]/40 bg-[#238636]/10 text-[#3fb950]'
              : 'border-[#da3633]/40 bg-[#da3633]/10 text-[#f85149]'
          }`}
        >
          {notice.message}
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-panel p-4">
        {selectedProject && (
          <>
            <ProjectLogo
              title={selectedProject.title}
              logoUrl={selectedProject.logoUrl}
              className="h-10 w-10"
              textClassName="text-[13px]"
            />
            <div className="min-w-0">
              <p className="truncate text-[13px] text-ink">{selectedProject.title}</p>
              <p className="text-[11px] text-[#8b949e]">{selectedProject.repoFullName}</p>
            </div>
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {projects.length > 1 && (
            <label className="flex items-center gap-2 text-[12px] text-[#8b949e]">
              Project
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
                className="h-8 rounded-md border border-line bg-panel-2 px-2 text-[12px] text-ink"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {campaigns.length > 0 && (
            <label className="flex items-center gap-2 text-[12px] text-[#8b949e]">
              Campaign
              <select
                value={selectedCampaignId}
                onChange={(event) => setSelectedCampaignId(event.target.value)}
                className="h-8 max-w-[240px] rounded-md border border-line bg-panel-2 px-2 text-[12px] text-ink"
              >
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name || campaign.brief.slice(0, 48)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {detail && (
            <button
              type="button"
              className={buttonPrimary}
              disabled={!canUseAgent || Boolean(busy) || detail.campaign.status === 'running'}
              onClick={() => void runAgent(detail.campaign.id, splitLines(sourceUrls))}
            >
              {busy === 'run' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run agent
            </button>
          )}
        </div>
      </div>

      {detail && (
        <div className="mb-5 rounded-[10px] border border-line bg-panel px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-ink">Agent activity</span>
            <Badge
              tone={
                detail.campaign.status === 'ready'
                  ? 'success'
                  : detail.campaign.status === 'failed'
                    ? 'error'
                    : detail.campaign.status === 'partial'
                      ? 'warning'
                      : 'neutral'
              }
            >
              {detail.campaign.status}
            </Badge>
            {detail.campaign.strategyNotes && (
              <span className="text-[11px] text-[#8b949e]">{detail.campaign.strategyNotes}</span>
            )}
            {loadingDetail && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#8b949e]" />}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {latestTasks.map((task) => (
              <span key={task.id} className="text-[11px] text-[#8b949e]">
                <span className={taskStatusClass[task.status]}>{task.status}</span> · {task.kind}
                {task.detail ? ` · ${task.detail}` : ''}
                {task.errorMessage ? ` · ${task.errorMessage}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-5">
        <Panel
          icon={<Sparkles className="h-4 w-4" />}
          title="A. Campaign Builder"
          description="Describe the objective. The agent breaks it into research, strategy, content and review tasks."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="campaign-brief">
                Objective / brief
              </label>
              <textarea
                id="campaign-brief"
                className={`${areaClass} min-h-[84px]`}
                value={campaignForm.brief}
                onChange={(event) =>
                  setCampaignForm((form) => ({ ...form, brief: event.target.value }))
                }
                placeholder="For example: find three beta testers for the telemetry kit and explain how the build is going."
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="campaign-name">
                Campaign name (optional)
              </label>
              <input
                id="campaign-name"
                className={inputClass}
                value={campaignForm.name}
                onChange={(event) =>
                  setCampaignForm((form) => ({ ...form, name: event.target.value }))
                }
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="campaign-objective">
                Objective (optional)
              </label>
              <input
                id="campaign-objective"
                className={inputClass}
                value={campaignForm.objective}
                onChange={(event) =>
                  setCampaignForm((form) => ({ ...form, objective: event.target.value }))
                }
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="campaign-audience">
                Audience (optional)
              </label>
              <input
                id="campaign-audience"
                className={inputClass}
                value={campaignForm.audience}
                onChange={(event) =>
                  setCampaignForm((form) => ({ ...form, audience: event.target.value }))
                }
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="campaign-frequency">
                Posting frequency (optional)
              </label>
              <input
                id="campaign-frequency"
                className={inputClass}
                value={campaignForm.postingFrequency}
                onChange={(event) =>
                  setCampaignForm((form) => ({ ...form, postingFrequency: event.target.value }))
                }
                placeholder="For example: one post per platform every other day"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="campaign-duration">
                Duration (days)
              </label>
              <input
                id="campaign-duration"
                type="number"
                min={1}
                max={30}
                className={inputClass}
                value={campaignForm.durationDays}
                onChange={(event) =>
                  setCampaignForm((form) => ({
                    ...form,
                    durationDays: Number(event.target.value),
                  }))
                }
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="campaign-timezone">
                Timezone (IANA)
              </label>
              <input
                id="campaign-timezone"
                className={inputClass}
                value={campaignForm.timezone}
                onChange={(event) =>
                  setCampaignForm((form) => ({ ...form, timezone: event.target.value }))
                }
                placeholder="Europe/London"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="campaign-start">
                Start date (optional)
              </label>
              <input
                id="campaign-start"
                type="date"
                className={inputClass}
                value={campaignForm.startDate}
                onChange={(event) =>
                  setCampaignForm((form) => ({ ...form, startDate: event.target.value }))
                }
              />
            </div>
            {campaignForm.platforms.includes('reddit') && (
              <div>
                <label className={labelClass} htmlFor="campaign-subreddit">
                  Subreddit
                </label>
                <input
                  id="campaign-subreddit"
                  className={inputClass}
                  value={campaignForm.redditSubreddit}
                  onChange={(event) =>
                    setCampaignForm((form) => ({ ...form, redditSubreddit: event.target.value }))
                  }
                  placeholder="for example, opensource"
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <span className={labelClass}>Platforms</span>
              <div className="flex flex-wrap gap-2">
                {AI_PLATFORMS.map((platformId) => {
                  const platform = byId(platformId);
                  const active = campaignForm.platforms.includes(platformId);
                  return (
                    <label
                      key={platformId}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
                        active
                          ? 'border-[#238636]/40 bg-[#238636]/15 text-[#3fb950]'
                          : 'border-line bg-panel-2 text-[#8b949e]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={active}
                        onChange={() =>
                          setCampaignForm((form) => ({
                            ...form,
                            platforms: active
                              ? form.platforms.filter((id) => id !== platformId)
                              : [...form.platforms, platformId],
                          }))
                        }
                      />
                      {platform?.name || platformId}
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="campaign-themes">
                Themes (comma separated)
              </label>
              <input
                id="campaign-themes"
                className={inputClass}
                value={campaignForm.themes}
                onChange={(event) =>
                  setCampaignForm((form) => ({ ...form, themes: event.target.value }))
                }
                placeholder="beta testing, build journey"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="campaign-outcomes">
                Desired outcomes (comma separated)
              </label>
              <input
                id="campaign-outcomes"
                className={inputClass}
                value={campaignForm.desiredOutcomes}
                onChange={(event) =>
                  setCampaignForm((form) => ({ ...form, desiredOutcomes: event.target.value }))
                }
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="campaign-sources">
                Reference sources (optional, one URL per line)
              </label>
              <textarea
                id="campaign-sources"
                className={`${areaClass} min-h-[58px]`}
                value={sourceUrls}
                onChange={(event) => setSourceUrls(event.target.value)}
                placeholder="https://example.com/article-you-want-the-agent-to-consider"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={buttonPrimary}
              disabled={Boolean(busy) || !canUseAgent}
              onClick={() => void createCampaign(true)}
            >
              {busy === 'create-run' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Create campaign &amp; run agent
            </button>
            <button
              type="button"
              className={buttonSecondary}
              disabled={Boolean(busy)}
              onClick={() => void createCampaign(false)}
            >
              {busy === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save without running
            </button>
          </div>

          <div className="mt-6 border-t border-line-soft pt-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-[12px] font-semibold text-ink">Brand voice</h3>
                <p className="text-[11px] text-[#8b949e]">
                  Applies to this project. Generation uses these preferences. Crewlink never learns
                  from private messages or connected accounts.
                </p>
              </div>
              <button
                type="button"
                className={buttonSecondary}
                disabled={Boolean(busy)}
                onClick={() => void saveBrand()}
              >
                {busy === 'brand' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save brand
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Brand / project name</label>
                <input
                  className={inputClass}
                  value={brandForm.brandName}
                  onChange={(event) =>
                    setBrandForm((form) => ({ ...form, brandName: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Audience</label>
                <input
                  className={inputClass}
                  value={brandForm.audience}
                  onChange={(event) =>
                    setBrandForm((form) => ({ ...form, audience: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Tone</label>
                <input
                  className={inputClass}
                  value={brandForm.tone}
                  onChange={(event) =>
                    setBrandForm((form) => ({ ...form, tone: event.target.value }))
                  }
                  placeholder="direct, warm, technical"
                />
              </div>
              <div>
                <label className={labelClass}>Style notes</label>
                <input
                  className={inputClass}
                  value={brandForm.style}
                  onChange={(event) =>
                    setBrandForm((form) => ({ ...form, style: event.target.value }))
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Description</label>
                <textarea
                  className={`${areaClass} min-h-[58px]`}
                  value={brandForm.description}
                  onChange={(event) =>
                    setBrandForm((form) => ({ ...form, description: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Vocabulary to prefer (comma separated)</label>
                <input
                  className={inputClass}
                  value={brandForm.vocabulary}
                  onChange={(event) =>
                    setBrandForm((form) => ({ ...form, vocabulary: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Calls to action (comma separated)</label>
                <input
                  className={inputClass}
                  value={brandForm.ctas}
                  onChange={(event) =>
                    setBrandForm((form) => ({ ...form, ctas: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Avoid words (comma separated)</label>
                <input
                  className={inputClass}
                  value={brandForm.avoidWords}
                  onChange={(event) =>
                    setBrandForm((form) => ({ ...form, avoidWords: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Avoid topics (comma separated)</label>
                <input
                  className={inputClass}
                  value={brandForm.avoidTopics}
                  onChange={(event) =>
                    setBrandForm((form) => ({ ...form, avoidTopics: event.target.value }))
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Example posts (one per line)</label>
                <textarea
                  className={`${areaClass} min-h-[58px]`}
                  value={brandForm.examplePosts}
                  onChange={(event) =>
                    setBrandForm((form) => ({ ...form, examplePosts: event.target.value }))
                  }
                />
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          icon={<Search className="h-4 w-4" />}
          title="B. Research Workspace"
          description="Sources come only from the configured search API or URLs you add. Crewlink never invents links or scrapes private pages."
          action={
            detail ? (
              <button
                type="button"
                className={buttonSecondary}
                disabled={Boolean(busy) || !canUseAgent}
                onClick={() => void runAgent(detail.campaign.id, splitLines(sourceUrls))}
              >
                {busy === 'run' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Research again
              </button>
            ) : undefined
          }
        >
          {!detail ? (
            <Empty>Create a campaign to run research.</Empty>
          ) : !detail.campaign.research ? (
            <Empty>No research has run for this campaign yet.</Empty>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1.4fr,1fr]">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      detail.campaign.research.search.status === 'ok'
                        ? 'success'
                        : detail.campaign.research.search.status === 'not_configured'
                          ? 'neutral'
                          : 'warning'
                    }
                  >
                    search: {detail.campaign.research.search.status}
                  </Badge>
                  {detail.campaign.research.search.providers.map((provider) => (
                    <Badge key={provider}>{provider}</Badge>
                  ))}
                </div>
                <p className="text-[12px] leading-relaxed text-[#c9d1d9]">
                  {detail.campaign.research.summary}
                </p>
                {detail.campaign.research.search.message && (
                  <p className="mt-2 text-[11px] text-[#e3b341]">
                    {detail.campaign.research.search.message}
                  </p>
                )}
                <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#8b949e]">
                  Findings
                </h3>
                {detail.campaign.research.findings.length ? (
                  <ul className="mt-1 space-y-1.5">
                    {detail.campaign.research.findings.map((finding, index) => (
                      <li key={`${finding.statement}-${index}`} className="text-[12px] text-[#c9d1d9]">
                        {finding.statement}{' '}
                        <Badge tone={finding.verified ? 'success' : 'warning'}>
                          {finding.verified ? 'source retrieved' : 'unverified'}
                        </Badge>
                        {finding.sourceUrls.length > 0 && (
                          <span className="ml-1 text-[10px] text-[#8b949e]">
                            {finding.sourceUrls.length} source(s)
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[11px] text-[#8b949e]">No findings were returned.</p>
                )}
                {detail.campaign.research.opportunities.length > 0 && (
                  <>
                    <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#8b949e]">
                      Opportunities
                    </h3>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-[12px] text-[#c9d1d9]">
                      {detail.campaign.research.opportunities.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                )}
                {detail.campaign.research.assumptions.length > 0 && (
                  <>
                    <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#8b949e]">
                      Assumptions / limits
                    </h3>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-[#e3b341]">
                      {detail.campaign.research.assumptions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#8b949e]">
                  Sources ({detail.sources.length})
                </h3>
                {detail.sources.length ? (
                  <ul className="space-y-2">
                    {detail.sources.map((source) => (
                      <li key={source.id} className="rounded-md border border-line bg-panel-2 p-2.5">
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-start gap-1 text-[12px] text-ink hover:underline"
                        >
                          <span className="min-w-0 flex-1 break-words">{source.title}</span>
                          <ExternalLink className="mt-0.5 h-3 w-3 flex-none text-[#8b949e]" />
                        </a>
                        <p className="mt-1 text-[10px] text-[#8b949e]">
                          {source.publisher || 'unknown publisher'}
                          {source.publishedAt
                            ? ` · published ${new Date(source.publishedAt).toLocaleDateString()}`
                            : ''}
                          {` · ${source.provider}`}
                          {source.verified ? ' · verified result' : ' · supplied by you'}
                        </p>
                        {source.summary && (
                          <p className="mt-1 text-[11px] leading-relaxed text-[#c9d1d9]">
                            {source.summary}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] text-[#8b949e]">
                    No sources were retrieved. Add reference URLs and run the agent again if you want
                    them considered.
                  </p>
                )}
              </div>
            </div>
          )}
        </Panel>

        <Panel
          icon={<Target className="h-4 w-4" />}
          title="C. Campaign Strategy"
          description="The proposed plan is editable. Saving updates the same ideas the generator uses; existing drafts are untouched."
          action={
            detail && strategyForm ? (
              <button
                type="button"
                className={buttonSecondary}
                disabled={Boolean(busy)}
                onClick={() => void saveStrategy()}
              >
                {busy === 'strategy' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save strategy
              </button>
            ) : undefined
          }
        >
          {!detail || !strategyForm ? (
            <Empty>Create and run a campaign to generate a strategy.</Empty>
          ) : (
            <div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Campaign name</label>
                  <input
                    className={inputClass}
                    value={strategyForm.name}
                    onChange={(event) =>
                      setStrategyForm((form) => form && { ...form, name: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Objective</label>
                  <input
                    className={inputClass}
                    value={strategyForm.objective}
                    onChange={(event) =>
                      setStrategyForm((form) => form && { ...form, objective: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Audience</label>
                  <input
                    className={inputClass}
                    value={strategyForm.audience}
                    onChange={(event) =>
                      setStrategyForm((form) => form && { ...form, audience: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Posting frequency</label>
                  <input
                    className={inputClass}
                    value={strategyForm.postingFrequency}
                    onChange={(event) =>
                      setStrategyForm(
                        (form) => form && { ...form, postingFrequency: event.target.value }
                      )
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Themes (comma separated)</label>
                  <input
                    className={inputClass}
                    value={strategyForm.themes}
                    onChange={(event) =>
                      setStrategyForm((form) => form && { ...form, themes: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Desired outcomes (comma separated)</label>
                  <input
                    className={inputClass}
                    value={strategyForm.desiredOutcomes}
                    onChange={(event) =>
                      setStrategyForm(
                        (form) => form && { ...form, desiredOutcomes: event.target.value }
                      )
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Start date</label>
                  <input
                    type="date"
                    className={inputClass}
                    value={strategyForm.startDate}
                    onChange={(event) =>
                      setStrategyForm(form => form && { ...form, startDate: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Timezone</label>
                  <input
                    className={inputClass}
                    value={strategyForm.timezone}
                    onChange={(event) =>
                      setStrategyForm(form => form && { ...form, timezone: event.target.value })
                    }
                  />
                </div>
                {detail.campaign.platforms.includes('reddit') && (
                  <div>
                    <label className={labelClass}>Subreddit</label>
                    <input
                      className={inputClass}
                      value={strategyForm.redditSubreddit}
                      onChange={(event) =>
                        setStrategyForm(
                          (form) => form && { ...form, redditSubreddit: event.target.value }
                        )
                      }
                    />
                  </div>
                )}
              </div>
              <h3 className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#8b949e]">
                Content calendar
              </h3>
              {strategyForm.ideas.length === 0 ? (
                <Empty>No calendar entries yet.</Empty>
              ) : (
                <div className="min-w-0 overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-line text-[10px] uppercase tracking-[0.05em] text-[#8b949e]">
                        <th className="px-2 py-1.5">Day</th>
                        <th className="px-2 py-1.5">Platform</th>
                        <th className="px-2 py-1.5">Topic</th>
                        <th className="px-2 py-1.5">Angle</th>
                        <th className="px-2 py-1.5">State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {strategyForm.ideas.map((idea, index) => {
                        const saved = detail.ideas.find((row) => row.id === idea.id);
                        return (
                          <tr key={idea.id} className="border-b border-line-soft">
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                min={1}
                                max={detail.campaign.durationDays}
                                className="h-8 w-16 rounded-md border border-line bg-canvas-inset px-2 text-[12px] text-ink"
                                value={idea.day}
                                onChange={(event) =>
                                  setStrategyForm(
                                    (form) =>
                                      form && {
                                        ...form,
                                        ideas: form.ideas.map((row, rowIndex) =>
                                          rowIndex === index
                                            ? { ...row, day: Number(event.target.value) }
                                            : row
                                        ),
                                      }
                                  )
                                }
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <select
                                className="h-8 rounded-md border border-line bg-canvas-inset px-2 text-[12px] text-ink"
                                value={idea.platformId}
                                onChange={(event) =>
                                  setStrategyForm(
                                    (form) =>
                                      form && {
                                        ...form,
                                        ideas: form.ideas.map((row, rowIndex) =>
                                          rowIndex === index
                                            ? { ...row, platformId: event.target.value }
                                            : row
                                        ),
                                      }
                                  )
                                }
                              >
                                {detail.campaign.platforms.map((platformId) => (
                                  <option key={platformId} value={platformId}>
                                    {byId(platformId)?.name || platformId}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                className="h-8 w-full min-w-[140px] rounded-md border border-line bg-canvas-inset px-2 text-[12px] text-ink"
                                value={idea.topic}
                                onChange={(event) =>
                                  setStrategyForm(
                                    (form) =>
                                      form && {
                                        ...form,
                                        ideas: form.ideas.map((row, rowIndex) =>
                                          rowIndex === index
                                            ? { ...row, topic: event.target.value }
                                            : row
                                        ),
                                      }
                                  )
                                }
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                className="h-8 w-full min-w-[140px] rounded-md border border-line bg-canvas-inset px-2 text-[12px] text-ink"
                                value={idea.angle}
                                onChange={(event) =>
                                  setStrategyForm(
                                    (form) =>
                                      form && {
                                        ...form,
                                        ideas: form.ideas.map((row, rowIndex) =>
                                          rowIndex === index
                                            ? { ...row, angle: event.target.value }
                                            : row
                                        ),
                                      }
                                  )
                                }
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <Badge
                                tone={
                                  saved?.status === 'generated'
                                    ? 'success'
                                    : saved?.status === 'failed'
                                      ? 'error'
                                      : saved?.status === 'partial'
                                        ? 'warning'
                                        : 'neutral'
                                }
                              >
                                {saved?.status || 'planned'}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Panel>

        <Panel
          icon={<PenLine className="h-4 w-4" />}
          title="D. Content Studio"
          description="Each variation is saved as an ordinary Crewlink draft. Platform limits and link checks use the existing validators; nothing is truncated."
          action={
            detail ? (
              <Link href="/publishing" className={buttonSecondary}>
                Open Publishing <ExternalLink className="h-3 w-3" />
              </Link>
            ) : undefined
          }
        >
          {!detail ? (
            <Empty>Create and run a campaign to generate drafts.</Empty>
          ) : detail.ideas.length === 0 ? (
            <Empty>No content ideas yet.</Empty>
          ) : (
            <div className="space-y-4">
              {detail.ideas.map((idea) => (
                <IdeaBlock
                  key={idea.id}
                  idea={idea}
                  posts={generatedByIdea.get(idea.id) || []}
                  draftById={draftById}
                  busy={busy}
                  disabled={!canUseAgent}
                  onGenerate={generateIdea}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel
          icon={<ShieldCheck className="h-4 w-4" />}
          title="E. Review Center"
          description="The score is advisory, not objective truth. Crewlink checks facts only against retrieved sources, does not open links, and cannot detect every misleading claim."
          action={
            detail ? (
              <Link href="/publishing" className={buttonSecondary}>
                Approve &amp; publish in Publishing <ExternalLink className="h-3 w-3" />
              </Link>
            ) : undefined
          }
        >
          {!detail ? (
            <Empty>Create and run a campaign to review drafts.</Empty>
          ) : detail.generated.length === 0 ? (
            <Empty>No generated drafts to review.</Empty>
          ) : (
            <div className="space-y-3">
              {detail.generated.map((post) => {
                const draft = draftById.get(post.draftId);
                return (
                  <div key={post.id} className="rounded-md border border-line bg-panel-2 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-ink">
                          {byId(post.platformId)?.name || post.platformId} · variation{' '}
                          {post.variationIndex + 1}
                        </p>
                        <p className="text-[10px] text-[#8b949e]">
                          draft: {draft?.status || 'missing'} · quality:{' '}
                          {post.quality ? `${post.quality.score}/100 (advisory)` : 'not reviewed'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className={buttonSecondary}
                          disabled={Boolean(busy) || !canUseAgent}
                          onClick={() => void reviewDraft(post.draftId)}
                        >
                          {busy === `review:${post.draftId}` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                          Re-run review
                        </button>
                        {draft?.status !== 'approved' && draft?.status !== 'skipped' && (
                          <button
                            type="button"
                            className={buttonSecondary}
                            disabled={Boolean(busy)}
                            onClick={() => void approveDraft(post.draftId)}
                          >
                            {busy === `approve:${post.draftId}` ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            Approve
                          </button>
                        )}
                        {draft?.status === 'approved' && <Badge tone="success">approved</Badge>}
                      </div>
                    </div>
                    {draft && (
                      <p className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#c9d1d9]">
                        {draft.text}
                      </p>
                    )}
                    {post.quality ? (
                      <div className="mt-2">
                        <p className="text-[10px] text-[#8b949e]">
                          {post.quality.verificationStatus} · links {post.quality.linkCheck} ·{' '}
                          {post.quality.provider}/{post.quality.model}
                        </p>
                        <p className="mt-0.5 text-[10px] text-[#8b949e]">
                          {post.quality.disclaimer}
                        </p>
                        {post.quality.issues.length > 0 && (
                          <ul className="mt-1.5 space-y-1">
                            {post.quality.issues.map((issue, index) => (
                              <li
                                key={`${issue.code}-${index}`}
                                className={`rounded border px-2 py-1 text-[11px] ${severityClass[issue.severity]}`}
                              >
                                {issue.message}
                              </li>
                            ))}
                          </ul>
                        )}
                        {post.quality.improvements.length > 0 && (
                          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-[#c9d1d9]">
                            {post.quality.improvements.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        )}
                        {post.quality.sourceUrls.length > 0 && (
                          <p className="mt-1 break-all text-[10px] text-[#8b949e]">
                            Sources: {post.quality.sourceUrls.join(' · ')}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 text-[11px] text-[#8b949e]">
                        No review has run for this draft yet.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel
          icon={<CalendarDays className="h-4 w-4" />}
          title="F. Scheduling Calendar"
          description="Times are heuristic spacing suggestions, not claimed optimal times. Save a time to override one. Crewlink does not post in the background."
          action={
            detail ? (
              <button
                type="button"
                className={buttonSecondary}
                disabled={Boolean(busy)}
                onClick={() => void recompute()}
              >
                {busy === 'schedule' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Recalculate suggestions
              </button>
            ) : undefined
          }
        >
          {!detail ? (
            <Empty>Create and run a campaign to schedule drafts.</Empty>
          ) : detail.schedules.length === 0 ? (
            <Empty>No schedule suggestions yet. Generate drafts first.</Empty>
          ) : (
            <div className="space-y-2">
              {detail.schedules.map((schedule) => (
                <ScheduleRow
                  key={schedule.id}
                  schedule={schedule}
                  draft={draftById.get(schedule.draftId)}
                  value={scheduleInputs[schedule.id] || ''}
                  busy={busy === `schedule:${schedule.id}`}
                  disabled={Boolean(busy)}
                  onChange={(value) =>
                    setScheduleInputs((inputs) => ({ ...inputs, [schedule.id]: value }))
                  }
                  onSave={() => void overrideTime(schedule.id)}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel
          icon={<BarChart3 className="h-4 w-4" />}
          title="G. Campaign Analytics"
          description="Only Crewlink publication records are counted. Engagement metrics are not collected because no official platform analytics API is connected."
          action={
            detail ? (
              <button
                type="button"
                className={buttonSecondary}
                disabled={Boolean(busy)}
                onClick={() => void refreshAnalytics()}
              >
                {busy === 'analytics' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh counts
              </button>
            ) : undefined
          }
        >
          {!detail?.analytics ? (
            <Empty>No analytics collected yet.</Empty>
          ) : (
            <div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Metric label="Published posts" value={detail.analytics.metrics.publishedPosts} />
                <Metric label="Failed posts" value={detail.analytics.metrics.failedPosts} />
                <Metric label="Scheduled posts" value={detail.analytics.metrics.scheduledPosts} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(detail.analytics.metrics.byPlatform).map(([platformId, count]) => (
                  <Badge key={platformId}>
                    {byId(platformId)?.name || platformId}: {count}
                  </Badge>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-[#8b949e]">
                {detail.analytics.note}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {detail.analytics.unavailable.map((metric) => (
                  <Badge key={metric}>{metric}: unavailable</Badge>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-panel-2 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.05em] text-[#8b949e]">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-ink">{value}</p>
    </div>
  );
}

function IdeaBlock({
  idea,
  posts,
  draftById,
  busy,
  disabled,
  onGenerate,
}: {
  idea: ContentIdea;
  posts: GeneratedPost[];
  draftById: Map<string, DraftView>;
  busy: string | null;
  disabled: boolean;
  onGenerate: (ideaId: string, force: boolean) => void;
}) {
  return (
    <div className="rounded-md border border-line bg-panel-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-ink">
            Day {idea.day} · {byId(idea.platformId)?.name || idea.platformId}
          </p>
          <p className="text-[12px] text-[#c9d1d9]">{idea.topic}</p>
          {idea.angle && <p className="text-[11px] text-[#8b949e]">{idea.angle}</p>}
          {idea.note && <p className="mt-1 text-[10px] text-[#e3b341]">{idea.note}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge
            tone={
              idea.status === 'generated'
                ? 'success'
                : idea.status === 'failed'
                  ? 'error'
                  : idea.status === 'partial'
                    ? 'warning'
                    : 'neutral'
            }
          >
            {idea.status}
          </Badge>
          <button
            type="button"
            className={buttonSecondary}
            disabled={disabled || Boolean(busy)}
            onClick={() => onGenerate(idea.id, posts.length > 0)}
          >
            {busy === `gen:${idea.id}` || busy === `regen:${idea.id}` ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PenLine className="h-3.5 w-3.5" />
            )}
            {posts.length ? 'Generate another' : 'Generate'}
          </button>
        </div>
      </div>
      {posts.length === 0 ? (
        <p className="mt-2 text-[11px] text-[#8b949e]">No drafts for this idea yet.</p>
      ) : (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {posts.map((post) => {
            const draft = draftById.get(post.draftId);
            return (
              <div key={post.id} className="rounded border border-line bg-panel p-2.5">
                <p className="text-[10px] uppercase tracking-[0.05em] text-[#8b949e]">
                  Variation {post.variationIndex + 1} · {draft?.status || 'missing'}
                  {post.quality ? ` · ${post.quality.score}/100` : ''}
                </p>
                <p className="mt-1 max-h-36 overflow-hidden whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#c9d1d9]">
                  {draft?.text || 'Draft text is unavailable.'}
                </p>
                {draft?.title && (
                  <p className="mt-1 text-[10px] text-[#8b949e]">Title: {draft.title}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScheduleRow({
  schedule,
  draft,
  value,
  busy,
  disabled,
  onChange,
  onSave,
}: {
  schedule: CampaignSchedule;
  draft?: DraftView;
  value: string;
  busy: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-line bg-panel-2 px-3 py-2">
      <div className="min-w-[160px] flex-1">
        <p className="text-[12px] text-ink">
          {formatInZone(schedule.scheduledFor, schedule.timezone)}
        </p>
        <p className="text-[10px] text-[#8b949e]">
          {schedule.platformId} · {schedule.source} · {schedule.status}
          {schedule.reason ? ` · ${schedule.reason}` : ''}
        </p>
        {draft && (
          <p className="mt-0.5 line-clamp-1 text-[10px] text-[#8b949e]">{draft.text}</p>
        )}
      </div>
      <input
        type="datetime-local"
        className="h-8 rounded-md border border-line bg-canvas-inset px-2 text-[11px] text-ink"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" className={buttonSecondary} disabled={disabled} onClick={onSave}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Set time
      </button>
    </div>
  );
}
