'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Lock, Globe, Copy } from 'lucide-react';
import { ProjectLogo } from '@/components/ProjectLogo';
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
                className="group flex items-start gap-3 rounded-[10px] border border-line bg-panel p-4 transition-colors hover:border-[#8b949e]"
              >
                <ProjectLogo
                  title={project.title}
                  logoUrl={project.logoUrl}
                  className="h-10 w-10"
                  textClassName="text-[13px]"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[13px] font-normal text-ink">{project.title}</h3>
                  <p className="mt-0.5 text-[11px] text-[#8b949e]">@{project.ownerLogin}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-[#30363d] px-2 py-0.5 text-[10px] text-[#8b949e]">
                      {project.joinMode === 'screening' ? 'Screening' : 'Referral'}
                    </span>
                    {project.requiresCode && (
                      <span className="rounded-full border border-[#30363d] px-2 py-0.5 text-[10px] text-[#8b949e]">
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
        <div className="grid gap-6 p-6 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {filtered.map((project, index) => (
            <article
              key={project.id}
              role="link"
              tabIndex={0}
              onClick={() => openProject(project)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openProject(project);
              }}
              className="cl-rise group cursor-pointer overflow-hidden rounded-[10px] border border-line bg-panel transition duration-200 hover:-translate-y-0.5 hover:border-[#8b949e] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.07),0_16px_48px_rgba(0,0,0,0.85)]"
              style={{ animationDelay: `${index * 25}ms` }}
            >
              <div className="relative flex aspect-video items-end justify-between bg-[#161b22] px-3.5 py-3">
                <div className="absolute left-3.5 top-3.5 flex max-w-[calc(100%-28px)] items-start gap-2.5">
                  <ProjectLogo
                    title={project.title}
                    logoUrl={project.logoUrl}
                    className="h-9 w-9"
                    textClassName="text-[13px]"
                  />
                  <h3 className="line-clamp-2 pt-0.5 text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ink">
                    {project.title}
                  </h3>
                </div>
                <span className="text-[10px] uppercase tracking-[0.08em] text-[#8b949e]">
                  {project.joinMode === 'screening' ? 'Screening' : 'Referral'}
                </span>
                {project.isPrivate ? (
                  <Lock className="h-3.5 w-3.5 text-[#6e7681]" strokeWidth={1.5} aria-label="Private repository" />
                ) : (
                  <Globe className="h-3.5 w-3.5 text-[#6e7681]" strokeWidth={1.5} aria-label="Public repository" />
                )}
              </div>

              <div className="flex items-start gap-2.5 px-3.5 pb-2.5 pt-3.5">
                <div className="grid h-7 w-7 flex-none place-items-center rounded-full border border-[#30363d] text-[11px] text-[#8b949e]">
                  {project.ownerLogin.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="line-clamp-2 text-[13px] font-normal leading-snug text-[#f0f6fc]">
                    {project.description || 'No description yet.'}
                  </h4>
                  <div className="mt-1 text-[11px] text-[#8b949e]">
                    {project.ownerLogin} &middot; {project.applicantCount}{' '}
                    {project.applicantCount === 1 ? 'applicant' : 'applicants'} &middot; {project.createdAtLabel}
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
                  className="grid h-[26px] w-[26px] flex-none place-items-center rounded-full text-[#6e7681] transition-colors hover:bg-[#21262d] hover:text-[#e6edf3]"
                >
                  <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>

              <div className="mx-3.5 h-px bg-[#30363d]" />

              <div className="flex flex-wrap gap-1.5 px-3.5 pb-3 pt-2.5">
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
