'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Copy } from 'lucide-react';
import { ProjectLogo } from '@/components/ProjectLogo';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import { Badge } from '@/components/ui/badge';
import type { JoinMode } from '@/types/index';

export interface HomeProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  ownerLogin: string;
  repoFullName: string;
  isPrivate: boolean;
  joinMode: JoinMode;
  roles: string[];
  applicantCount: number;
  joinUrl: string;
  logoUrl: string | null;
  createdAtLabel: string;
}

export interface HomeDiscoverProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  ownerLogin: string;
  joinMode: JoinMode;
  roles: string[];
  logoUrl: string | null;
  requiresCode: boolean;
}

const FILTERS = ['All', 'Public', 'Private', 'Referral', 'Screening'] as const;
type Filter = (typeof FILTERS)[number];

interface HomeClientProps {
  projects: HomeProject[];
  discoverProjects: HomeDiscoverProject[];
  initialQuery: string;
}

export function HomeClient({ projects, discoverProjects, initialQuery }: HomeClientProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('All');
  const [toast, setToast] = useState<string | null>(null);
  const query = initialQuery;

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (filter === 'Public' && p.isPrivate) return false;
      if (filter === 'Private' && !p.isPrivate) return false;
      if (filter === 'Referral' && p.joinMode !== 'referral') return false;
      if (filter === 'Screening' && p.joinMode !== 'screening') return false;
      if (!q) return true;
      const haystack = `${p.title} ${p.description} ${p.repoFullName} ${p.roles.join(' ')}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [projects, filter, query]);

  const openProject = (project: HomeProject) => {
    router.push(`/join/${project.slug}`, { scroll: false });
  };

  const copyJoin = async (project: HomeProject) => {
    try {
      await navigator.clipboard.writeText(project.joinUrl);
      showToast('Join link copied');
    } catch {
      showToast('Could not copy join link');
    }
  };

  return (
    <div>
      {discoverProjects.length > 0 && (
        <section className="px-6 pt-6">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-normal text-ink">Projects looking for collaborators</h2>
              <p className="mt-0.5 text-[11px] text-[#8b949e]">
                Public projects from other creators. You still need their invite code to request access.
              </p>
            </div>
            <Link
              href="/discover"
              className="inline-flex items-center gap-1 text-[11px] text-[#c9d1d9] transition-colors hover:text-ink"
            >
              Discover all
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {discoverProjects.map((project) => (
              <Link
                key={project.id}
                href={`/join/${project.slug}`}
                className="group flex items-start gap-3 rounded-xl border border-line bg-panel p-4 transition-colors hover:border-[#8b949e]"
              >
                <ProjectLogo
                  title={project.title}
                  logoUrl={project.logoUrl}
                  className="h-10 w-10"
                  textClassName="text-[13px]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[13px] font-semibold text-ink">{project.title}</h3>
                    <ArrowRight className="ml-auto h-3.5 w-3.5 flex-none text-[#6e7681] transition-colors group-hover:text-ink" />
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-[#8b949e]">@{project.ownerLogin}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                        project.joinMode === 'screening'
                          ? 'border-[#8957e5]/40 bg-[#8957e5]/10 text-[#d2a8ff]'
                          : 'border-[#1f6feb]/40 bg-[#1f6feb]/10 text-[#79c0ff]'
                      }`}
                    >
                      {project.joinMode === 'screening' ? 'Screening first' : 'Referral link'}
                    </Badge>
                    {project.requiresCode && (
                      <span className="rounded-full border border-[#30363d] px-2.5 py-0.5 text-[10px] text-[#8b949e]">
                        Invite code
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="sticky top-14 z-[80] flex gap-1.5 overflow-x-auto border-b border-line bg-background px-6 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`h-7 flex-none whitespace-nowrap rounded-full border px-3.5 text-[12px] font-medium transition-colors ${
              filter === f
                ? 'border-[#1f6feb] bg-[#1f6feb]/15 text-[#4493f8]'
                : 'border-line-soft text-[#8b949e] hover:border-[#6e7681] hover:text-[#e6edf3]'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-20 text-center text-[13px] text-[#6e7681]">
          {projects.length === 0
            ? 'No projects yet. Use Create to connect your first repository.'
            : 'Nothing here — try a different filter.'}
        </div>
      ) : (
        <div className="grid gap-4 p-6 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {filtered.map((project, index) => (
            <article
              key={project.id}
              role="link"
              tabIndex={0}
              onClick={() => openProject(project)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openProject(project);
              }}
              className="cl-rise group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-line bg-panel transition duration-200 hover:border-[#8b949e] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.07),0_16px_48px_rgba(0,0,0,0.85)]"
              style={{ animationDelay: `${index * 25}ms` }}
            >
              <div className="border-b border-line bg-canvas-inset/70 p-4">
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <VisibilityBadge isPrivate={project.isPrivate} />
                  <Badge
                    variant="outline"
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                      project.joinMode === 'screening'
                        ? 'border-[#8957e5]/40 bg-[#8957e5]/10 text-[#d2a8ff]'
                        : 'border-[#1f6feb]/40 bg-[#1f6feb]/10 text-[#79c0ff]'
                    }`}
                  >
                    {project.joinMode === 'screening' ? 'Screening first' : 'Referral link'}
                  </Badge>
                </div>

                <div className="flex items-center gap-3">
                  <ProjectLogo
                    title={project.title}
                    logoUrl={project.logoUrl}
                    className="h-10 w-10"
                    textClassName="text-[13px]"
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[17px] font-semibold leading-tight tracking-tight text-ink">
                      {project.title}
                    </h3>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-[#8b949e]">{project.repoFullName}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 flex-none self-start text-[#6e7681] transition-colors group-hover:text-ink" />
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-3 p-4">
                <p className="line-clamp-2 min-h-[34px] text-[12px] leading-relaxed text-[#c9d1d9]">
                  {project.description || 'No description yet.'}
                </p>

                <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-background px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid h-7 w-7 flex-none place-items-center rounded-full border border-[#30363d] text-[11px] text-[#8b949e]">
                      {project.ownerLogin.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 leading-tight">
                      <div className="truncate text-[12px] font-semibold text-link">@{project.ownerLogin}</div>
                      <div className="mt-0.5 text-[11px] text-[#8b949e]">
                        {project.applicantCount} {project.applicantCount === 1 ? 'applicant' : 'applicants'} &middot;{' '}
                        {project.createdAtLabel}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyJoin(project);
                    }}
                    title="Copy join link"
                    aria-label={`Copy join link for ${project.title}`}
                    className="grid h-7 w-7 flex-none place-items-center rounded-md text-[#6e7681] transition-colors hover:bg-[#21262d] hover:text-[#e6edf3]"
                  >
                    <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-background px-4 py-2.5">
                <span className="text-[11px] text-[#6e7681]">Roles:</span>
                {(project.roles.length ? project.roles : ['Any role']).map((role) => (
                  <span key={role} className="rounded-full border border-[#30363d] px-2.5 py-0.5 text-[11px] text-[#8b949e]">
                    {role}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-7 left-1/2 z-[300] -translate-x-1/2 rounded-lg border border-line bg-panel px-5 py-2.5 text-[12px] text-ink shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
