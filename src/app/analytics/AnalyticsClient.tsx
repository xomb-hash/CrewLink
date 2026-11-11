'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Minus,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  AnalyticsFact,
  AnalyticsInsight,
  AnalyticsPostRow,
  AnalyticsStatusResult,
  AnalyticsSupportStatus,
  AudienceResult,
  CampaignPerformance,
  OverviewResult,
  PlatformPerformance,
  TimingResult,
  TopContentResult,
  TrendDirection,
} from '@/analytics/types';
import { METRIC_LABELS, type MetricKey } from '@/analytics/metricsKeys';

interface AnalyticsProject {
  id: string;
  title: string;
  slug: string;
  repoFullName: string;
  isPrivate: boolean;
  logoUrl: string | null;
}

type TabId =
  | 'overview'
  | 'platforms'
  | 'posts'
  | 'top'
  | 'audience'
  | 'timing'
  | 'campaigns'
  | 'insights';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'platforms', label: 'Platforms' },
  { id: 'posts', label: 'Posts' },
  { id: 'top', label: 'Top content' },
  { id: 'audience', label: 'Audience' },
  { id: 'timing', label: 'Posting time' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'insights', label: 'AI insights' },
];

type RangePreset = '7' | '30' | '90' | 'custom';

interface Notice {
  tone: 'success' | 'error' | 'info';
  message: string;
}

interface PostFilterState {
  platformId: string;
  campaignId: string;
  contentType: string;
  performance: string;
  sort: string;
}

const DEFAULT_FILTERS: PostFilterState = {
  platformId: '',
  campaignId: '',
  contentType: '',
  performance: '',
  sort: 'publishedAt',
};

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

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US').format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(2)}%`;
}

function formatDate(value: string, timezone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeZone: timezone,
    }).format(date);
  } catch {
    return value.slice(0, 10);
  }
}

function formatDateTime(value: string, timezone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(date);
  } catch {
    return value;
  }
}

const SUPPORT_LABELS: Record<AnalyticsSupportStatus, string> = {
  supported: 'Supported',
  partial: 'Partial',
  needs_approval: 'Needs approval',
  needs_permission: 'Needs permission',
  unsupported: 'Unsupported',
};

const SUPPORT_CLASSES: Record<AnalyticsSupportStatus, string> = {
  supported: 'border-[#238636] bg-[#0f2a17] text-[#3fb950]',
  partial: 'border-[#9e6a03] bg-[#2a2110] text-[#d29922]',
  needs_approval: 'border-[#1f6feb] bg-[#0d1d33] text-[#58a6ff]',
  needs_permission: 'border-[#1f6feb] bg-[#0d1d33] text-[#58a6ff]',
  unsupported: 'border-[#da3633] bg-[#2d1214] text-[#f85149]',
};

