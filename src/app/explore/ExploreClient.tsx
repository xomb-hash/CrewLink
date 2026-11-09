'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, ExternalLink, Copy, Check, Users, ShieldCheck, ArrowRight, Sparkles } from 'lucide-react';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ExploreProject, User } from '@/types/index';

interface ExploreClientProps {
  initialProjects: ExploreProject[];
  currentUser: User | null;
}

const FILTER_TAGS = [
  'All',
  'Frontend',
  'Backend',
  'Fullstack',
  'Mobile',
  'AI / ML',
  'Design',
  'DevOps',
  'Docs',
];

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

export function ExploreClient({ initialProjects, currentUser }: ExploreClientProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const handleCopyLink = (joinUrl: string, slug: string) => {
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopiedSlug(slug);
      setTimeout(() => setCopiedSlug(null), 2000);
    });
  };

  const filteredProjects = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return initialProjects.filter((project) => {
      // Filter by role tag
      if (activeFilter !== 'All') {
        const matchesFilter = project.roles?.some((role) =>
          role.toLowerCase().includes(activeFilter.toLowerCase())
        );
        if (!matchesFilter) return false;
      }

      // Filter by search query
      if (q) {
        const titleMatch = project.title.toLowerCase().includes(q);
        const descMatch = (project.description || '').toLowerCase().includes(q);
        const repoMatch = project.repoFullName.toLowerCase().includes(q);
        const ownerMatch = project.ownerLogin.toLowerCase().includes(q);
        const roleMatch = project.roles?.some((r) => r.toLowerCase().includes(q));
        return titleMatch || descMatch || repoMatch || ownerMatch || roleMatch;
      }

      return true;
    });
  }, [initialProjects, searchQuery, activeFilter]);

  return (
    <div>
      {/* Top Banner / Heading */}
      <div className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-semibold uppercase tracking-wider mb-2">
              <Sparkles className="w-3.5 h-3.5" /> Explore Open Projects
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Find a Project &amp; Start Building
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Browse repositories looking for teammates. Request to join, get approved, and start collaborating on GitHub.
            </p>
          </div>

          {!currentUser && (
            <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500 border-0">
              <a href="/auth/github">Sign in with GitHub</a>
            </Button>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative max-w-2xl mt-4">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by project name, description, role, or technology..."
            className="pl-10 h-11 bg-[#161b22] border-[#30363d] text-white rounded-xl focus-visible:border-blue-500 text-sm"
          />
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-2 overflow-x-auto py-3 no-scrollbar mt-2">
          {FILTER_TAGS.map((tag) => {
            const isSelected = activeFilter === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveFilter(tag)}
                className={`px-3.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition border ${
                  isSelected
                    ? 'bg-white text-gray-900 border-white font-semibold'
                    : 'bg-[#161b22] text-gray-300 border-[#30363d] hover:bg-[#21262d] hover:text-white'
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      {/* Projects Grid */}
      {filteredProjects.length === 0 ? (
        <Card className="p-12 text-center bg-[#161b22] border-[#30363d] rounded-xl">
          <Users className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white mb-1">No matching projects found</h3>
          <p className="text-sm text-gray-400 max-w-sm mx-auto mb-4">
            Try adjusting your search terms or filter chips, or be the first to connect a project!
          </p>
          {(searchQuery || activeFilter !== 'All') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setActiveFilter('All');
              }}
              className="bg-[#21262d] border-[#30363d] text-gray-200 hover:bg-[#30363d]"
            >
              Clear filters
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project, index) => {
            // Generate a distinct aesthetic hue based on project id/index
            const hue = (index * 47 + 190) % 360;
            return (
              <Card
                key={project.id}
                className="bg-[#161b22] border-[#30363d] overflow-hidden flex flex-col hover:border-gray-500 transition shadow-sm rounded-xl"
              >
                {/* Visual Banner Header */}
                <div
                  className="h-28 p-4 flex flex-col justify-between relative"
                  style={{
                    background: `linear-gradient(135deg, hsl(${hue}, 40%, 18%) 0%, hsl(${
                      (hue + 35) % 360
                    }, 45%, 10%) 100%)`,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <VisibilityBadge isPrivate={project.isPrivate} />
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        project.joinMode === 'screening'
                          ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                          : 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                      }`}
                    >
                      {project.joinMode === 'screening' ? 'Screening first' : 'Referral'}
                    </Badge>
                  </div>

                  <div>
                    <h2 className="text-lg font-bold text-white tracking-tight line-clamp-1">
                      {project.title}
                    </h2>
                    <span className="text-xs text-gray-300 font-mono opacity-80">
                      {project.repoFullName}
                    </span>
                  </div>
                </div>

                {/* Body Content */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    {/* Description */}
                    <p className="text-xs text-gray-300 leading-relaxed line-clamp-3 mb-3">
                      {project.description || 'No project summary provided.'}
                    </p>

                    {/* Roles Wanted Tags */}
                    {project.roles && project.roles.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {project.roles.slice(0, 4).map((role) => (
                          <Badge
                            key={role}
                            variant="outline"
                            className="text-[11px] px-2 py-0.5 rounded bg-[#0d1117] text-emerald-400 border-emerald-500/20"
                          >
                            Needs {role}
                          </Badge>
                        ))}
                        {project.roles.length > 4 && (
                          <span className="text-[10px] text-gray-500">
                            +{project.roles.length - 4} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Owner & Meta Footer */}
                  <div className="pt-3 border-t border-[#30363d]/60 flex items-center justify-between text-xs text-gray-400">
                    <div className="flex items-center gap-2">
                      <img
                        src={
                          project.ownerAvatar ||
                          'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
                        }
                        alt={project.ownerLogin}
                        className="w-5 h-5 rounded-full border border-[#30363d]"
                      />
                      <span className="truncate max-w-[100px] text-gray-300">
                        @{project.ownerLogin}
                      </span>
                    </div>

                    <span>
                      {project.applicantsCount}{' '}
                      {project.applicantsCount === 1 ? 'applicant' : 'applicants'} &bull;{' '}
                      {formatTimeAgo(project.createdAt)}
                    </span>
                  </div>
                </div>

                {/* Actions Bar */}
                <div className="p-3 bg-[#0d1117] border-t border-[#30363d] flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => handleCopyLink(project.joinUrl, project.slug)}
                    className="gap-1 text-xs text-gray-400 hover:text-white"
                    title="Copy join link"
                  >
                    {copiedSlug === project.slug ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedSlug === project.slug ? 'Copied' : 'Share'}</span>
                  </Button>

                  <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500 border-0 h-8 text-xs">
                    <Link href={`/join/${project.slug}`} className="inline-flex items-center gap-1.5">
                      <span>Request to Join</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
