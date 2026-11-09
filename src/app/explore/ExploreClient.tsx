'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  Search,
  ExternalLink,
  Copy,
  Check,
  Users,
  ShieldCheck,
  ArrowRight,
  Sparkles,
  X,
  MoreVertical,
  Play,
  Share2,
} from 'lucide-react';
import { VisibilityBadge } from '@/components/VisibilityBadge';
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
  'Open Source',
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
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [showMiniCard, setShowMiniCard] = useState(true);

  // Read URL query parameter if present on load
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('q');
      if (q) setSearchQuery(q);
    }
  }, []);

  // Listen for Escape key to close modal or context menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedProject(null);
        setMenuOpenId(null);
      }
    };
    const handleClickOutside = () => setMenuOpenId(null);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleClickOutside);
    };
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

  // Project to show in the YouTube-style floating mini-card (e.g. a screening project)
  const miniProject = useMemo(() => {
    return initialProjects.find((p) => p.joinMode === 'screening') || initialProjects[0] || null;
  }, [initialProjects]);

  return (
    <div className="w-full">
      {/* YouTube-style Horizontal Sticky Chips Bar */}
      <div className="sticky top-[56px] z-30 bg-[#141210]/95 backdrop-blur-md border-b border-[#38322c] px-4 md:px-8 py-2.5 flex items-center gap-2 overflow-x-auto no-scrollbar shadow-sm">
        {FILTER_TAGS.map((tag) => {
          const isSelected = activeFilter === tag;
          return (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveFilter(tag)}
              className={`px-3.5 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all border ${
                isSelected
                  ? 'bg-[#faf6f0] text-stone-950 border-[#faf6f0] font-semibold shadow-sm'
                  : 'bg-[#1f1c19] text-[#d6cec3] border-[#38322c] hover:bg-[#2a2622] hover:text-[#faf6f0] hover:border-[#4a423a]'
              }`}
            >
              {tag}
            </button>
          );
        })}

        {/* Clear filter indicator if active */}
        {(activeFilter !== 'All' || searchQuery) && (
          <button
            type="button"
            onClick={() => {
              setActiveFilter('All');
              setSearchQuery('');
            }}
            className="text-xs text-amber-400 hover:underline px-2 py-1 whitespace-nowrap ml-auto"
          >
            Reset
          </button>
        )}
      </div>

      {/* YouTube Video-Style Project Cards Grid */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
        {filteredProjects.length === 0 ? (
          <div className="p-16 text-center bg-[#1f1c19] border border-[#38322c] rounded-2xl max-w-lg mx-auto my-8">
            <Users className="w-12 h-12 text-[#a89f91] mx-auto mb-3" />
            <h3 className="text-base font-bold text-[#faf6f0] mb-1">No matching projects found</h3>
            <p className="text-sm text-[#a89f91] mb-5 leading-relaxed">
              Try adjusting your search query or selecting a different category chip.
            </p>
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
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
            {filteredProjects.map((project, index) => {
              const hue = (index * 42 + 25) % 360;
              const isMenuOpen = menuOpenId === project.id;

              return (
                <article
                  key={project.id}
                  className="flex flex-col group cursor-pointer"
                  onClick={() => setSelectedProject(project)}
                >
                  {/* 16:9 Aspect Ratio Video Thumbnail */}
                  <div
                    className="aspect-video w-full rounded-xl overflow-hidden relative border border-[#38322c] group-hover:border-amber-500/50 group-hover:shadow-xl transition-all flex flex-col justify-between p-3.5 shadow-sm"
                    style={{
                      background: `linear-gradient(135deg, hsl(${hue}, 30%, 15%) 0%, hsl(${
                        (hue + 35) % 360
                      }, 35%, 9%) 100%)`,
                    }}
                  >
                    {/* Top Row: Category tag and Privacy */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase font-semibold text-[#faf6f0] bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded border border-white/10 tracking-wider">
                        {project.roles?.[0] || 'Project'}
                      </span>
                      <VisibilityBadge isPrivate={project.isPrivate} showText={false} />
                    </div>

                    {/* Middle: Video-style Title */}
                    <div>
                      <h2 className="text-base font-bold text-[#faf6f0] tracking-tight line-clamp-1 group-hover:text-amber-400 transition-colors">
                        {project.title}
                      </h2>
                      <span className="text-xs text-[#d6cec3]/80 font-mono">
                        {project.repoFullName}
                      </span>
                    </div>

                    {/* Bottom Row: Join Mode tag */}
                    <div className="flex items-center justify-end">
                      <span className="text-[10px] font-medium text-[#faf6f0] bg-black/70 px-2 py-0.5 rounded border border-white/10">
                        {project.joinMode === 'screening' ? 'Screening' : 'Referral'}
                      </span>
                    </div>
                  </div>

                  {/* Video Metadata Block (Owner Avatar + Title + Meta) */}
                  <div className="mt-3 flex gap-3 items-start relative">
                    {/* Owner Avatar */}
                    <img
                      src={
                        project.ownerAvatar ||
                        'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
                      }
                      alt={project.ownerLogin}
                      className="w-9 h-9 rounded-full border border-[#38322c] flex-none object-cover mt-0.5"
                    />

                    {/* Title, Channel and View stats */}
                    <div className="flex-1 min-w-0 pr-6">
                      <h3 className="text-sm font-semibold text-[#faf6f0] leading-snug line-clamp-2 group-hover:text-amber-400 transition-colors">
                        {project.description || project.title}
                      </h3>
                      <div className="text-xs text-[#a89f91] mt-1 line-clamp-1">
                        <span>@{project.ownerLogin}</span>
                      </div>
                      <div className="text-xs text-[#a89f91] flex items-center gap-1.5 flex-wrap">
                        <span>
                          {project.applicantsCount}{' '}
                          {project.applicantsCount === 1 ? 'applicant' : 'applicants'}
                        </span>
                        <span>&bull;</span>
                        <span>{formatTimeAgo(project.createdAt)}</span>
                      </div>
                    </div>

                    {/* 3-dots Context Menu Button */}
                    <div className="absolute right-0 top-0">
                      <button
                        type="button"
                        aria-label="More options"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(isMenuOpen ? null : project.id);
                        }}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-[#a89f91] hover:text-[#faf6f0] hover:bg-[#2a2622] transition"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {/* YouTube-style Context Menu Dropdown */}
                      {isMenuOpen && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-8 z-50 bg-[#1f1c19] border border-[#38322c] rounded-xl shadow-2xl py-1.5 w-48 text-xs text-[#faf6f0] animate-in fade-in-50 zoom-in-95"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              handleCopyLink(project.joinUrl, project.slug);
                              setMenuOpenId(null);
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-[#2a2622] flex items-center gap-2 text-[#d6cec3] hover:text-[#faf6f0]"
                          >
                            <Copy className="w-3.5 h-3.5 text-amber-400" />
                            <span>Copy join link</span>
                          </button>

                          {!project.isPrivate && (
                            <a
                              href={`https://github.com/${project.repoFullName}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => setMenuOpenId(null)}
                              className="w-full px-3 py-2 text-left hover:bg-[#2a2622] flex items-center gap-2 text-[#d6cec3] hover:text-[#faf6f0]"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-amber-400" />
                              <span>Open on GitHub</span>
                            </a>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedProject(project);
                              setMenuOpenId(null);
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-[#2a2622] flex items-center gap-2 text-[#d6cec3] hover:text-[#faf6f0]"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                            <span>View details</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Role Pills Row */}
                  {project.roles && project.roles.length > 0 && (
                    <div className="mt-2.5 pl-12 flex items-center gap-1.5 flex-wrap">
                      {project.roles.slice(0, 3).map((role) => (
                        <span
                          key={role}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-[#1f1c19] text-[#a89f91] border border-[#38322c]"
                        >
                          {role}
                        </span>
                      ))}
                      {project.roles.length > 3 && (
                        <span className="text-[10px] text-[#a89f91]">
                          +{project.roles.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* YouTube-Style Floating Mini Player Card (Bottom-Right) */}
      {showMiniCard && miniProject && (
        <div
          onClick={() => setSelectedProject(miniProject)}
          className="fixed bottom-16 md:bottom-6 right-4 z-40 bg-[#1f1c19] border border-[#38322c] rounded-xl shadow-2xl overflow-hidden w-72 sm:w-80 cursor-pointer hover:border-amber-500/50 transition-all group"
        >
          {/* Mini Progress Bar */}
          <div className="h-1 bg-[#141210] w-full">
            <div className="h-full bg-amber-500 w-1/2 transition-all" />
          </div>

          <div className="p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-none text-amber-400">
              <ShieldCheck className="w-4 h-4" />
            </div>

            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-semibold text-[#faf6f0] truncate group-hover:text-amber-400 transition-colors">
                {miniProject.joinMode === 'screening' ? 'Screening' : 'Featured'}: {miniProject.title}
              </h4>
              <p className="text-[11px] text-[#a89f91] truncate">
                {miniProject.joinMode === 'screening' ? 'Questionnaire ready' : 'Looking for builders'}
              </p>
            </div>

            <button
              type="button"
              aria-label="Dismiss"
              onClick={(e) => {
                e.stopPropagation();
                setShowMiniCard(false);
              }}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[#a89f91] hover:text-[#faf6f0] hover:bg-[#2a2622] transition flex-none"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
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
