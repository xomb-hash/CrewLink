'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, KeyRound, Search } from 'lucide-react';
import { ProjectLogo } from '@/components/ProjectLogo';
import type { JoinMode, ApplicantStatus } from '@/types/index';

export interface DiscoverProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  ownerLogin: string;
  joinMode: JoinMode;
  roles: string[];
  logoUrl: string | null;
  requiresCode: boolean;
  appliedStatus: ApplicantStatus | null;
}

const FILTERS = ['All', 'Referral', 'Screening'] as const;
type Filter = (typeof FILTERS)[number];

interface DiscoverClientProps {
  projects: DiscoverProject[];
}

export function DiscoverClient({ projects }: DiscoverClientProps) {
  const [filter, setFilter] = useState<Filter>('All');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((project) => {
      if (filter === 'Referral' && project.joinMode !== 'referral') return false;
      if (filter === 'Screening' && project.joinMode !== 'screening') return false;
      if (!q) return true;
      const haystack = `${project.title} ${project.description} ${project.ownerLogin} ${project.roles.join(' ')}`;
      return haystack.toLowerCase().includes(q);
    });
  }, [projects, filter, query]);

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-light tracking-tight text-ink">Discover projects</h1>
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[#777]">
          Public projects from other creators. Open one to request access — referral projects need the invite
          code from their creator.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-line-soft bg-black px-3 transition-colors focus-within:border-ink">
          <Search className="h-3.5 w-3.5 flex-none text-[#666]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, creators, or roles…"
            aria-label="Search projects to join"
            className="h-full w-full border-0 bg-transparent text-[12px] text-ink outline-none"
          />
        </div>
        <div className="flex gap-1.5">
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              className={`h-9 rounded-md border px-3.5 text-[12px] transition-colors ${
                filter === option
                  ? 'border-ink bg-ink text-black'
                  : 'border-line-soft text-[#888] hover:border-[#555] hover:text-[#ccc]'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-line-soft bg-panel px-6 py-16 text-center text-[13px] text-[#666]">
          {projects.length === 0
            ? 'No public projects are open right now. Check back soon.'
            : 'Nothing matches that search. Try a different filter.'}
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
          {filtered.map((project) => (
            <Link
              key={project.id}
              href={`/join/${project.slug}`}
              className="group flex flex-col rounded-[10px] border border-line bg-panel p-5 transition duration-200 hover:-translate-y-0.5 hover:border-[#444] hover:shadow-[0_8px_32px_rgba(0,0,0,0.55)]"
            >
              <div className="flex items-start gap-3">
                <ProjectLogo
                  title={project.title}
                  logoUrl={project.logoUrl}
                  className="h-11 w-11"
                  textClassName="text-[15px]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="line-clamp-2 text-[14px] font-normal leading-snug text-ink">{project.title}</h2>
                    <ArrowUpRight className="mt-0.5 h-4 w-4 flex-none text-[#555] transition-colors group-hover:text-ink" />
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#666]">@{project.ownerLogin}</p>
                </div>
              </div>

              <p className="mt-3 line-clamp-2 min-h-[34px] text-[12px] leading-relaxed text-[#888]">
                {project.description || 'No description yet.'}
              </p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {(project.roles.length ? project.roles.slice(0, 3) : ['Any role']).map((role) => (
                  <span key={role} className="rounded-full border border-[#222] px-2.5 py-0.5 text-[10px] text-[#777]">
                    {role}
                  </span>
                ))}
              </div>

              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
                <span className="rounded-full border border-[#2a2a2a] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.05em] text-[#888]">
                  {project.joinMode === 'screening' ? 'Screening' : 'Referral'}
                </span>
                {project.requiresCode && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#2a2a2a] px-2.5 py-0.5 text-[10px] text-[#888]">
                    <KeyRound className="h-2.5 w-2.5" />
                    Invite code
                  </span>
                )}
                {project.appliedStatus && (
                  <span className="rounded-full border border-line px-2.5 py-0.5 text-[10px] uppercase tracking-[0.05em] text-emerald-300">
                    {project.appliedStatus === 'pending' ? 'Applied' : project.appliedStatus}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
