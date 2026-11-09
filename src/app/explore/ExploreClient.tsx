'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { Search, ExternalLink, Copy, Check, Users, ShieldCheck, ArrowRight, Sparkles, X, Info } from 'lucide-react';
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
  const [selectedProject, setSelectedProject] = useState<ExploreProject | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedProject(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-semibold uppercase tracking-wider mb-2">
              <Sparkles className="w-3.5 h-3.5" /> Explore Open Projects
            </div>
            <h1 className="text-3xl font-extrabold text-[#faf6f0] tracking-tight">
              Find a Project &amp; Start Building
            </h1>
            <p className="text-sm text-[#a89f91] mt-1">
              Browse repositories looking for teammates. Request to join, get approved, and start collaborating on GitHub.
            </p>
          </div>

          {!currentUser && (
            <Button asChild size="sm" className="bg-amber-500 text-stone-950 font-semibold hover:bg-amber-400 border-0">
              <a href="/auth/github">Sign in with GitHub</a>
            </Button>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative max-w-2xl mt-4">
          <Search className="w-4 h-4 text-[#a89f91] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by project name, description, role, or technology..."
            className="pl-10 h-11 bg-[#141210] border-[#38322c] text-[#faf6f0] rounded-xl focus-visible:border-amber-500 text-sm placeholder:text-[#a89f91]"
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
                    ? 'bg-[#faf6f0] text-stone-900 border-[#faf6f0] font-semibold shadow-sm'
                    : 'bg-[#1f1c19] text-[#d6cec3] border-[#38322c] hover:bg-[#2a2622] hover:text-[#faf6f0]'
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
        <Card className="p-12 text-center bg-[#1f1c19] border-[#38322c] rounded-xl">
          <Users className="w-10 h-10 text-[#a89f91] mx-auto mb-3" />
          <h3 className="text-base font-bold text-[#faf6f0] mb-1">No matching projects found</h3>
          <p className="text-sm text-[#a89f91] max-w-sm mx-auto mb-4">
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
              className="bg-[#2a2622] border-[#38322c] text-[#d6cec3] hover:bg-[#38322c] hover:text-[#faf6f0]"
            >
              Clear filters
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project, index) => {
            // Generate a warm aesthetic tone based on project id/index
            const hue = (index * 42 + 25) % 360;
            return (
              <Card
                key={project.id}
                onClick={() => setSelectedProject(project)}
                className="bg-[#1f1c19] border-[#38322c] overflow-hidden flex flex-col hover:border-[#4a423a] transition shadow-sm rounded-xl cursor-pointer group hover:shadow-lg"
              >
                {/* Visual Banner Header */}
                <div
                  className="h-28 p-4 flex flex-col justify-between relative"
                  style={{
                    background: `linear-gradient(135deg, hsl(${hue}, 35%, 16%) 0%, hsl(${
                      (hue + 30) % 360
                    }, 40%, 10%) 100%)`,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <VisibilityBadge isPrivate={project.isPrivate} />
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        project.joinMode === 'screening'
                          ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      }`}
                    >
                      {project.joinMode === 'screening' ? 'Screening first' : 'Referral'}
                    </Badge>
                  </div>

                  <div>
                    <h2 className="text-lg font-bold text-[#faf6f0] tracking-tight line-clamp-1 group-hover:text-amber-400 transition-colors">
                      {project.title}
                    </h2>
                    <span className="text-xs text-[#d6cec3] font-mono opacity-80">
                      {project.repoFullName}
                    </span>
                  </div>
                </div>

                {/* Body Content */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    {/* Description */}
                    <p className="text-xs text-[#d6cec3] leading-relaxed line-clamp-3 mb-3">
                      {project.description || 'No project summary provided.'}
                    </p>

                    {/* Roles Wanted Tags */}
                    {project.roles && project.roles.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {project.roles.slice(0, 4).map((role) => (
                          <Badge
                            key={role}
                            variant="outline"
                            className="text-[11px] px-2 py-0.5 rounded bg-[#141210] text-amber-400 border-amber-500/20"
                          >
                            Needs {role}
                          </Badge>
                        ))}
                        {project.roles.length > 4 && (
                          <span className="text-[10px] text-[#a89f91]">
                            +{project.roles.length - 4} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Owner & Meta Footer */}
                  <div className="pt-3 border-t border-[#38322c]/60 flex items-center justify-between text-xs text-[#a89f91]">
                    <div className="flex items-center gap-2">
                      <img
                        src={
                          project.ownerAvatar ||
                          'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
                        }
                        alt={project.ownerLogin}
                        className="w-5 h-5 rounded-full border border-[#38322c]"
                      />
                      <span className="truncate max-w-[100px] text-[#d6cec3]">
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
                <div className="p-3 bg-[#141210] border-t border-[#38322c] flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyLink(project.joinUrl, project.slug);
                    }}
                    className="gap-1 text-xs text-[#a89f91] hover:text-[#faf6f0]"
                    title="Copy join link"
                  >
                    {copiedSlug === project.slug ? (
                      <Check className="w-3.5 h-3.5 text-amber-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedSlug === project.slug ? 'Copied' : 'Share'}</span>
                  </Button>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedProject(project);
                      }}
                      className="text-xs text-[#a89f91] hover:text-[#faf6f0] hidden sm:inline-flex"
                    >
                      Details
                    </Button>

                    <Button
                      asChild
                      size="sm"
                      onClick={(e) => e.stopPropagation()}
                      className="bg-amber-500 text-stone-950 font-semibold hover:bg-amber-400 border-0 h-8 text-xs"
                    >
                      <Link href={`/join/${project.slug}`} className="inline-flex items-center gap-1.5">
                        <span>Request to Join</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Project Details Modal */}
      {selectedProject && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedProject(null)}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#1f1c19] border border-[#38322c] rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl my-8 relative flex flex-col max-h-[90vh]"
          >
            {/* Modal Header */}
            <div className="p-6 border-b border-[#38322c] relative bg-[#141210]/70">
              <button
                type="button"
                onClick={() => setSelectedProject(null)}
                className="absolute right-4 top-4 p-2 rounded-full text-[#a89f91] hover:text-[#faf6f0] hover:bg-[#2a2622] transition"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-2 mb-3 flex-wrap pr-8">
                <VisibilityBadge isPrivate={selectedProject.isPrivate} />
                <Badge
                  variant="outline"
                  className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                    selectedProject.joinMode === 'screening'
                      ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  }`}
                >
                  {selectedProject.joinMode === 'screening' ? 'Screening first' : 'Referral link'}
                </Badge>
              </div>

              <h2 className="text-2xl font-bold text-[#faf6f0] tracking-tight mb-1">
                {selectedProject.title}
              </h2>

              <div className="flex items-center gap-2 text-xs font-mono text-[#a89f91] flex-wrap">
                <span>{selectedProject.repoFullName}</span>
                {!selectedProject.isPrivate && (
                  <>
                    <span>&bull;</span>
                    <a
                      href={`https://github.com/${selectedProject.repoFullName}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-amber-400 hover:underline"
                    >
                      <span>Open on GitHub</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </>
                )}
              </div>
            </div>

            {/* Modal Body (Scrollable) */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* Description */}
              <div>
                <h3 className="text-xs font-semibold text-[#faf6f0] uppercase tracking-wider mb-2">
                  About the Project
                </h3>
                <p className="text-sm text-[#d6cec3] leading-relaxed whitespace-pre-line">
                  {selectedProject.description || 'No detailed project description provided by the repository owner.'}
                </p>
              </div>

              {/* Roles Wanted */}
              {selectedProject.roles && selectedProject.roles.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-[#faf6f0] uppercase tracking-wider mb-2">
                    Looking for Collaborators in
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedProject.roles.map((role) => (
                      <Badge
                        key={role}
                        variant="outline"
                        className="text-xs px-2.5 py-1 rounded-md bg-[#141210] text-amber-400 border-amber-500/30 font-medium"
                      >
                        Needs {role}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Screening Notice if applicable */}
              {selectedProject.joinMode === 'screening' && selectedProject.screeningUrl && (
                <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-purple-300 font-semibold text-xs">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Screening Task Required</span>
                  </div>
                  <p className="text-xs text-[#d6cec3] leading-relaxed">
                    The owner asks applicants to complete an initial questionnaire or screening test before request approval.
                  </p>
                  <div className="pt-1">
                    <a
                      href={selectedProject.screeningUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-[#2a2622] text-purple-300 border border-purple-500/30 hover:bg-[#38322c] transition"
                    >
                      <span>Open Screening Task</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              )}

              {/* Owner and Stats Box */}
              <div className="p-4 bg-[#141210] border border-[#38322c] rounded-xl flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <img
                    src={selectedProject.ownerAvatar || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'}
                    alt={selectedProject.ownerLogin}
                    className="w-10 h-10 rounded-full border border-[#38322c]"
                  />
                  <div>
                    <div className="text-xs text-[#a89f91]">Project Owner</div>
                    <a
                      href={`https://github.com/${selectedProject.ownerLogin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-sm text-[#faf6f0] hover:underline inline-flex items-center gap-1"
                    >
                      <span>@{selectedProject.ownerLogin}</span>
                      <ExternalLink className="w-3 h-3 text-[#a89f91]" />
                    </a>
                  </div>
                </div>

                <div className="text-right text-xs text-[#a89f91]">
                  <div><strong>{selectedProject.applicantsCount}</strong> {selectedProject.applicantsCount === 1 ? 'applicant' : 'applicants'}</div>
                  <div className="text-[11px] mt-0.5">Posted {formatTimeAgo(selectedProject.createdAt)}</div>
                </div>
              </div>
            </div>

            {/* Modal Actions Footer */}
            <div className="p-4 bg-[#141210] border-t border-[#38322c] flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleCopyLink(selectedProject.joinUrl, selectedProject.slug)}
                className="bg-[#2a2622] border-[#38322c] text-[#d6cec3] hover:bg-[#38322c] hover:text-[#faf6f0]"
              >
                {copiedSlug === selectedProject.slug ? (
                  <Check className="w-3.5 h-3.5 text-amber-400 mr-1.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5 mr-1.5" />
                )}
                <span>{copiedSlug === selectedProject.slug ? 'Link Copied' : 'Share Join Link'}</span>
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedProject(null)}
                  className="text-xs text-[#a89f91] hover:text-[#faf6f0]"
                >
                  Close
                </Button>

                <Button asChild size="sm" className="bg-amber-500 text-stone-950 font-semibold hover:bg-amber-400 border-0 h-9">
                  <Link href={`/join/${selectedProject.slug}`} className="inline-flex items-center gap-1.5">
                    <span>Request to Join</span>
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