function SupportBadge({ status }: { status: AnalyticsSupportStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-[0.02em] ${SUPPORT_CLASSES[status]}`}
    >
      {SUPPORT_LABELS[status]}
    </span>
  );
}

function TrendIcon({ trend }: { trend: TrendDirection }) {
  if (trend === 'up') return <ArrowUpRight className="h-3.5 w-3.5 text-[#3fb950]" aria-label="up" />;
  if (trend === 'down')
    return <ArrowDownRight className="h-3.5 w-3.5 text-[#f85149]" aria-label="down" />;
  if (trend === 'flat') return <Minus className="h-3.5 w-3.5 text-[#8b949e]" aria-label="flat" />;
  return <Minus className="h-3.5 w-3.5 text-[#484f58]" aria-label="unknown" />;
}

function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[10px] border border-line bg-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium text-ink">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[11px] leading-relaxed text-[#8b949e]">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-3">
      <p className="text-[10px] uppercase tracking-[0.06em] text-[#8b949e]">{label}</p>
      <p className="mt-1 text-[20px] font-semibold leading-tight text-ink">{value}</p>
      {detail ? <p className="mt-1 text-[11px] leading-relaxed text-[#8b949e]">{detail}</p> : null}
    </div>
  );
}

function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line-soft bg-panel-2 px-5 py-10 text-center">
      <BarChart3 className="mx-auto h-6 w-6 text-[#484f58]" strokeWidth={1.4} />
      <p className="mt-3 text-[13px] font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-[#8b949e]">{body}</p>
      {action ? <div className="mt-4 flex justify-center gap-2">{action}</div> : null}
    </div>
  );
}

function LoadingBlock({ label = 'Loading analytics…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-line-soft py-12 text-[12px] text-[#8b949e]">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[#da3633] bg-[#2d1214] px-3 py-2.5 text-[12px] text-[#ffb4ab]">
      <span className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        {message}
      </span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className={BUTTON}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

function NoticeBanner({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const classes =
    notice.tone === 'error'
      ? 'border-[#da3633] bg-[#2d1214] text-[#ffb4ab]'
      : notice.tone === 'success'
        ? 'border-[#238636] bg-[#0f2a17] text-[#7ee787]'
        : 'border-[#1f6feb] bg-[#0d1d33] text-[#a5d6ff]';
  return (
    <div className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-[12px] ${classes}`}>
      <span className="flex items-start gap-2">
        {notice.tone === 'error' ? (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        )}
        {notice.message}
      </span>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="opacity-80 hover:opacity-100">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

const BUTTON =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel-2 px-3 text-[12px] text-ink transition-colors hover:border-[#484f58] disabled:cursor-not-allowed disabled:opacity-50';
const INPUT =
  'h-8 rounded-md border border-line bg-canvas-inset px-2 text-[12px] text-ink placeholder:text-[#6e7681]';
const TH =
  'border-b border-line px-2.5 py-2 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#8b949e]';
const TD = 'border-b border-line-soft px-2.5 py-2 text-[12px] text-ink align-top';

function Sparkline({ values, className = '' }: { values: Array<number | null>; className?: string }) {
  const numbers = values.filter((value): value is number => value !== null);
  if (numbers.length < 2) {
    return <span className={`text-[11px] text-[#6e7681] ${className}`}>Not enough history</span>;
  }
  const max = Math.max(...numbers);
  const min = Math.min(...numbers);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      if (value === null) return null;
      const x = (index / Math.max(1, values.length - 1)) * 100;
      const y = 28 - ((value - min) / span) * 24;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter((point): point is string => Boolean(point))
    .join(' ');
  return (
    <svg viewBox="0 0 100 32" className={`h-8 w-full ${className}`} role="img" aria-label="trend">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.6" className="text-[#58a6ff]" />
    </svg>
  );
}

function TrendChart({ points, timezone }: { points: Array<{ date: string; engagement: number | null }>; timezone: string }) {
  const values = points.map((point) => point.engagement);
  const numbers = values.filter((value): value is number => value !== null);
  if (numbers.length < 2) {
    return (
      <p className="rounded-md border border-dashed border-line-soft px-3 py-8 text-center text-[12px] text-[#8b949e]">
        Engagement trend needs at least two days with measured posts. Run a sync after publishing.
      </p>
    );
  }
  const max = Math.max(...numbers);
  const span = max || 1;
  const width = 640;
  const height = 140;
  const polyline = points
    .map((point, index) => {
      if (point.engagement === null) return null;
      const x = (index / Math.max(1, points.length - 1)) * width;
      const y = height - (point.engagement / span) * (height - 16) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter((point): point is string => Boolean(point))
    .join(' ');
  const firstDate = points[0]?.date;
  const lastDate = points[points.length - 1]?.date;
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-label="Engagement over time">
        <line x1="0" y1={height - 4} x2={width} y2={height - 4} stroke="#30363d" strokeWidth="1" />
        <polyline points={polyline} fill="none" stroke="#58a6ff" strokeWidth="2" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-[#6e7681]">
        <span>{firstDate ? formatDate(firstDate, timezone) : ''}</span>
        <span>Peak: {formatNumber(max)} engagement actions</span>
        <span>{lastDate ? formatDate(lastDate, timezone) : ''}</span>
      </div>
    </div>
  );
}

function MetricChips({ row }: { row: AnalyticsPostRow }) {
  const keys: MetricKey[] = ['impressions', 'likes', 'comments', 'reposts', 'saves', 'score'];
  const present = keys.filter((key) => typeof row.metrics[key] === 'number');
  if (!present.length) {
    return <span className="text-[11px] text-[#6e7681]">No platform metrics</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {present.map((key) => (
        <span
          key={key}
          className="inline-flex items-center rounded border border-line bg-panel-2 px-1.5 py-0.5 text-[10px] text-[#c9d1d9]"
        >
          {METRIC_LABELS[key]}: {formatNumber(row.metrics[key])}
        </span>
      ))}
    </div>
  );
}

function CampaignSelect({
  campaigns,
  value,
  onChange,
  includeAll = true,
}: {
  campaigns: CampaignPerformance[];
  value: string;
  onChange: (value: string) => void;
  includeAll?: boolean;
}) {
  return (
    <select className={INPUT} value={value} onChange={(event) => onChange(event.target.value)}>
      {includeAll ? <option value="">All campaigns</option> : null}
      {campaigns.map((campaign) => (
        <option key={campaign.campaignId} value={campaign.campaignId}>
          {campaign.name}
        </option>
      ))}
    </select>
  );
}

function FactChips({ facts }: { facts: AnalyticsFact[] }) {
  if (!facts.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {facts.map((fact) => (
        <span
          key={fact.id}
          title={`${fact.definition}${fact.completeness !== 'complete' ? ` (${fact.completeness})` : ''}`}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
            fact.completeness === 'complete'
              ? 'border-line bg-panel text-[#c9d1d9]'
              : 'border-[#9e6a03] bg-[#2a2110] text-[#e3b341]'
          }`}
        >
          <span className="text-[#8b949e]">{fact.label}:</span>
          <span>{fact.formatted}</span>
          {fact.completeness !== 'complete' ? <span>({fact.completeness})</span> : null}
        </span>
      ))}
    </div>
  );
}

function insightBrief(insight: AnalyticsInsight): string {
  const lines = [
    `Crewlink performance insight (${insight.periodStart} to ${insight.periodEnd})`,
    insight.payload.renderedSummary || insight.payload.summary,
    '',
  ];
  for (const finding of insight.payload.findings) {
    lines.push(
      `Finding: ${finding.renderedStatement || finding.statement} (sample ${finding.sampleSize}, ${finding.confidence} confidence)`
    );
    for (const fact of finding.facts || []) lines.push(`Fact: ${fact.label} = ${fact.formatted}`);
  }
  for (const recommendation of insight.payload.recommendations) {
    lines.push(`Recommendation: ${recommendation.renderedAction || recommendation.action}`);
    const rationale = recommendation.renderedRationale || recommendation.rationale;
    if (rationale) lines.push(`Why: ${rationale}`);
  }
  lines.push('', 'AI output is unverified and advisory; no campaign was changed.');
  return lines.join('\n');
}

export function AnalyticsClient({ projects }: { projects: AnalyticsProject[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [tab, setTab] = useState<TabId>('overview');
  const [preset, setPreset] = useState<RangePreset>('30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedCustom, setAppliedCustom] = useState<{ from: string; to: string } | null>(null);
  const [timezone] = useState(localTimezone());

  const [overview, setOverview] = useState<OverviewResult | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([]);
  const [status, setStatus] = useState<AnalyticsStatusResult | null>(null);

  const [posts, setPosts] = useState<{ rows: AnalyticsPostRow[]; total: number } | null>(null);
  const [top, setTop] = useState<TopContentResult | null>(null);
  const [audience, setAudience] = useState<AudienceResult | null>(null);
  const [timing, setTiming] = useState<TimingResult | null>(null);
  const [insights, setInsights] = useState<AnalyticsInsight[]>([]);
  const [insightCampaign, setInsightCampaign] = useState('');
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState('');

  const [filters, setFilters] = useState<PostFilterState>(DEFAULT_FILTERS);
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [insightLoading, setInsightLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const rangeKey = appliedCustom
    ? `${preset}:${appliedCustom.from}:${appliedCustom.to}`
    : preset;

  const rangeQuery = useCallback((): string => {
    const params = new URLSearchParams();
    if (preset === 'custom' && appliedCustom) {
      params.set('from', appliedCustom.from);
      params.set('to', appliedCustom.to);
    } else {
      params.set('days', preset === 'custom' ? '30' : preset);
    }
    params.set('timezone', timezone);
    return params.toString();
  }, [preset, appliedCustom, timezone]);

  const projectQuery = useCallback((): string => {
    if (!projectId) return '';
    return `projectId=${encodeURIComponent(projectId)}`;
  }, [projectId]);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  // Overview, support status and campaigns load whenever the project or range
  // changes; individual tabs then load only their own data.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setOverviewLoading(true);
    setOverviewError('');
    Promise.all([
      api<OverviewResult>(`/api/analytics/overview?${projectQuery()}&${rangeQuery()}`),
      api<AnalyticsStatusResult>(`/api/analytics/status?${projectQuery()}`),
      api<{ campaigns: CampaignPerformance[] }>(`/api/analytics/campaigns?${projectQuery()}&${rangeQuery()}`),
    ])
      .then(([overviewData, statusData, campaignData]) => {
        if (cancelled) return;
        setOverview(overviewData);
        setStatus(statusData);
        setCampaigns(campaignData.campaigns);
      })
      .catch((error) => {
        if (!cancelled) setOverviewError(errorText(error));
      })
      .finally(() => {
        if (!cancelled) setOverviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, projectQuery, rangeQuery, refreshToken]);

  useEffect(() => {
    if (!projectId) return;
    if (tab === 'overview' || tab === 'platforms') return;
    let cancelled = false;
    setTabLoading(true);
    setTabError('');
    const common = `${projectQuery()}&${rangeQuery()}`;
    const load = async () => {
      if (tab === 'posts') {
        const params = new URLSearchParams({
          limit: '50',
          offset: String(page * 50),
          sort: filters.sort,
          order: 'desc',
        });
        if (filters.platformId) params.set('platformId', filters.platformId);
        if (filters.campaignId) params.set('campaignId', filters.campaignId);
        if (filters.contentType) params.set('contentType', filters.contentType);
        if (filters.performance) params.set('performance', filters.performance);
        const data = await api<{ rows: AnalyticsPostRow[]; total: number }>(
          `/api/analytics/posts?${common}&${params.toString()}`
        );
        if (!cancelled) setPosts(data);
      } else if (tab === 'top') {
        const data = await api<TopContentResult>(`/api/analytics/top?${common}`);
        if (!cancelled) setTop(data);
      } else if (tab === 'audience') {
        const data = await api<AudienceResult>(`/api/analytics/audience?${common}`);
        if (!cancelled) setAudience(data);
      } else if (tab === 'timing') {
        const data = await api<TimingResult>(`/api/analytics/timing?${common}`);
        if (!cancelled) setTiming(data);
      } else if (tab === 'campaigns') {
        const data = await api<{ campaigns: CampaignPerformance[] }>(
          `/api/analytics/campaigns?${common}`
        );
        if (!cancelled) setCampaigns(data.campaigns);
      } else if (tab === 'insights') {
        const campaignParam = insightCampaign
          ? `&campaignId=${encodeURIComponent(insightCampaign)}`
          : '';
        const data = await api<{ insights: AnalyticsInsight[] }>(
          `/api/analytics/insights?${projectQuery()}${campaignParam}`
        );
        if (!cancelled) setInsights(data.insights);
      }
    };
    load()
      .catch((error) => {
        if (!cancelled) setTabError(errorText(error));
      })
      .finally(() => {
        if (!cancelled) setTabLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    tab,
    rangeQuery,
    projectQuery,
    page,
    filters,
    insightCampaign,
    refreshToken,
  ]);

  const activeProject = projects.find((project) => project.id === projectId) || null;
  const providerConfigured = status?.provider.configured === true;

  const postPlatforms = useMemo(
    () => (overview?.platforms || []).filter((platform) => platform.supportStatus !== 'unsupported'),
    [overview]
  );

  async function handleSync(platformIds?: string[]) {
    if (!projectId) return;
    setSyncing(true);
    setNotice(null);
    try {
      const result = await api<{
        results: Array<{ platformId: string; status: string; note: string }>;
      }>('/api/analytics/sync', {
        method: 'POST',
        body: JSON.stringify({ projectId, ...(platformIds ? { platformIds } : {}) }),
      });
      const summary = result.results.length
        ? result.results.map((row) => `${row.platformId}: ${row.status}`).join(' · ')
        : 'No connected analytics platforms were found.';
      setNotice({ tone: result.results.some((row) => row.status === 'failed') ? 'error' : 'success', message: summary });
      refresh();
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setSyncing(false);
    }
  }

  async function generateInsight(campaignId?: string) {
    if (!projectId) return;
    setInsightLoading(true);
    setNotice(null);
    try {
      const params = new URLSearchParams(rangeQuery());
      const body: Record<string, unknown> = { projectId };
      for (const [key, value] of params.entries()) {
        if (key === 'days' || key === 'from' || key === 'to' || key === 'timezone') {
          body[key] = key === 'days' ? Number(value) : value;
        }
      }
      if (campaignId) body.campaignId = campaignId;
      await api('/api/analytics/insights', { method: 'POST', body: JSON.stringify(body) });
      setNotice({ tone: 'success', message: campaignId ? 'Campaign insight generated.' : 'Project insight generated.' });
      if (tab === 'insights') refresh();
      else setTab('insights');
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    } finally {
      setInsightLoading(false);
    }
  }

  async function updateInsight(id: string, nextStatus: 'accepted' | 'dismissed') {
    try {
      const data = await api<{ insight: AnalyticsInsight }>(`/api/analytics/insights/${id}/accept`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus }),
      });
      setInsights((current) =>
        current.map((insight) => (insight.id === id ? data.insight : insight))
      );
      setNotice({
        tone: 'success',
        message: nextStatus === 'accepted' ? 'Insight marked accepted.' : 'Insight dismissed.',
      });
    } catch (error) {
      setNotice({ tone: 'error', message: errorText(error) });
    }
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice({ tone: 'success', message: `${label} copied.` });
    } catch {
      setNotice({ tone: 'error', message: 'Could not copy to the clipboard.' });
    }
  }

  if (!projects.length) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Empty
          title="Create a project first"
          body="Analytics follows the posts Crewlink published for a project. Create a project, publish an approved draft, then return here."
          action={
            <Link href="/projects/new" className={BUTTON}>
              Create project
            </Link>
          }
        />
      </div>
    );
  }

  const syncLabel = syncing ? 'Syncing…' : 'Sync analytics';

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-ink">Analytics</h1>
          <p className="mt-0.5 text-[12px] text-[#8b949e]">
            Platform-reported metrics, Crewlink calculations, and advisory AI analysis.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BUTTON} onClick={() => handleSync()} disabled={syncing}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {syncLabel}
          </button>
          <a
            className={BUTTON}
            href={`/api/analytics/report?${projectQuery()}&${rangeQuery()}&format=csv`}
            download
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </a>
          <a
            className={BUTTON}
            href={`/api/analytics/report?${projectQuery()}&${rangeQuery()}&format=pdf`}
            download
          >
            <FileText className="h-3.5 w-3.5" /> PDF
          </a>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-panel px-3 py-2.5">
        <select
          className={`${INPUT} max-w-[260px]`}
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
            setPage(0);
            setOverview(null);
            setPosts(null);
            setTop(null);
            setAudience(null);
            setTiming(null);
            setInsights([]);
            setCampaigns([]);
          }}
          aria-label="Project"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 rounded-md border border-line bg-canvas-inset p-0.5">
          {(['7', '30', '90'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setPreset(value);
                setAppliedCustom(null);
                setPage(0);
              }}
              className={`h-7 rounded px-2 text-[11px] ${
                preset === value ? 'bg-panel-2 text-ink' : 'text-[#8b949e] hover:text-ink'
              }`}
            >
              {value}d
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPreset('custom')}
            className={`h-7 rounded px-2 text-[11px] ${
              preset === 'custom' ? 'bg-panel-2 text-ink' : 'text-[#8b949e] hover:text-ink'
            }`}
          >
            Custom
          </button>
        </div>

        {preset === 'custom' ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              aria-label="Start date"
              className={INPUT}
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
            />
            <span className="text-[11px] text-[#8b949e]">to</span>
            <input
              type="date"
              aria-label="End date"
              className={INPUT}
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
            />
            <button
              type="button"
              className={BUTTON}
              onClick={() => {
                if (!customFrom || !customTo) {
                  setNotice({ tone: 'error', message: 'Choose both dates.' });
                  return;
                }
                if (customFrom > customTo) {
                  setNotice({ tone: 'error', message: 'The start date must be before the end date.' });
                  return;
                }
                setAppliedCustom({ from: customFrom, to: customTo });
                setPage(0);
              }}
            >
              Apply
            </button>
          </div>
        ) : null}

        <span className="ml-auto flex items-center gap-1 text-[11px] text-[#8b949e]">
          <Clock className="h-3.5 w-3.5" /> Times grouped in {timezone}
        </span>
      </div>

      {notice ? <div className="mb-3"><NoticeBanner notice={notice} onClose={() => setNotice(null)} /></div> : null}

      {!providerConfigured && status ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-[#9e6a03] bg-[#2a2110] px-3 py-2.5 text-[12px] text-[#e3b341]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          AI insights are unavailable: the {status.provider.provider} provider is not configured. Metrics and reports still work.
        </div>
      ) : null}

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line pb-px">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? 'page' : undefined}
            className={`flex-shrink-0 border-b-2 px-3 py-2 text-[12px] transition-colors ${
              tab === item.id
                ? 'border-[#f78166] text-ink'
                : 'border-transparent text-[#8b949e] hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {overviewError ? <ErrorBanner message={overviewError} onRetry={refresh} /> : null}
      {overviewLoading && !overview ? (
        <LoadingBlock />
      ) : !overview ? (
        overviewError ? null : <LoadingBlock />
      ) : tab === 'overview' ? (
        <OverviewTab
          overview={overview}
          timezone={timezone}
          onSync={() => handleSync()}
          syncing={syncing}
          onOpenTab={setTab}
        />
      ) : tab === 'platforms' ? (
        <PlatformsTab overview={overview} timezone={timezone} />
      ) : (
        <>
          {tabError ? <ErrorBanner message={tabError} onRetry={refresh} /> : null}
          {tabLoading ? (
            <LoadingBlock label="Loading this view…" />
          ) : tab === 'posts' ? (
            <PostsTab
              rows={posts?.rows || []}
              total={posts?.total || 0}
              page={page}
              onPage={setPage}
              filters={filters}
              onFilters={(next) => {
                setFilters(next);
                setPage(0);
              }}
              platforms={postPlatforms}
              campaigns={campaigns}
              timezone={timezone}
              onSync={() => handleSync()}
            />
          ) : tab === 'top' ? (
            <TopTab top={top} timezone={timezone} onSync={() => handleSync()} />
          ) : tab === 'audience' ? (
            <AudienceTab audience={audience} timezone={timezone} onSync={() => handleSync()} />
          ) : tab === 'timing' ? (
            <TimingTab timing={timing} onSync={() => handleSync()} />
          ) : tab === 'campaigns' ? (
            <CampaignsTab
              campaigns={campaigns}
              timezone={timezone}
              onAnalyze={generateInsight}
              analyzing={insightLoading}
              providerConfigured={providerConfigured}
            />
          ) : (
            <InsightsTab
              insights={insights}
              campaigns={campaigns}
              campaignId={insightCampaign}
              onCampaign={setInsightCampaign}
              onGenerate={generateInsight}
              onUpdate={updateInsight}
              onCopy={copyText}
              generating={insightLoading}
              providerConfigured={providerConfigured}
              timezone={timezone}
            />
          )}
        </>
      )}

      <div className="mt-6 rounded-lg border border-line-soft bg-panel-2 px-3 py-2.5 text-[11px] leading-relaxed text-[#8b949e]">
        <strong className="font-medium text-[#c9d1d9]">How to read this page.</strong> Platform
        metrics come only from official APIs and are stored as snapshots. Engagement totals are
        Crewlink-calculated sums of each platform&apos;s engagement actions and are not directly
        comparable across platforms. Engagement rates appear only when a platform returned an
        impressions denominator. A dash means the platform does not provide the metric, not zero.
        {activeProject ? ` Project: ${activeProject.repoFullName}.` : ''}
      </div>
    </div>
  );
}

function OverviewTab({
  overview,
  timezone,
  onSync,
  syncing,
  onOpenTab,
}: {
  overview: OverviewResult;
  timezone: string;
  onSync: () => void;
  syncing: boolean;
  onOpenTab: (tab: TabId) => void;
}) {
  const hasPosts = overview.posts.published > 0;
  const withMetrics = overview.posts.withMetrics;
  const platformsWithPosts = overview.platforms.filter((platform) => platform.posts > 0);
  const attention = overview.dataQuality.filter(
    (item) => item.supportStatus !== 'supported' || item.errorCode
  );

  return (
    <div className="space-y-4">
      {!hasPosts ? (
        <Empty
          title="No published posts in this range"
          body="Analytics only covers posts Crewlink published. Publish an approved draft, then run a sync. WhatsApp manual shares have no platform metrics."
          action={
            <>
              <Link href="/publishing" className={BUTTON}>
                Open publishing
              </Link>
              <button type="button" className={BUTTON} onClick={onSync} disabled={syncing}>
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Sync
              </button>
            </>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat label="Published" value={formatNumber(overview.posts.published)} detail={`${timezone} dates`} />
            <Stat
              label="With metrics"
              value={formatNumber(withMetrics)}
              detail={withMetrics < overview.posts.published ? `${overview.posts.published - withMetrics} without platform metrics` : 'All posts measured'}
            />
            <Stat
              label="Engagement"
              value={formatNumber(overview.engagement.value)}
              detail={overview.engagement.complete ? 'Crewlink-calculated sum' : 'Crewlink-calculated; partial (some actions missing)'}
            />
            <Stat
              label="Engagement rate"
              value={overview.engagementRate ? formatPercent(overview.engagementRate.value) : '—'}
              detail={overview.engagementRate ? 'Impressions denominator' : 'Not calculable'}
            />
            <Stat
              label="Impressions"
              value={formatNumber(overview.totals.impressions?.value)}
              detail={overview.totals.impressions?.complete ? 'Complete' : 'Partial or unavailable'}
            />
          </div>

          {withMetrics === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#9e6a03] bg-[#2a2110] px-3 py-2.5 text-[12px] text-[#e3b341]">
              <span className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                Posts are published, but no platform metrics have been collected yet.
              </span>
              <button type="button" className={BUTTON} onClick={onSync} disabled={syncing}>
                Run a sync
              </button>
            </div>
          ) : null}

          <Section
            title="Engagement trend"
            description="Measured engagement actions per day for posts published in this range. Missing days are gaps, not zero."
          >
            <TrendChart points={overview.trend} timezone={timezone} />
          </Section>

          <div className="grid gap-3 lg:grid-cols-3">
            <Section title="Compared with the previous period">
              <div className="space-y-2 text-[12px]">
                <ComparisonRow label="Engagement" current={overview.engagement.value} previous={overview.previous?.engagement ?? null} change={overview.changes.engagement} />
                <ComparisonRow label="Impressions" current={overview.totals.impressions?.value ?? null} previous={overview.previous?.impressions ?? null} change={overview.changes.impressions} />
                <ComparisonRow label="Published posts" current={overview.posts.published} previous={overview.previous?.posts ?? null} change={overview.changes.posts} />
                <p className="pt-1 text-[11px] leading-relaxed text-[#8b949e]">
                  {overview.previous
                    ? `Previous period: ${overview.previous.from} to ${overview.previous.to}.`
                    : 'No previous period is available.'}
                </p>
              </div>
            </Section>

            <Section
              title="Platforms"
              description="Only platforms with measured posts appear here."
              actions={
                <button type="button" className={BUTTON} onClick={() => onOpenTab('platforms')}>
                  Compare
                </button>
              }
            >
              {platformsWithPosts.length ? (
                <div className="space-y-2">
                  {platformsWithPosts.map((platform) => (
                    <div key={platform.platformId} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="flex items-center gap-1.5">
                        <span className="text-ink">{platform.name}</span>
                        <SupportBadge status={platform.supportStatus} />
                      </span>
                      <span className="text-[#8b949e]">
                        {platform.engagement.value !== null ? formatNumber(platform.engagement.value) : '—'} engagement
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-[#8b949e]">No platform returned metrics for this range.</p>
              )}
            </Section>

            <Section title="Data quality" description="What is missing and why.">
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1 text-[11px] leading-relaxed text-[#8b949e]">
                {attention.length ? (
                  attention.map((item) => (
                    <p key={item.platformId}>
                      <span className="text-[#c9d1d9]">{item.name}:</span> {item.reason}
                    </p>
                  ))
                ) : (
                  <p>Every connected platform returned all documented metrics.</p>
                )}
              </div>
            </Section>
          </div>

          {overview.engagementDefinitions.length ? (
            <Section
              title="What Crewlink calculates"
              description="These formulas are fixed in one module and are never inferred from a platform name."
            >
              <ul className="space-y-1 text-[11px] leading-relaxed text-[#8b949e]">
                {overview.engagementDefinitions.map((definition) => (
                  <li key={definition.platformId}>
                    <span className="text-[#c9d1d9]">{definition.platformId}</span>: {definition.label}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

function ComparisonRow({
  label,
  current,
  previous,
  change,
}: {
  label: string;
  current: number | null;
  previous: number | null;
  change: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#8b949e]">{label}</span>
      <span className="flex items-center gap-2 text-ink">
        <span>{formatNumber(current)}</span>
        <span className="text-[10px] text-[#6e7681]">was {formatNumber(previous)}</span>
        {change === null ? (
          <Minus className="h-3.5 w-3.5 text-[#484f58]" />
        ) : change > 0 ? (
          <span className="flex items-center gap-0.5 text-[#3fb950]">
            <ArrowUpRight className="h-3.5 w-3.5" /> {change}%
          </span>
        ) : change < 0 ? (
          <span className="flex items-center gap-0.5 text-[#f85149]">
            <ArrowDownRight className="h-3.5 w-3.5" /> {change}%
          </span>
        ) : (
          <span className="text-[#8b949e]">0%</span>
        )}
      </span>
    </div>
  );
}

function PlatformsTab({ overview, timezone }: { overview: OverviewResult; timezone: string }) {
  const rows = overview.platforms;
  return (
    <div className="space-y-4">
      <Section
        title="Platform comparison"
        description="Raw platform-reported totals and Crewlink-calculated sums. Do not compare a Reddit score with an X impression; the definitions differ."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead>
              <tr>
                <th className={TH}>Platform</th>
                <th className={TH}>Support</th>
                <th className={TH}>Posts</th>
                <th className={TH}>Engagement</th>
                <th className={TH}>Rate</th>
                <th className={TH}>Impressions</th>
                <th className={TH}>Avg / post</th>
                <th className={TH}>Posts / day</th>
                <th className={TH}>Trend</th>
                <th className={TH}>Last sync</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((platform) => (
                <tr key={platform.platformId}>
                  <td className={TD}>
                    <div className="font-medium text-ink">{platform.name}</div>
                    <div className="mt-0.5 max-w-[260px] text-[10px] leading-relaxed text-[#6e7681]">
                      {platform.unavailableMetrics.length
                        ? `Unavailable: ${platform.unavailableMetrics.map((key) => METRIC_LABELS[key]).join(', ')}`
                        : 'All documented metrics available'}
                    </div>
                  </td>
                  <td className={TD}>
                    <SupportBadge status={platform.supportStatus} />
                  </td>
                  <td className={TD}>{formatNumber(platform.posts)}</td>
                  <td className={TD}>
                    {formatNumber(platform.engagement.value)}
                    {platform.engagement.value !== null && !platform.engagement.complete ? (
                      <span className="ml-1 text-[10px] text-[#d29922]">(partial)</span>
                    ) : null}
                  </td>
                  <td className={TD}>
                    {platform.engagementRate !== null ? formatPercent(platform.engagementRate) : '—'}
                  </td>
                  <td className={TD}>{formatNumber(platform.metrics.impressions?.value)}</td>
                  <td className={TD}>{formatNumber(platform.averageEngagementPerPost)}</td>
                  <td className={TD}>{platform.publishingFrequency || '—'}</td>
                  <td className={TD}><TrendIcon trend={platform.trend} /></td>
                  <td className={TD}>
                    {platform.lastSyncedAt ? formatDateTime(platform.lastSyncedAt, timezone) : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Unavailable metrics" description="Explicit gaps, not zeros.">
        <div className="grid gap-2 md:grid-cols-2">
          {rows
            .filter((platform) => platform.unavailableMetrics.length || platform.supportStatus !== 'supported')
            .map((platform) => (
              <div key={platform.platformId} className="rounded-md border border-line bg-panel-2 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-ink">{platform.name}</span>
                  <SupportBadge status={platform.supportStatus} />
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[#8b949e]">{platform.note}</p>
                {platform.unavailableMetrics.length ? (
                  <p className="mt-1 text-[10px] text-[#6e7681]">
                    Unavailable: {platform.unavailableMetrics.map((key) => METRIC_LABELS[key]).join(', ')}
                  </p>
                ) : null}
              </div>
            ))}
        </div>
      </Section>
    </div>
  );
}

function PostsTab({
  rows,
  total,
  page,
  onPage,
  filters,
  onFilters,
  platforms,
  campaigns,
  timezone,
  onSync,
}: {
  rows: AnalyticsPostRow[];
  total: number;
  page: number;
  onPage: (page: number) => void;
  filters: PostFilterState;
  onFilters: (next: PostFilterState) => void;
  platforms: PlatformPerformance[];
  campaigns: CampaignPerformance[];
  timezone: string;
  onSync: () => void;
}) {
  return (
    <Section
      title="Post performance"
      description="One row per published post. Preview text is visible only to the project owner."
      actions={
        <button type="button" className={BUTTON} onClick={onSync}>
          <RefreshCw className="h-3.5 w-3.5" /> Sync
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className={INPUT}
          value={filters.platformId}
          onChange={(event) => onFilters({ ...filters, platformId: event.target.value })}
          aria-label="Filter platform"
        >
          <option value="">All platforms</option>
          {platforms.map((platform) => (
            <option key={platform.platformId} value={platform.platformId}>
              {platform.name}
            </option>
          ))}
        </select>
        <CampaignSelect
          campaigns={campaigns}
          value={filters.campaignId}
          onChange={(value) => onFilters({ ...filters, campaignId: value })}
        />
        <select
          className={INPUT}
          value={filters.contentType}
          onChange={(event) => onFilters({ ...filters, contentType: event.target.value })}
          aria-label="Filter content type"
        >
          <option value="">All content types</option>
          <option value="text">Text</option>
          <option value="thread">Thread</option>
          <option value="link">Link post</option>
          <option value="message">Chat message</option>
          <option value="short">Short post</option>
          <option value="manual">Manual share</option>
        </select>
        <select
          className={INPUT}
          value={filters.performance}
          onChange={(event) => onFilters({ ...filters, performance: event.target.value })}
          aria-label="Filter performance"
        >
          <option value="">Any performance</option>
          <option value="top">Top quartile</option>
          <option value="typical">Typical</option>
          <option value="weak">Weak quartile</option>
        </select>
        <select
          className={INPUT}
          value={filters.sort}
          onChange={(event) => onFilters({ ...filters, sort: event.target.value })}
          aria-label="Sort by"
        >
          <option value="publishedAt">Newest</option>
          <option value="engagement">Engagement</option>
          <option value="impressions">Impressions</option>
          <option value="likes">Likes</option>
          <option value="comments">Comments</option>
        </select>
        <span className="ml-auto text-[11px] text-[#8b949e]">{formatNumber(total)} post(s)</span>
      </div>

      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse">
            <thead>
              <tr>
                <th className={TH}>Post</th>
                <th className={TH}>Platform</th>
                <th className={TH}>Campaign</th>
                <th className={TH}>Published</th>
                <th className={TH}>Metrics</th>
                <th className={TH}>Engagement</th>
                <th className={TH}>Rate</th>
                <th className={TH}>Trend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={TD}>
                    <div className="max-w-[300px]">
                      {row.externalUrl ? (
                        <a
                          href={row.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-start gap-1 text-[12px] text-[#58a6ff] hover:underline"
                        >
                          <span className="line-clamp-2">{row.preview || 'Open post'}</span>
                          <ExternalLink className="mt-0.5 h-3 w-3 flex-shrink-0" />
                        </a>
                      ) : (
                        <span className="line-clamp-2 text-[12px] text-[#c9d1d9]">{row.preview || 'No preview'}</span>
                      )}
                      {row.note ? <p className="mt-1 text-[10px] text-[#6e7681]">{row.note}</p> : null}
                    </div>
                  </td>
                  <td className={TD}>{row.platformName}</td>
                  <td className={TD}>{row.campaignName || '—'}</td>
                  <td className={TD}>{formatDate(row.publishedAt, timezone)}</td>
                  <td className={TD}><MetricChips row={row} /></td>
                  <td className={TD}>
                    {formatNumber(row.engagement)}
                    {row.engagement !== null && !row.engagementComplete ? (
                      <span className="ml-1 text-[10px] text-[#d29922]">(partial)</span>
                    ) : null}
                  </td>
                  <td className={TD}>{row.engagementRate !== null ? formatPercent(row.engagementRate) : '—'}</td>
                  <td className={TD}><TrendIcon trend={row.trend} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="No posts match these filters"
          body="Clear a filter or publish and sync a post. Analytics never invents a row for a post that was not published."
        />
      )}

      {total > 50 ? (
        <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-[#8b949e]">
          <span>
            Page {page + 1} of {Math.max(1, Math.ceil(total / 50))}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className={BUTTON}
              disabled={page === 0}
              onClick={() => onPage(Math.max(0, page - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className={BUTTON}
              disabled={(page + 1) * 50 >= total}
              onClick={() => onPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function TopTab({ top, timezone, onSync }: { top: TopContentResult | null; timezone: string; onSync: () => void }) {
  if (!top) return <LoadingBlock />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Top posts by engagement" description="Crewlink-calculated sums; compare within a platform, not across platforms.">
          {top.byEngagement.length ? (
            <ol className="space-y-2">
              {top.byEngagement.map((post, index) => (
                <li key={post.id} className="rounded-md border border-line bg-panel-2 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[12px] leading-relaxed text-ink">
                      {index + 1}. {post.preview || 'No preview'}
                    </span>
                    <span className="flex-shrink-0 text-[12px] font-medium text-[#58a6ff]">
                      {formatNumber(post.engagement)}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-[#6e7681]">
                    {post.platformName} · {post.contentType} · {formatDate(post.publishedAt, timezone)}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <Empty title="No measured engagement" body="Run a sync after publishing; platforms without an engagement API cannot appear here." />
          )}
        </Section>

        <Section title="Top posts by impressions" description="Only platforms that returned impressions can appear.">
          {top.byImpressions.length ? (
            <ol className="space-y-2">
              {top.byImpressions.map((post, index) => (
                <li key={post.id} className="rounded-md border border-line bg-panel-2 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[12px] leading-relaxed text-ink">
                      {index + 1}. {post.preview || 'No preview'}
                    </span>
                    <span className="flex-shrink-0 text-[12px] font-medium text-[#58a6ff]">
                      {formatNumber(post.metrics.impressions)}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-[#6e7681]">
                    {post.platformName} · {formatDate(post.publishedAt, timezone)}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rounded-md border border-dashed border-line-soft px-3 py-8 text-center text-[12px] text-[#8b949e]">
              No impressions were returned. Reddit, Bluesky, Mastodon, Discord, Telegram and Slack do not expose them.
            </p>
          )}
        </Section>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Content formats" description="Average engagement per post; small samples are not proof.">
          {top.formats.length ? (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH}>Format</th>
                  <th className={TH}>Posts</th>
                  <th className={TH}>Avg engagement</th>
                </tr>
              </thead>
              <tbody>
                {top.formats.map((format) => (
                  <tr key={format.contentType}>
                    <td className={TD}>{format.contentType}</td>
                    <td className={TD}>{format.posts}</td>
                    <td className={TD}>{format.averageEngagement !== null ? formatNumber(format.averageEngagement) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="No format data" body="Publish and sync posts to compare formats." action={<button type="button" className={BUTTON} onClick={onSync}>Sync</button>} />
          )}
        </Section>

        <Section title="Topics" description="Topics come from AI campaign ideas; manually drafted posts have no topic.">
          {top.topics.length ? (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH}>Topic</th>
                  <th className={TH}>Posts</th>
                  <th className={TH}>Avg engagement</th>
                </tr>
              </thead>
              <tbody>
                {top.topics.map((topic) => (
                  <tr key={topic.topic}>
                    <td className={TD}>{topic.topic}</td>
                    <td className={TD}>{topic.posts}</td>
                    <td className={TD}>{topic.averageEngagement !== null ? formatNumber(topic.averageEngagement) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="rounded-md border border-dashed border-line-soft px-3 py-8 text-center text-[12px] text-[#8b949e]">
              No topic data yet. Generate content through AI Studio to attach topics.
            </p>
          )}
        </Section>
      </div>

      <Section title="Unusual changes" description="Posts whose stored engagement changed by at least 25% between snapshots.">
        {top.movers.length ? (
          <div className="space-y-2">
            {top.movers.map((mover) => (
              <div key={mover.post.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-panel-2 px-2.5 py-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-ink">{mover.post.preview || 'No preview'}</span>
                <span className={`flex items-center gap-1 ${mover.direction === 'up' ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
                  {mover.direction === 'up' ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                  {mover.changePercent}%
                </span>
                <span className="text-[10px] text-[#6e7681]">
                  {mover.post.platformName} · {formatDate(mover.post.publishedAt, timezone)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-[#8b949e]">
            No large snapshot-to-snapshot change was found. Run syncs over several days to build this comparison.
          </p>
        )}
      </Section>
    </div>
  );
}

function AudienceTab({ audience, timezone, onSync }: { audience: AudienceResult | null; timezone: string; onSync: () => void }) {
  if (!audience) return <LoadingBlock />;
  return (
    <div className="space-y-4">
      <Section
        title="Audience and growth"
        description="Followers and subscribers are platform-reported. Growth is Crewlink-calculated from consecutive snapshots."
        actions={<button type="button" className={BUTTON} onClick={onSync}><RefreshCw className="h-3.5 w-3.5" /> Sync</button>}
      >
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {audience.platforms.map((platform) => (
            <div key={platform.platformId} className="rounded-lg border border-line bg-panel-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-ink">{platform.name}</span>
                <SupportBadge status={platform.status} />
              </div>
              {platform.available ? (
                <>
                  <div className="mt-2 flex items-end gap-3">
                    <span className="text-[20px] font-semibold text-ink">
                      {formatNumber(platform.followers ?? platform.subscribers)}
                    </span>
                    <span className="pb-1 text-[10px] text-[#8b949e]">
                      {platform.followers !== null ? 'followers' : 'subscribers'}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px]">
                    {platform.growth === null ? (
                      <span className="text-[#6e7681]">Growth needs 2+ snapshots</span>
                    ) : (
                      <span className={platform.growth >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}>
                        {platform.growth >= 0 ? '+' : ''}
                        {formatNumber(platform.growth)} ({platform.changePercent ?? 0}%)
                      </span>
                    )}
                  </div>
                  <Sparkline values={platform.series.map((point) => point.value)} />
                  <p className="mt-1 text-[10px] leading-relaxed text-[#6e7681]">{platform.note}</p>
                  {platform.posts !== null ? (
                    <p className="mt-1 text-[10px] text-[#6e7681]">{formatNumber(platform.posts)} account posts</p>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-[11px] leading-relaxed text-[#8b949e]">{platform.note}</p>
              )}
            </div>
          ))}
        </div>
      </Section>
      <p className="text-[11px] leading-relaxed text-[#8b949e]">{audience.note}</p>
      <p className="text-[10px] text-[#6e7681]">
        Snapshots are captured when you sync. Last viewed with timezone {timezone}.
      </p>
    </div>
  );
}

function TimingTab({ timing, onSync }: { timing: TimingResult | null; onSync: () => void }) {
  if (!timing) return <LoadingBlock />;
  const maxWeekday = Math.max(1, ...timing.byWeekday.map((row) => row.averageEngagement ?? 0));
  const maxHour = Math.max(1, ...timing.byHour.map((row) => row.averageEngagement ?? 0));
  return (
    <div className="space-y-4">
      <Section
        title="Posting time analysis"
        description={`Weekday and 3-hour windows in ${timing.timezone}. This is an association, never a significance claim.`}
        actions={<button type="button" className={BUTTON} onClick={onSync}><RefreshCw className="h-3.5 w-3.5" /> Sync</button>}
      >
        {!timing.sufficientData ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-[#9e6a03] bg-[#2a2110] px-3 py-2.5 text-[12px] text-[#e3b341]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            {timing.note}
          </div>
        ) : (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="flex items-center gap-1 rounded-full border border-[#238636] bg-[#0f2a17] px-2 py-0.5 text-[11px] text-[#7ee787]">
              <Clock className="h-3 w-3" /> Sample: {timing.sampleSize} measured posts
            </span>
            {timing.bestWeekday ? (
              <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[11px] text-ink">
                Most engagement observed: {timing.bestWeekday}
              </span>
            ) : null}
            {timing.bestHourWindow ? (
              <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[11px] text-ink">
                Window: {timing.bestHourWindow}
              </span>
            ) : null}
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[11px] uppercase tracking-[0.05em] text-[#8b949e]">By weekday</h3>
            <div className="space-y-1.5">
              {timing.byWeekday.map((row) => (
                <div key={row.key} className="grid grid-cols-[44px_1fr_62px_42px] items-center gap-2 text-[11px]">
                  <span className="text-[#c9d1d9]">{row.label}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-canvas-inset">
                    <div
                      className="h-full rounded-full bg-[#58a6ff]"
                      style={{ width: `${Math.round(((row.averageEngagement ?? 0) / maxWeekday) * 100)}%` }}
                    />
                  </div>
                  <span className="text-right text-[#8b949e]">{row.posts} post(s)</span>
                  <span className="text-right text-ink">{formatNumber(row.averageEngagement)}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-[11px] uppercase tracking-[0.05em] text-[#8b949e]">By 3-hour window</h3>
            <div className="space-y-1.5">
              {timing.byHour.map((row) => (
                <div key={row.key} className="grid grid-cols-[86px_1fr_62px_42px] items-center gap-2 text-[11px]">
                  <span className="text-[#c9d1d9]">{row.label}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-canvas-inset">
                    <div
                      className="h-full rounded-full bg-[#3fb950]"
                      style={{ width: `${Math.round(((row.averageEngagement ?? 0) / maxHour) * 100)}%` }}
                    />
                  </div>
                  <span className="text-right text-[#8b949e]">{row.posts} post(s)</span>
                  <span className="text-right text-ink">{formatNumber(row.averageEngagement)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[#8b949e]">{timing.note}</p>
      </Section>
    </div>
  );
}

function CampaignsTab({
  campaigns,
  timezone,
  onAnalyze,
  analyzing,
  providerConfigured,
}: {
  campaigns: CampaignPerformance[];
  timezone: string;
  onAnalyze: (campaignId: string) => void;
  analyzing: boolean;
  providerConfigured: boolean;
}) {
  if (!campaigns.length) {
    return (
      <Empty
        title="No campaigns yet"
        body="AI Studio campaigns link generated posts to published analytics. Create a campaign, publish its approved drafts, sync, then return here."
        action={<Link href="/ai" className={BUTTON}>Open AI Studio</Link>}
      />
    );
  }
  return (
    <div className="space-y-3">
      {campaigns.map((campaign) => (
        <Section
          key={campaign.campaignId}
          title={campaign.name}
          description={`${campaign.status} · ${campaign.platforms.join(', ') || 'no platforms'} · M8 campaign ${campaign.campaignId}`}
          actions={
            <>
              <button
                type="button"
                className={BUTTON}
                onClick={() => onAnalyze(campaign.campaignId)}
                disabled={analyzing || !providerConfigured}
                title={providerConfigured ? 'Generate an advisory AI insight for this campaign' : 'Configure an AI provider first'}
              >
                {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Analyze
              </button>
              <Link href="/ai" className={BUTTON}>AI Studio</Link>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat label="Generated" value={formatNumber(campaign.generated)} />
            <Stat label="Approved" value={formatNumber(campaign.approved)} />
            <Stat label="Published" value={formatNumber(campaign.published)} />
            <Stat label="Engagement" value={formatNumber(campaign.engagement.value)} detail="Crewlink-calculated" />
            <Stat label="Impressions" value={formatNumber(campaign.metrics.impressions?.value)} detail="Where available" />
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <div className="rounded-md border border-line bg-panel-2 p-2.5">
              <p className="text-[10px] uppercase tracking-[0.05em] text-[#8b949e]">Best post</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink">
                {campaign.topPost?.preview || 'No measured post'}
              </p>
              <p className="mt-1 text-[10px] text-[#6e7681]">
                {campaign.topPost ? `${formatNumber(campaign.topPost.engagement)} engagement · ${formatDate(campaign.topPost.publishedAt, timezone)}` : ''}
              </p>
            </div>
            <div className="rounded-md border border-line bg-panel-2 p-2.5">
              <p className="text-[10px] uppercase tracking-[0.05em] text-[#8b949e]">Weakest post</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink">
                {campaign.weakestPost?.preview || 'No measured post'}
              </p>
              <p className="mt-1 text-[10px] text-[#6e7681]">
                {campaign.weakestPost ? `${formatNumber(campaign.weakestPost.engagement)} engagement · ${formatDate(campaign.weakestPost.publishedAt, timezone)}` : ''}
              </p>
            </div>
            <div className="rounded-md border border-line bg-panel-2 p-2.5">
              <p className="text-[10px] uppercase tracking-[0.05em] text-[#8b949e]">Previous campaign</p>
              {campaign.previous ? (
                <>
                  <p className="mt-1 text-[12px] text-ink">{campaign.previous.name}</p>
                  <p className="mt-1 text-[10px] text-[#6e7681]">
                    {formatNumber(campaign.previous.engagement)} engagement · {campaign.previous.posts} post(s)
                  </p>
                  <p className="mt-1 text-[11px] text-[#8b949e]">
                    Change: {campaign.changes.engagement !== null ? `${campaign.changes.engagement}%` : 'not calculable'}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-[11px] text-[#8b949e]">This is the first campaign.</p>
              )}
            </div>
          </div>
          {campaign.insights.length ? (
            <div className="mt-3 rounded-md border border-[#1f6feb] bg-[#0d1d33] p-2.5">
              <p className="text-[10px] uppercase tracking-[0.05em] text-[#58a6ff]">Latest AI insight</p>
              <p className="mt-1 text-[12px] leading-relaxed text-[#c9d1d9]">
                {campaign.insights[0].payload.renderedSummary || campaign.insights[0].payload.summary}
              </p>
              <p className="mt-1 text-[10px] text-[#6e7681]">
                {campaign.insights[0].payload.insufficientData ? 'Insufficient data' : 'Advisory'} · unverified
              </p>
            </div>
          ) : null}
        </Section>
      ))}
    </div>
  );
}

function InsightsTab({
  insights,
  campaigns,
  campaignId,
  onCampaign,
  onGenerate,
  onUpdate,
  onCopy,
  generating,
  providerConfigured,
  timezone,
}: {
  insights: AnalyticsInsight[];
  campaigns: CampaignPerformance[];
  campaignId: string;
  onCampaign: (value: string) => void;
  onGenerate: (campaignId?: string) => void;
  onUpdate: (id: string, status: 'accepted' | 'dismissed') => void;
  onCopy: (text: string, label: string) => void;
  generating: boolean;
  providerConfigured: boolean;
  timezone: string;
}) {
  return (
    <div className="space-y-4">
      <Section
        title="AI performance analyst"
        description="Uses only stored platform metrics. Prompts, tokens and credentials are never returned here."
        actions={
          <>
            <CampaignSelect campaigns={campaigns} value={campaignId} onChange={onCampaign} />
            <button
              type="button"
              className={BUTTON}
              onClick={() => onGenerate(campaignId || undefined)}
              disabled={generating || !providerConfigured}
              title={providerConfigured ? undefined : 'Configure an AI provider first'}
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Generate insight
            </button>
          </>
        }
      >
        {!insights.length ? (
          <Empty
            title="No insight yet"
            body={
              providerConfigured
                ? 'Generate an insight after at least three measured posts exist. With a smaller sample Crewlink records an explicit insufficient-data note instead of guessing.'
                : 'An AI provider is required. Configure AI_PROVIDER and its key, then generate an insight. Metrics still work without AI.'
            }
            action={
              <Link href="/ai" className={BUTTON}>
                AI settings
              </Link>
            }
          />
        ) : (
          <div className="space-y-3">
            {insights.map((insight) => (
              <article key={insight.id} className="rounded-lg border border-line bg-panel-2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[#8b949e]">
                    <span className="rounded-full border border-[#1f6feb] bg-[#0d1d33] px-2 py-0.5 text-[#58a6ff]">
                      {insight.payload.verificationStatus === 'unverified' ? 'Unverified AI output' : insight.payload.verificationStatus}
                    </span>
                    <span className="rounded-full border border-line px-2 py-0.5">
                      {insight.scope === 'campaign' ? 'Campaign' : 'Project'}
                    </span>
                    <span>{insight.periodStart} → {insight.periodEnd}</span>
                    <span>Sample: {insight.sampleSize}</span>
                    <span>{insight.provider}/{insight.model}</span>
                    {insight.status !== 'new' ? (
                      <span className="rounded-full border border-[#238636] bg-[#0f2a17] px-2 py-0.5 text-[#7ee787]">
                        {insight.status}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className={BUTTON}
                      onClick={() => onUpdate(insight.id, 'accepted')}
                      disabled={insight.status === 'accepted'}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Accept
                    </button>
                    <button
                      type="button"
                      className={BUTTON}
                      onClick={() => onUpdate(insight.id, 'dismissed')}
                      disabled={insight.status === 'dismissed'}
                    >
                      <X className="h-3.5 w-3.5" /> Dismiss
                    </button>
                    <button type="button" className={BUTTON} onClick={() => onCopy(insightBrief(insight), 'Insight brief')}>
                      <Copy className="h-3.5 w-3.5" /> Copy brief
                    </button>
                  </div>
                </div>

                <p className="mt-2 text-[13px] leading-relaxed text-ink">
                  {insight.payload.renderedSummary || insight.payload.summary}
                </p>
                {insight.payload.insufficientData ? (
                  <p className="mt-2 rounded-md border border-[#9e6a03] bg-[#2a2110] px-2.5 py-2 text-[11px] text-[#e3b341]">
                    Insufficient data: no performance conclusion was generated. Publish and sync more posts first.
                  </p>
                ) : null}

                {insight.payload.findings.length ? (
                  <div className="mt-3">
                    <h4 className="text-[10px] uppercase tracking-[0.05em] text-[#8b949e]">Findings</h4>
                    <ul className="mt-1 space-y-1.5">
                      {insight.payload.findings.map((finding, index) => (
                        <li key={index} className="rounded border border-line bg-panel px-2 py-1.5 text-[11px] leading-relaxed text-[#c9d1d9]">
                          {finding.renderedStatement || finding.statement}
                          <span className="ml-1 text-[10px] text-[#6e7681]">
                            ({finding.basis.join(', ') || 'validated facts'}; sample {finding.sampleSize}; {finding.confidence} confidence)
                          </span>
                          {finding.renderedCaveat || finding.caveat ? (
                            <p className="mt-0.5 text-[10px] text-[#6e7681]">
                              {finding.renderedCaveat || finding.caveat}
                            </p>
                          ) : null}
                          <FactChips facts={finding.facts || []} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {insight.payload.recommendations.length ? (
                  <div className="mt-3">
                    <h4 className="text-[10px] uppercase tracking-[0.05em] text-[#8b949e]">Recommendations (advisory)</h4>
                    <ul className="mt-1 space-y-1.5">
                      {insight.payload.recommendations.map((recommendation, index) => (
                        <li key={index} className="rounded border border-line bg-panel px-2 py-1.5 text-[11px] leading-relaxed text-[#c9d1d9]">
                          <span className="font-medium text-ink">
                            {recommendation.renderedAction || recommendation.action}
                          </span>
                          <span className="ml-1 text-[10px] uppercase text-[#6e7681]">{recommendation.priority}</span>
                          {recommendation.renderedRationale || recommendation.rationale ? (
                            <p className="mt-0.5 text-[10px] text-[#8b949e]">
                              {recommendation.renderedRationale || recommendation.rationale}
                            </p>
                          ) : null}
                          {recommendation.renderedEvidence || recommendation.evidence ? (
                            <p className="mt-0.5 text-[10px] text-[#6e7681]">
                              Evidence: {recommendation.renderedEvidence || recommendation.evidence}
                            </p>
                          ) : null}
                          <FactChips facts={recommendation.facts || []} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {insight.payload.comparisons.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {insight.payload.comparisons.map((comparison, index) => (
                      <span key={index} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-0.5 text-[10px] text-[#8b949e]">
                        {comparison.metric}: {comparison.direction}
                        {comparison.changePercent !== null ? ` (${comparison.changePercent}%)` : ''}
                        <span className="text-[#6e7681]">
                          {formatNumber(comparison.current)} vs {formatNumber(comparison.previous)}
                        </span>
                        {comparison.renderedNote || comparison.note ? (
                          <span className="text-[#6e7681]">{comparison.renderedNote || comparison.note}</span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                ) : null}

                {insight.payload.postingTime ? (
                  <p className="mt-2 rounded border border-line bg-panel px-2 py-1.5 text-[11px] text-[#c9d1d9]">
                    Posting-time suggestion (sample {insight.payload.postingTime.sampleSize}):{' '}
                    {insight.payload.postingTime.renderedRecommendation ||
                      insight.payload.postingTime.recommendation}
                  </p>
                ) : null}

                <details className="mt-2 text-[10px] text-[#8b949e]">
                  <summary className="cursor-pointer">Data quality and limitations</summary>
                  <ul className="mt-1 space-y-1 pl-4">
                    {[...insight.payload.dataQuality, ...insight.payload.limitations].map((line, index) => (
                      <li key={index} className="list-disc">{line}</li>
                    ))}
                  </ul>
                </details>
                <p className="mt-1 text-[9px] text-[#6e7681]">
                  Generated {formatDateTime(insight.createdAt, timezone)} · {insight.promptTokens + insight.completionTokens} tokens
                </p>
              </article>
            ))}
          </div>
        )}
      </Section>

      <div className="flex items-start gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-[11px] leading-relaxed text-[#8b949e]">
        <Activity className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
        The analyst never approves, schedules or publishes. Accepting an insight only marks it accepted; copy the brief
        into a new campaign if you want to use it.
      </div>
    </div>
  );
}
