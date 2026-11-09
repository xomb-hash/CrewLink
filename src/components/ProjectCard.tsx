'use client';

import React, { useState } from 'react';
import {
  ExternalLink,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  Code2,
  Briefcase,
  FileText,
  KeyRound,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { VisibilityBadge } from './VisibilityBadge';
import { ProjectLogo } from './ProjectLogo';
import type { Project, Applicant, ShareLinks } from '../types/index';

interface ProjectCardProps {
  project: Project & {
    shareLinks: ShareLinks;
    applicants: Applicant[];
    logoUrl: string | null;
  };
  onApprove: (projectId: string, applicantId: string, login: string) => Promise<void>;
  onReject: (projectId: string, applicantId: string, login: string) => Promise<void>;
  onGenerateCode: (projectId: string) => Promise<void>;
  onDelete: (projectId: string) => Promise<void>;
}

function statusFor(applicant: Applicant, joinMode: Project['joinMode']): string {
  if (applicant.status === 'approved') return 'Approved';
  if (applicant.status === 'rejected') return 'Rejected';
  return joinMode === 'screening' ? 'Screening' : 'Applied';
}

export function ProjectCard({ project, onApprove, onReject, onGenerateCode, onDelete }: ProjectCardProps) {
  const [copied, setCopied] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState<Applicant | null>(null);
  const [confirmReject, setConfirmReject] = useState<Applicant | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);

  const applicants = project.applicants ?? [];

  const handleCopyLink = () => {
    navigator.clipboard.writeText(project.shareLinks.joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleGenerateCode = async () => {
    setGeneratingCode(true);
    try {
      await onGenerateCode(project.id);
    } finally {
      setGeneratingCode(false);
    }
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

  const handleConfirmDelete = async () => {
    setLoadingAction(true);
    try {
      await onDelete(project.id);
      setConfirmDelete(false);
    } finally {
      setLoadingAction(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-[10px] border border-line bg-panel">
      {/* Header */}
      <div className="border-b border-line p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <ProjectLogo
              title={project.title}
              logoUrl={project.logoUrl}
              className="h-9 w-9"
              textClassName="text-[13px]"
            />
            <h2 className="text-[15px] font-normal text-ink">{project.title}</h2>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.06em] ${
                project.joinMode === 'screening'
                  ? 'border-purple-500/30 bg-purple-500/10 text-purple-300'
                  : 'border-blue-500/30 bg-blue-500/10 text-blue-300'
              }`}
            >
              {project.joinMode === 'screening' ? 'Screening' : 'Referral'}
            </span>
            <VisibilityBadge isPrivate={project.isPrivate} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!project.isPrivate ? (
              <a
                href={`https://github.com/${project.repoFullName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[#888] transition-colors hover:text-ink"
                title="Open code on GitHub"
              >
                <span>{project.repoFullName}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="font-mono text-[11px] text-[#888]">{project.repoFullName}</span>
            )}
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex h-7 items-center gap-1.5 rounded border border-line-soft px-2.5 text-[11px] text-[#888] transition-colors hover:border-red-500/60 hover:text-red-300"
              title="Delete this project"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          </div>
        </div>

        {project.description && (
          <p className="mt-1 text-[12px] leading-relaxed text-[#999]">{project.description}</p>
        )}

        {project.roles && project.roles.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-[#666]">Roles wanted:</span>
            {project.roles.map((role) => (
              <span key={role} className="rounded-full border border-[#222] px-2.5 py-0.5 text-[11px] text-[#888]">
                {role}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Join link + share */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-[#050505] px-5 py-3">
        <div className="flex w-full max-w-md items-center gap-2 rounded-md border border-line-soft bg-black px-3 py-1.5">
          <span className="flex-1 select-all truncate font-mono text-[11px] text-[#999]">
            {project.shareLinks.joinUrl}
          </span>
          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex flex-none items-center gap-1 rounded border border-line-soft px-2 py-0.5 text-[11px] text-[#bbb] transition-colors hover:border-[#f0f0f0] hover:text-ink"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-[#666]">Share:</span>
          <a
            href={project.shareLinks.linkedIn}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-line-soft px-2.5 py-1 text-[#aaa] transition-colors hover:border-[#f0f0f0] hover:text-ink"
          >
            LinkedIn
          </a>
          <a
            href={project.shareLinks.x}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-line-soft px-2.5 py-1 text-[#aaa] transition-colors hover:border-[#f0f0f0] hover:text-ink"
          >
            X
          </a>
          <a
            href={project.shareLinks.whatsApp}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-line-soft px-2.5 py-1 text-[#aaa] transition-colors hover:border-[#f0f0f0] hover:text-ink"
          >
            WhatsApp
          </a>
        </div>
      </div>

      {/* Referral code */}
      {project.joinMode === 'referral' && (
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-[#050505] px-5 py-2.5 text-[11px]">
          <span className="inline-flex items-center gap-1.5 text-[#666]">
            <KeyRound className="h-3.5 w-3.5" />
            Invite code
          </span>
          {project.referralCode ? (
            <code className="rounded border border-line-soft bg-black px-2 py-0.5 font-mono text-[11px] tracking-[0.12em] text-ink">
              {project.referralCode}
            </code>
          ) : (
            <span className="text-[#777]">Not generated</span>
          )}
          <button
            type="button"
            onClick={handleGenerateCode}
            disabled={generatingCode}
            title="Generating a new code invalidates links shared with the old one."
            className="inline-flex h-7 items-center gap-1.5 rounded border border-line-soft px-2.5 text-[11px] text-[#bbb] transition-colors hover:border-ink hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${generatingCode ? 'animate-spin' : ''}`} />
            {generatingCode ? 'Generating…' : project.referralCode ? 'Generate new code' : 'Generate code'}
          </button>
          <span className="text-[#555]">Regenerating invalidates previously shared links.</span>
        </div>
      )}

      {/* Applicants */}
      <div className="p-5">
        <h3 className="mb-2 text-[10px] uppercase tracking-[0.1em] text-[#555]">
          Applicants ({applicants.length})
        </h3>

        {applicants.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-[#555]">
            No applicants yet. Share your join link on LinkedIn, X, or WhatsApp.
          </div>
        ) : (
          <div>
            {applicants.map((applicant) => {
              const label = statusFor(applicant, project.joinMode);
              const statusClass =
                applicant.status === 'approved'
                  ? 'border-ink text-ink'
                  : applicant.status === 'rejected'
                  ? 'border-[#222] text-[#555] line-through'
                  : 'border-[#444] text-[#ccc]';

              return (
                <div
                  key={applicant.id}
                  className="flex flex-wrap items-center justify-between gap-4 border-b border-[#161616] py-3.5 last:border-0"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="grid h-8 w-8 flex-none place-items-center overflow-hidden rounded-full border border-[#333] text-[11px] text-[#888]">
                      {applicant.userAvatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={applicant.userAvatar}
                          alt={applicant.userLogin}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        applicant.userLogin.charAt(0).toUpperCase()
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          href={`https://github.com/${applicant.userLogin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] font-normal text-[#ddd] hover:text-ink hover:underline"
                        >
                          @{applicant.userLogin}
                        </a>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] ${statusClass}`}
                        >
                          {label}
                        </span>
                      </div>

                      <div className="mt-1 text-[11px] text-[#666]">
                        Account age: <strong className="font-normal text-[#999]">{applicant.accountAge}</strong>
                        <span className="mx-1.5">&middot;</span>
                        Public repositories:{' '}
                        <strong className="font-normal text-[#999]">{applicant.publicRepoCount}</strong>
                      </div>

                      {applicant.message && (
                        <p className="mt-2 border-l border-[#333] pl-2.5 text-[11px] leading-relaxed text-[#999]">
                          &ldquo;{applicant.message}&rdquo;
                        </p>
                      )}

                      {(applicant.githubUrl || applicant.linkedinUrl || applicant.resumeFileName) && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {applicant.githubUrl && (
                            <a
                              href={applicant.githubUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded border border-line-soft px-2 py-0.5 text-[11px] text-[#aaa] transition-colors hover:border-ink hover:text-ink"
                            >
                              <Code2 className="h-3 w-3" />
                              GitHub
                            </a>
                          )}
                          {applicant.linkedinUrl && (
                            <a
                              href={applicant.linkedinUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded border border-line-soft px-2 py-0.5 text-[11px] text-[#aaa] transition-colors hover:border-ink hover:text-ink"
                            >
                              <Briefcase className="h-3 w-3" />
                              LinkedIn
                            </a>
                          )}
                          {applicant.resumeFileName && (
                            <a
                              href={`/api/resume/${applicant.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={applicant.resumeFileName}
                              className="inline-flex max-w-[180px] items-center gap-1 rounded border border-line-soft px-2 py-0.5 text-[11px] text-[#aaa] transition-colors hover:border-ink hover:text-ink"
                            >
                              <FileText className="h-3 w-3 flex-none" />
                              <span className="truncate">Resume</span>
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-none items-center gap-2">
                    {applicant.status === 'pending' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setConfirmApprove(applicant)}
                          className="h-7 rounded-md border border-ink px-3 text-[12px] text-ink transition-colors hover:bg-ink hover:text-black"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmReject(applicant)}
                          className="h-7 rounded-md border border-[#333] px-3 text-[12px] text-[#aaa] transition-colors hover:border-ink hover:text-ink"
                        >
                          Reject
                        </button>
                      </>
                    ) : applicant.status === 'approved' ? (
                      <span className="flex items-center gap-1 text-[11px] text-[#ccc]">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Invitation sent
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-[#555]">
                        <XCircle className="h-3.5 w-3.5" /> Declined
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirm: approve */}
      {confirmApprove && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-[#222] bg-panel p-6 shadow-2xl">
            <h3 className="mb-2 text-base font-normal text-ink">Approve @{confirmApprove.userLogin}?</h3>
            <p className="mb-5 text-[12px] leading-relaxed text-[#999]">
              Approving will send a <strong className="font-normal text-ink">real GitHub collaborator invitation</strong>{' '}
              for repository <code className="font-mono text-[11px] text-[#ccc]">{project.repoFullName}</code>. The
              user must accept the invitation on GitHub to get access.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={loadingAction}
                onClick={() => setConfirmApprove(null)}
                className="h-9 rounded-md border border-line-soft px-4 text-[12px] text-[#888] transition-colors hover:border-[#555] hover:text-[#ccc] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loadingAction}
                onClick={handleConfirmApprove}
                className="h-9 rounded-md border border-ink px-4 text-[12px] text-ink transition-colors hover:bg-ink hover:text-black disabled:opacity-40"
              >
                {loadingAction ? 'Sending invite…' : 'Confirm & send invitation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm: reject */}
      {confirmReject && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-[#222] bg-panel p-6 shadow-2xl">
            <h3 className="mb-2 text-base font-normal text-ink">Reject @{confirmReject.userLogin}?</h3>
            <p className="mb-5 text-[12px] leading-relaxed text-[#999]">
              Are you sure you want to decline this applicant&apos;s request to join?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={loadingAction}
                onClick={() => setConfirmReject(null)}
                className="h-9 rounded-md border border-line-soft px-4 text-[12px] text-[#888] transition-colors hover:border-[#555] hover:text-[#ccc] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loadingAction}
                onClick={handleConfirmReject}
                className="h-9 rounded-md border border-red-500/60 px-4 text-[12px] text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-40"
              >
                {loadingAction ? 'Rejecting…' : 'Reject applicant'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Confirm: delete */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-[#222] bg-panel p-6 shadow-2xl">
            <h3 className="mb-2 text-base font-normal text-ink">Delete {project.title}?</h3>
            <p className="mb-5 text-[12px] leading-relaxed text-[#999]">
              This permanently removes the project, its join link, the applicant list and any uploaded
              files. Your GitHub repository and its collaborators are <strong className="font-normal text-ink">not</strong>{' '}
              affected. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={loadingAction}
                onClick={() => setConfirmDelete(false)}
                className="h-9 rounded-md border border-line-soft px-4 text-[12px] text-[#888] transition-colors hover:border-[#555] hover:text-[#ccc] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loadingAction}
                onClick={handleConfirmDelete}
                className="h-9 rounded-md border border-red-500/60 px-4 text-[12px] text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-40"
              >
                {loadingAction ? 'Deleting…' : 'Delete project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
