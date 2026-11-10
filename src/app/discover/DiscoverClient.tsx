'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Search, Users } from 'lucide-react';
import { ProjectLogo } from '@/components/ProjectLogo';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import { Badge } from '@/components/ui/badge';
import type { ApplicantStatus, JoinMode } from '@/types/index';

export interface DiscoverProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  ownerLogin: string;
  ownerAvatar: string;
  repoFullName: string;
  isPrivate: boolean;
  joinMode: JoinMode;
  roles: string[];
  logoUrl: string | null;
  appliedStatus: ApplicantStatus | null;
  applicantsCount: number;
  createdAt: string;
}

function formatTimeAgo(isoDate: string): string {
  try {
    const diffMs = Date.now() - new Date(isoDate).getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    return months === 1 ? '1 month ago' : `${months} months ago`;
  } catch {
    return 'recently';
  }
}

interface DiscoverClientProps {
  projects: DiscoverProject[];
}

export function DiscoverClient({ projects }: DiscoverClientProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((project) => {
      const haystack = `${project.title} ${project.description} ${project.ownerLogin} ${project.roles.join(' ')}`;
      return haystack.toLowerCase().includes(q);
    });
  }, [projects, query]);

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Discover projects</h1>
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[#8b949e]">
          Public projects from other creators. Some are open for direct requests; others ask you to
          complete a screening step first. Private invite-only projects never appear here.
        </p>
      </div>

      <div className="mb-5 flex items-center">
        <div className="flex h-9 w-full items-center gap-2 rounded-md border border-line-soft bg-background px-3 transition-colors focus-within:border-ring">
          <Search className="h-3.5 w-3.5 flex-none text-[#8b949e]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, creators, or roles…"
            aria-label="Search projects to join"
            className="h-full w-full border-0 bg-transparent text-[12px] text-ink outline-none"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-line-soft bg-panel px-6 py-16 text-center">
          <Users className="mx-auto mb-3 h-9 w-9 text-[#6e7681]" strokeWidth={1.25} />
          <p className="text-[13px] text-[#c9d1d9]">
            {projects.length === 0 ? 'No public projects are open right now' : 'Nothing matches that search'}
          </p>
          <p className="mt-1 text-[12px] text-[#8b949e]">
            {projects.length === 0 ? 'Check back soon.' : 'Try a different search.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(310px,1fr))]">
          {filtered.map((project) => (
            <Link
              key={project.id}
              href={`/join/${project.slug}`}
              className="group flex flex-col overflow-hidden rounded-xl border border-line bg-panel transition duration-200 hover:border-[#8b949e] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.07),0_16px_48px_rgba(0,0,0,0.85)]"
            >
              {/* Card Header */}
              <div className="border-b border-line bg-canvas-inset/70 p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <VisibilityBadge isPrivate={project.isPrivate} />
                  <Badge
                    variant="outline"
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                      project.joinMode === 'screening'
                        ? 'border-[#8957e5]/40 bg-[#8957e5]/10 text-[#d2a8ff]'
                        : 'border-[#238636]/40 bg-[#238636]/10 text-[#3fb950]'
                    }`}
                  >
                    {project.joinMode === 'screening' ? 'Screening first' : 'Direct join'}
                  </Badge>
                </div>

                <div className="flex items-center gap-3">
                  <ProjectLogo
                    title={project.title}
                    logoUrl={project.logoUrl}
                    className="h-11 w-11"
                    textClassName="text-[15px]"
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="line-clamp-2 text-2xl font-semibold leading-tight tracking-tight text-ink">
                      {project.title}
                    </h2>
                    <div className="mt-1 flex items-center gap-2 font-mono text-xs text-[#8b949e]">
                      <span className="truncate">{project.repoFullName}</span>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 flex-none self-start text-[#6e7681] transition-colors group-hover:text-ink" />
                </div>
              </div>

              {/* Card Body */}
              <div className="flex flex-1 flex-col gap-4 p-5">
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink">
                    About the Project
                  </h3>
                  <p className="line-clamp-2 min-h-[40px] text-sm leading-relaxed text-[#e6edf3]">
                    {project.description || 'No detailed project description provided by the repository owner.'}
                  </p>
                </div>

                {project.roles.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink">
                      Looking for Collaborators in
                    </h3>
                    <div className="flex flex-wrap items-center gap-2">
                      {project.roles.slice(0, 4).map((role) => (
                        <Badge
                          key={role}
                          variant="outline"
                          className="rounded-md border-line-soft bg-background px-2.5 py-1 text-xs font-medium text-ink"
                        >
                          Needs {role}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-background p-3.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <img
                      src={project.ownerAvatar || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'}
                      alt={project.ownerLogin}
                      className="h-8 w-8 flex-none rounded-full border border-line"
                    />
                    <div className="min-w-0">
                      <div className="text-[11px] text-[#8b949e]">Project Owner</div>
                      <div className="truncate text-[13px] font-semibold text-link">@{project.ownerLogin}</div>
                    </div>
                  </div>
                  <div className="text-right text-[11px] leading-tight text-[#8b949e]">
                    <div>
                      <strong className="font-semibold text-[#c9d1d9]">{project.applicantsCount}</strong>{' '}
                      {project.applicantsCount === 1 ? 'applicant' : 'applicants'}
                    </div>
                    <div className="mt-0.5">Posted {formatTimeAgo(project.createdAt)}</div>
                  </div>
                </div>
              </div>

              {/* Card Footer */}
              <div className="flex items-center justify-between gap-2 border-t border-line bg-background px-5 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {project.appliedStatus ? (
                    <span className="rounded-full border border-line px-2.5 py-0.5 text-[10px] uppercase tracking-[0.05em] text-ink">
                      {project.appliedStatus === 'pending' ? 'Applied' : project.appliedStatus}
                    </span>
                  ) : (
                    <span className="text-[11px] text-[#6e7681]">
                      {project.joinMode === 'screening' ? 'Screening required' : 'Open for requests'}
                    </span>
                  )}
                </div>
                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#c9d1d9] transition-colors group-hover:text-ink">
                  View details
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
