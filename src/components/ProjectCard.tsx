'use client';

import React, { useState } from 'react';
import { ExternalLink, Copy, Check, CheckCircle2, XCircle, Share2 } from 'lucide-react';
import { VisibilityBadge } from './VisibilityBadge';
import type { Project, Applicant, ShareLinks } from '../types/index';

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
    <article className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden shadow-sm mb-6">
      {/* Header */}
      <div className="p-5 border-b border-[#30363d]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-lg font-bold text-white">{project.title}</h2>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                project.joinMode === 'screening'
                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/30'
                  : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
              }`}
            >
              {project.joinMode === 'screening' ? 'Screening first' : 'Referral link'}
            </span>
            <VisibilityBadge isPrivate={project.isPrivate} />
          </div>

          <div>
            {!project.isPrivate ? (
              <a
                href={`https://github.com/${project.repoFullName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-mono text-gray-400 hover:text-blue-400 transition"
                title="Open code on GitHub"
              >
                <span>{project.repoFullName}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            ) : (
              <span className="text-xs font-mono text-gray-400">{project.repoFullName}</span>
            )}
          </div>
        </div>

        {project.description && (
          <p className="text-sm text-gray-400 mt-1 leading-relaxed">{project.description}</p>
        )}

        {project.roles && project.roles.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
            <span className="text-xs text-gray-500">Roles wanted:</span>
            {project.roles.map((role) => (
              <span
                key={role}
                className="text-xs px-2 py-0.5 rounded bg-[#21262d] text-emerald-400/90 border border-emerald-500/20"
              >
                {role}
              </span>
            ))}
          </div>
        )}
      </div>


      {/* Toolbar: Join link + Share buttons */}
      <div className="px-5 py-3 bg-[#0d1117] border-b border-[#30363d] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 bg-[#161b22] border border-[#30363d] rounded-md px-3 py-1.5 max-w-md w-full">
          <span className="text-xs font-mono text-gray-300 truncate flex-1 select-all">
            {project.shareLinks.joinUrl}
          </span>
          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1 text-xs text-gray-300 hover:text-white bg-[#21262d] px-2 py-0.5 rounded border border-[#30363d] transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-500 flex items-center gap-1">
            <Share2 className="w-3.5 h-3.5" /> Share:
          </span>
          <a
            href={project.shareLinks.linkedIn}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 rounded bg-[#21262d] text-gray-300 hover:text-white border border-[#30363d] transition"
          >
            LinkedIn
          </a>
          <a
            href={project.shareLinks.x}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 rounded bg-[#21262d] text-gray-300 hover:text-white border border-[#30363d] transition"
          >
            X
          </a>
          <a
            href={project.shareLinks.whatsApp}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 rounded bg-[#21262d] text-gray-300 hover:text-white border border-[#30363d] transition"
          >
            WhatsApp
          </a>
        </div>
      </div>

      {/* Applicants Section */}
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-200">
            Applicants ({project.applicants?.length || 0})
          </h3>
        </div>

        {project.applicants?.length === 0 ? (
          <div className="text-center py-8 px-4 border border-dashed border-[#30363d] rounded-lg text-sm text-gray-500">
            No applicants yet. Share your join link on LinkedIn, X, or WhatsApp to connect with builders!
          </div>
        ) : (
          <div className="space-y-3">
            {project.applicants.map((applicant) => (
              <div
                key={applicant.id}
                className="bg-[#0d1117] border border-[#30363d] rounded-lg p-4 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3">
                  <img
                    src={applicant.userAvatar || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'}
                    alt={applicant.userLogin}
                    className="w-10 h-10 rounded-full border border-[#30363d] shrink-0"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <a
                        href={`https://github.com/${applicant.userLogin}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-sm text-white hover:underline"
                      >
                        @{applicant.userLogin}
                      </a>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full capitalize font-medium ${
                          applicant.status === 'approved'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : applicant.status === 'rejected'
                            ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {applicant.status}
                      </span>
                    </div>

                    {/* Restricted to Account Age and Public Repo count only */}
                    <div className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                      <span>Account age: <strong>{applicant.accountAge}</strong></span>
                      <span>&bull;</span>
                      <span>Public repositories: <strong>{applicant.publicRepoCount}</strong></span>
                    </div>

                    {applicant.message && (
                      <p className="mt-2 text-xs text-gray-300 bg-[#161b22] px-2.5 py-1.5 rounded border-l-2 border-[#30363d]">
                        &ldquo;{applicant.message}&rdquo;
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {applicant.status === 'pending' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmApprove(applicant)}
                        className="px-3 py-1 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-500 transition"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmReject(applicant)}
                        className="px-3 py-1 text-xs font-medium rounded bg-red-600/80 text-white hover:bg-red-600 transition"
                      >
                        Reject
                      </button>
                    </>
                  ) : applicant.status === 'approved' ? (
                    <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Invitation sent
                    </span>
                  ) : (
                    <span className="text-xs text-gray-500 flex items-center gap-1">
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
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-lg font-bold text-white mb-2">
              Approve @{confirmApprove.userLogin}?
            </h3>
            <p className="text-sm text-gray-300 leading-relaxed mb-4">
              Approving will send a <strong>real GitHub collaborator invitation</strong> for repository <code>{project.repoFullName}</code>. The user must accept the invitation on GitHub to get access.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={loadingAction}
                onClick={() => setConfirmApprove(null)}
                className="px-4 py-1.5 text-xs font-medium rounded bg-[#21262d] text-gray-300 border border-[#30363d] hover:bg-[#30363d]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loadingAction}
                onClick={handleConfirmApprove}
                className="px-4 py-1.5 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-500"
              >
                {loadingAction ? 'Sending Invite...' : 'Confirm & Send Invitation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Reject */}
      {confirmReject && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="bg-[#161b22] border border-[#30363d] rounded-xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-lg font-bold text-white mb-2">
              Reject @{confirmReject.userLogin}?
            </h3>
            <p className="text-sm text-gray-300 leading-relaxed mb-4">
              Are you sure you want to decline this applicant&apos;s request to join?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={loadingAction}
                onClick={() => setConfirmReject(null)}
                className="px-4 py-1.5 text-xs font-medium rounded bg-[#21262d] text-gray-300 border border-[#30363d] hover:bg-[#30363d]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loadingAction}
                onClick={handleConfirmReject}
                className="px-4 py-1.5 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-500"
              >
                {loadingAction ? 'Rejecting...' : 'Reject Applicant'}
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
