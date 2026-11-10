'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Copy, ExternalLink, ShieldCheck, X } from 'lucide-react';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { JoinMode } from '@/types/index';

export interface ProjectModalData {
  slug: string;
  title: string;
  repoFullName: string;
  isPrivate: boolean;
  joinMode: JoinMode;
  description?: string;
  ownerLogin: string;
  ownerAvatar?: string;
  applicantsCount: number;
  createdAt: string;
  joinUrl: string;
  roles?: string[];
  screeningUrl?: string;
}

interface ProjectDetailsModalProps {
  project: ProjectModalData;
  onClose: () => void;
  hardJoinNavigation?: boolean;
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

export function ProjectDetailsModal({
  project,
  onClose,
  hardJoinNavigation = false,
}: ProjectDetailsModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(project.joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const joinClass =
    'h-8 border border-[rgba(240,246,252,0.1)] bg-success px-3.5 font-semibold text-white shadow-[0_0_0_1px_rgba(1,4,9,0.3)] hover:bg-success-emphasis';
  const joinHref = `/join/${project.slug}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[120] flex items-center justify-center p-4 overflow-y-auto"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-panel border border-line rounded-xl max-w-2xl w-full overflow-hidden shadow-[0_16px_48px_rgba(1,4,9,0.85)] my-8 relative flex flex-col max-h-[90vh]"
      >
        {/* Modal Header */}
        <div className="p-6 border-b border-line relative bg-canvas-inset/70">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 p-2 rounded-md text-[#8b949e] transition-colors hover:bg-[#21262d] hover:text-ink"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>

          <div className="flex items-center gap-2 mb-3 flex-wrap pr-8">
            <VisibilityBadge isPrivate={project.isPrivate} />
            <Badge
              variant="outline"
              className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                project.joinMode === 'screening'
                  ? 'bg-[#8957e5]/10 text-[#d2a8ff] border-[#8957e5]/40'
                  : 'bg-[#1f6feb]/10 text-[#79c0ff] border-[#1f6feb]/40'
              }`}
            >
              {project.joinMode === 'screening' ? 'Screening first' : 'Referral link'}
            </Badge>
          </div>

          <h2 className="text-2xl font-semibold text-ink tracking-tight mb-1">{project.title}</h2>

          <div className="flex items-center gap-2 text-xs font-mono text-[#8b949e] flex-wrap">
            <span className="max-w-full truncate">{project.repoFullName}</span>
          </div>
        </div>

        {/* Modal Body (Scrollable) */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          <div>
            <h3 className="text-xs font-semibold text-ink uppercase tracking-wider mb-2">
              About the Project
            </h3>
            <p className="text-sm text-[#e6edf3] leading-relaxed whitespace-pre-line">
              {project.description || 'No detailed project description provided by the repository owner.'}
            </p>
          </div>

          {project.roles && project.roles.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-ink uppercase tracking-wider mb-2">
                Looking for Collaborators in
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                {project.roles.map((role) => (
                  <Badge
                    key={role}
                    variant="outline"
                    className="text-xs px-2.5 py-1 rounded-md bg-background text-ink border-line-soft font-medium"
                  >
                    Needs {role}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {project.joinMode === 'screening' && project.screeningUrl && (
            <div className="p-4 bg-panel-2 border border-line-soft rounded-md space-y-2">
              <div className="flex items-center gap-2 text-[#e6edf3] font-semibold text-xs">
                <ShieldCheck className="w-4 h-4" />
                <span>Screening Task Required</span>
              </div>
              <p className="text-xs text-[#e6edf3] leading-relaxed">
                The owner asks applicants to complete an initial questionnaire or screening test before request approval.
              </p>
              <div className="pt-1">
                <a
                  href={project.screeningUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-panel-2 text-[#e6edf3] border border-line-soft hover:bg-[#21262d] transition"
                >
                  <span>Open Screening Task</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}

          <div className="p-4 bg-background border border-line rounded-md flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <img
                src={project.ownerAvatar || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'}
                alt={project.ownerLogin}
                className="w-10 h-10 rounded-full border border-line"
              />
              <div>
                <div className="text-xs text-[#8b949e]">Project Owner</div>
                <a
                  href={`https://github.com/${project.ownerLogin}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-sm text-link hover:underline inline-flex items-center gap-1"
                >
                  <span>@{project.ownerLogin}</span>
                  <ExternalLink className="w-3 h-3 text-[#8b949e]" />
                </a>
              </div>
            </div>

            <div className="text-right text-[13px] text-[#8b949e]">
              <div>
                <strong className="font-semibold text-[#c9d1d9]">{project.applicantsCount}</strong>{' '}
                {project.applicantsCount === 1 ? 'applicant' : 'applicants'}
              </div>
              <div className="text-xs mt-0.5">Posted {formatTimeAgo(project.createdAt)}</div>
            </div>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="p-4 bg-background border-t border-line flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyLink}
            className="bg-[#21262d] border-[#30363d] text-[#e6edf3] hover:border-[#3d444d] hover:bg-[#30363d] hover:text-ink"
          >
            {copied ? (
              <Check className="w-4 h-4 mr-1.5 text-[#3fb950]" />
            ) : (
              <Copy className="w-4 h-4 mr-1.5" />
            )}
            <span>{copied ? 'Link Copied' : 'Share Join Link'}</span>
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-[13px] text-[#8b949e] hover:bg-[#21262d] hover:text-ink"
            >
              Close
            </Button>

            {hardJoinNavigation ? (
              <Button asChild size="sm" className={joinClass}>
                <a href={joinHref} className="inline-flex items-center gap-1.5">
                  <span>Request to Join</span>
                  <ArrowRight className="w-4 h-4" />
                </a>
              </Button>
            ) : (
              <Button asChild size="sm" className={joinClass}>
                <Link href={joinHref} className="inline-flex items-center gap-1.5">
                  <span>Request to Join</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
