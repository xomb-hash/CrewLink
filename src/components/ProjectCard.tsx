'use client';

import React, { useState } from 'react';
import { ExternalLink, Copy, Check, CheckCircle2, XCircle, Share2, FileText } from 'lucide-react';
import { VisibilityBadge } from './VisibilityBadge';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Project, Applicant, ShareLinks } from '../types/index';

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9h2.78v8.37H6.46v-8.37M7.85 6.25a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24Z" />
    </svg>
  );
}

interface ProjectCardProps {
  project: Project & {
    shareLinks: ShareLinks;
    applicants: Applicant[];
  };
  onApprove: (projectId: string, applicantId: string, login: string) => Promise<void>;
  onReject: (projectId: string, applicantId: string, login: string) => Promise<void>;
}

export function ProjectCard({ project, onApprove, onReject }: ProjectCardProps) {
  const [copied, setCopied] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState<Applicant | null>(null);
  const [confirmReject, setConfirmReject] = useState<Applicant | null>(null);
  const [loadingAction, setLoadingAction] = useState(false);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(project.shareLinks.joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleConfirmApprove = async () => {
    if (!confirmApprove) return;
    setLoadingAction(true);
    try {
      await onApprove(project.id, confirmApprove.id, confirmApprove.userLogin);
      setConfirmApprove(null);
    } finally {
      setLoadingAction(false);
    }
  };

  const handleConfirmReject = async () => {
    if (!confirmReject) return;
    setLoadingAction(true);
    try {
      await onReject(project.id, confirmReject.id, confirmReject.userLogin);
      setConfirmReject(null);
    } finally {
      setLoadingAction(false);
    }
  };

  return (
    <Card className="bg-[#1f1c19] border-[#38322c] p-0 overflow-hidden shadow-sm mb-6 gap-0">
      {/* Header */}
      <div className="p-5 border-b border-[#38322c]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-lg font-bold text-[#faf6f0]">{project.title}</h2>
            <Badge
              variant="outline"
              className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                project.joinMode === 'screening'
                  ? 'bg-purple-500/10 text-purple-300 border-purple-500/30'
                  : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
              }`}
            >
              {project.joinMode === 'screening' ? 'Screening first' : 'Referral link'}
            </Badge>
            <VisibilityBadge isPrivate={project.isPrivate} />
          </div>

          <div>
            {!project.isPrivate ? (
              <a
                href={`https://github.com/${project.repoFullName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-mono text-[#a89f91] hover:text-amber-400 transition"
                title="Open code on GitHub"
              >
                <span>{project.repoFullName}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            ) : (
              <span className="text-xs font-mono text-[#a89f91]">{project.repoFullName}</span>
            )}
          </div>
        </div>

        {project.description && (
          <p className="text-sm text-[#a89f91] mt-1 leading-relaxed">{project.description}</p>
        )}

        {project.roles && project.roles.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
            <span className="text-xs text-[#a89f91]">Roles wanted:</span>
            {project.roles.map((role) => (
              <Badge
                key={role}
                variant="outline"
                className="text-xs px-2 py-0.5 rounded bg-[#2a2622] text-amber-400 border-amber-500/20"
              >
                {role}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Toolbar: Join link + Share buttons */}
      <div className="px-5 py-3 bg-[#141210] border-b border-[#38322c] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 bg-[#1f1c19] border border-[#38322c] rounded-md px-3 py-1.5 max-w-md w-full">
          <span className="text-xs font-mono text-[#d6cec3] truncate flex-1 select-all">
            {project.shareLinks.joinUrl}
          </span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={handleCopyLink}
            className="gap-1 text-xs text-[#d6cec3] hover:text-[#faf6f0] bg-[#2a2622] border-[#38322c] hover:bg-[#38322c]"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </Button>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-[#a89f91] flex items-center gap-1">
            <Share2 className="w-3.5 h-3.5" /> Share:
          </span>
          <a
            href={project.shareLinks.linkedIn}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 rounded bg-[#2a2622] text-[#d6cec3] hover:text-[#faf6f0] border border-[#38322c] transition"
          >
            LinkedIn
          </a>
          <a
            href={project.shareLinks.x}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 rounded bg-[#2a2622] text-[#d6cec3] hover:text-[#faf6f0] border border-[#38322c] transition"
          >
            X
          </a>
          <a
            href={project.shareLinks.whatsApp}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 rounded bg-[#2a2622] text-[#d6cec3] hover:text-[#faf6f0] border border-[#38322c] transition"
          >
            WhatsApp
          </a>
        </div>
      </div>

      {/* Applicants Section */}
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#faf6f0]">
            Applicants ({project.applicants?.length || 0})
          </h3>
        </div>

        {project.applicants?.length === 0 ? (
          <div className="text-center py-8 px-4 border border-dashed border-[#38322c] rounded-lg text-sm text-[#a89f91]">
            No applicants yet. Share your join link on LinkedIn, X, or WhatsApp to connect with builders!
          </div>
        ) : (
          <div className="space-y-3">
            {project.applicants.map((applicant) => (
              <div
                key={applicant.id}
                className="bg-[#141210] border border-[#38322c] rounded-lg p-4 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3">
                  <img
                    src={applicant.userAvatar || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'}
                    alt={applicant.userLogin}
                    className="w-10 h-10 rounded-full border border-[#38322c] shrink-0"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <a
                        href={`https://github.com/${applicant.userLogin}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-sm text-[#faf6f0] hover:underline"
                      >
                        @{applicant.userLogin}
                      </a>
                      <Badge
                        variant="outline"
                        className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${
                          applicant.status === 'approved'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : applicant.status === 'rejected'
                            ? 'bg-red-500/10 text-red-400 border-red-500/30'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        }`}
                      >
                        {applicant.status}
                      </Badge>
                    </div>

                    {/* Restricted to Account Age and Public Repo count only */}
                    <div className="text-xs text-[#a89f91] mt-1 flex items-center gap-2">
                      <span>Account age: <strong>{applicant.accountAge}</strong></span>
                      <span>&bull;</span>
                      <span>Public repositories: <strong>{applicant.publicRepoCount}</strong></span>
                    </div>

                    {/* Applicant Proof & Credential Links */}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <a
                        href={`https://github.com/${applicant.userLogin}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-[#2a2622] text-[#d6cec3] border border-[#38322c] hover:text-[#faf6f0] hover:bg-[#38322c] transition"
                        title="View GitHub Profile"
                      >
                        <GitHubIcon className="w-3 h-3 text-amber-400" />
                        <span>GitHub Profile</span>
                        <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                      </a>

                      {applicant.proofUrl && (
                        <a
                          href={applicant.proofUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 transition"
                          title="Open CV / Portfolio / Proof"
                        >
                          <FileText className="w-3 h-3 text-amber-400" />
                          <span>CV / Portfolio</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                        </a>
                      )}

                      {applicant.linkedinUrl && (
                        <a
                          href={applicant.linkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30 hover:bg-blue-500/20 transition"
                          title="Open LinkedIn Profile"
                        >
                          <LinkedInIcon className="w-3 h-3 text-blue-400" />
                          <span>LinkedIn</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                        </a>
                      )}
                    </div>

                    {applicant.message && (
                      <p className="mt-2 text-xs text-[#d6cec3] bg-[#1f1c19] px-2.5 py-1.5 rounded border-l-2 border-[#38322c]">
                        &ldquo;{applicant.message}&rdquo;
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {applicant.status === 'pending' ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setConfirmApprove(applicant)}
                        className="bg-emerald-600 text-white hover:bg-emerald-500 border-0 h-8"
                      >
                        Approve
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => setConfirmReject(applicant)}
                        className="bg-red-600/80 hover:bg-red-600 h-8"
                      >
                        Reject
                      </Button>
                    </>
                  ) : applicant.status === 'approved' ? (
                    <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Invitation sent
                    </span>
                  ) : (
                    <span className="text-xs text-[#a89f91] flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5" /> Declined
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation Modal: Approve */}
      {confirmApprove && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="bg-[#1f1c19] border border-[#38322c] rounded-xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-lg font-bold text-[#faf6f0] mb-2">
              Approve @{confirmApprove.userLogin}?
            </h3>
            <p className="text-sm text-[#d6cec3] leading-relaxed mb-4">
              Approving will send a <strong>real GitHub collaborator invitation</strong> for repository <code>{project.repoFullName}</code>. The user must accept the invitation on GitHub to get access.
            </p>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingAction}
                onClick={() => setConfirmApprove(null)}
                className="bg-[#2a2622] text-[#d6cec3] border-[#38322c] hover:bg-[#38322c]"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={loadingAction}
                onClick={handleConfirmApprove}
                className="bg-emerald-600 text-white hover:bg-emerald-500 border-0"
              >
                {loadingAction ? 'Sending Invite...' : 'Confirm & Send Invitation'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Reject */}
      {confirmReject && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="bg-[#1f1c19] border border-[#38322c] rounded-xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-lg font-bold text-[#faf6f0] mb-2">
              Reject @{confirmReject.userLogin}?
            </h3>
            <p className="text-sm text-[#d6cec3] leading-relaxed mb-4">
              Are you sure you want to decline this applicant&apos;s request to join?
            </p>
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loadingAction}
                onClick={() => setConfirmReject(null)}
                className="bg-[#2a2622] text-[#d6cec3] border-[#38322c] hover:bg-[#38322c]"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={loadingAction}
                onClick={handleConfirmReject}
                className="bg-red-600 text-white hover:bg-red-500"
              >
                {loadingAction ? 'Rejecting...' : 'Reject Applicant'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
