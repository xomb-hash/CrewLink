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
  Link2,
  Share2,
  Settings2,
  Users,
  CalendarClock,
  Ban,
} from 'lucide-react';
import { VisibilityBadge } from './VisibilityBadge';
import { ProjectLogo } from './ProjectLogo';
import { referralCodeExpiresAt, referralCodeState } from '@/projects/referralState';
import type {
  Project,
  Applicant,
  ShareLinks,
  ReferralSettings,
} from '../types/index';

interface ProjectCardProps {
  project: Project & {
    shareLinks: ShareLinks;
    applicants: Applicant[];
    logoUrl: string | null;
  };
  onApprove: (projectId: string, applicantId: string, login: string) => Promise<void>;
  onReject: (projectId: string, applicantId: string, login: string) => Promise<void>;
  onGenerateCode: (projectId: string) => Promise<void>;
  onUpdateReferral: (projectId: string, settings: ReferralSettings) => Promise<void>;
  onRevokeCode: (projectId: string) => Promise<void>;
  onDelete: (projectId: string) => Promise<void>;
}

function statusFor(applicant: Applicant, joinMode: Project['joinMode']): string {
  if (applicant.status === 'approved') return 'Contributor';
  if (applicant.status === 'rejected') return 'Rejected';
  return joinMode === 'screening' ? 'Screening' : 'Applied';
}

export function ProjectCard({
  project,
  onApprove,
  onReject,
  onGenerateCode,
  onUpdateReferral,
  onRevokeCode,
  onDelete,
}: ProjectCardProps) {
  const [copied, setCopied] = useState(false);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState<Applicant | null>(null);
  const [confirmReject, setConfirmReject] = useState<Applicant | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loadingAction, setLoadingAction] = useState(false);
  const [managing, setManaging] = useState(false);
  const [limitInput, setLimitInput] = useState('');
  const [expiryInput, setExpiryInput] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // --- Referral state derived from the project plus its applicants ---
  const applicants = project.applicants ?? [];
  const usageCount =
    project.joinMode === 'referral' && project.referralCode
      ? applicants.filter((applicant) => applicant.referralCode === project.referralCode).length
      : 0;
  const codeState = project.joinMode === 'referral' ? referralCodeState(project, usageCount) : 'active';
  const expiresAt = project.joinMode === 'referral' ? referralCodeExpiresAt(project) : null;
  const usageLimit =
    project.referralCodeUsageLimit && project.referralCodeUsageLimit > 0
      ? project.referralCodeUsageLimit
      : null;
  const limitIsValid =
    !limitInput.trim() || (Number.isInteger(Number(limitInput)) && Number(limitInput) >= 1);
  const codeStatusLabel =
    codeState === 'active'
      ? 'Active'
      : codeState === 'used'
      ? 'Inactive'
      : codeState === 'expired'
      ? 'Expired'
      : codeState === 'limit-reached'
      ? 'Limit reached'
      : codeState === 'revoked'
      ? 'Revoked'
      : 'Not generated';
  const codeStatusNote =
    codeState === 'limit-reached'
      ? 'This link reached its usage limit. Regenerate it to reopen applications.'
      : codeState === 'expired'
      ? 'This link has expired.'
      : codeState === 'used'
      ? 'This link was already used under the old single-use rules.'
      : codeState === 'revoked'
      ? 'This link was revoked.'
      : '';
  const expiryLabel = expiresAt
    ? `Expires ${new Date(expiresAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })}`
    : 'No expiry';

  // --- Clipboard and native share (falls back to copying) ---
  const copyToClipboard = (value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCopyLink = () => {
    copyToClipboard(project.shareLinks.joinUrl);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: project.title, url: project.shareLinks.joinUrl });
        return;
      } catch {
        // Fall back to copying when the share sheet is dismissed or unavailable.
      }
    }
    handleCopyLink();
  };

  // --- Owner actions used by the referral panel and manage modal ---
  const handleGenerateCode = async () => {
    setGeneratingCode(true);
    try {
      await onGenerateCode(project.id);
    } finally {
      setGeneratingCode(false);
    }
  };

  const openManage = () => {
    setLimitInput(usageLimit ? String(usageLimit) : '');
    setExpiryInput(expiresAt ? expiresAt.slice(0, 10) : '');
    setManaging(true);
  };

  const handleSaveSettings = async () => {
    const parsedLimit = limitInput.trim() ? Number(limitInput) : null;
    if (parsedLimit !== null && (!Number.isInteger(parsedLimit) || parsedLimit < 1)) return;
    const parsedExpiry = expiryInput
      ? new Date(`${expiryInput}T23:59:59.999`).toISOString()
      : null;

    setSavingSettings(true);
    try {
      await onUpdateReferral(project.id, {
        usageLimit: parsedLimit,
        expiresAt: parsedExpiry,
      });
      setManaging(false);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRevoke = async () => {
    setRevoking(true);
    try {
      await onRevokeCode(project.id);
      setManaging(false);
    } finally {
      setRevoking(false);
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
            <h2 className="text-[15px] font-semibold text-ink">{project.title}</h2>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.06em] ${
                project.joinMode === 'screening'
                  ? 'border-[#8957e5]/40 bg-[#8957e5]/10 text-[#d2a8ff]'
                  : project.joinMode === 'direct'
                  ? 'border-[#238636]/40 bg-[#238636]/10 text-[#3fb950]'
                  : 'border-[#1f6feb]/40 bg-[#1f6feb]/10 text-[#79c0ff]'
              }`}
            >
              {project.joinMode === 'screening'
                ? 'Screening'
                : project.joinMode === 'direct'
                ? 'Direct join'
                : 'Referral'}
            </span>
            <VisibilityBadge isPrivate={project.isPrivate} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!project.isPrivate ? (
              <a
                href={`https://github.com/${project.repoFullName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-[11px] text-link transition-colors hover:underline"
                title="Open code on GitHub"
              >
                <span>{project.repoFullName}</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="font-mono text-[11px] text-[#8b949e]">{project.repoFullName}</span>
            )}
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex h-7 items-center gap-1.5 rounded border border-line-soft px-2.5 text-[11px] text-[#8b949e] transition-colors hover:border-[#f85149]/60 hover:text-[#f85149]"
              title="Delete this project"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          </div>
        </div>

        {project.description && (
          <p className="mt-1 text-[12px] leading-relaxed text-[#c9d1d9]">{project.description}</p>
        )}

        {project.roles && project.roles.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-[#8b949e]">Roles wanted:</span>
            {project.roles.map((role) => (
              <span key={role} className="rounded-full border border-[#30363d] px-2.5 py-0.5 text-[11px] text-[#8b949e]">
                {role}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Join link + share */}
      {project.joinMode !== 'referral' && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-[#161b22] px-5 py-3">
          <div className="flex w-full max-w-md items-center gap-2 rounded-md border border-line-soft bg-background px-3 py-1.5">
            <span className="flex-1 select-all truncate font-mono text-[11px] text-[#c9d1d9]">
              {project.shareLinks.joinUrl}
            </span>
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex flex-none items-center gap-1 rounded border border-line-soft px-2 py-0.5 text-[11px] text-[#e6edf3] transition-colors hover:border-[#8b949e] hover:text-ink"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-[#8b949e]">Share:</span>
            <a
              href={project.shareLinks.linkedIn}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-line-soft px-2.5 py-1 text-[#c9d1d9] transition-colors hover:border-[#8b949e] hover:text-ink"
            >
              LinkedIn
            </a>
            <a
              href={project.shareLinks.x}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-line-soft px-2.5 py-1 text-[#c9d1d9] transition-colors hover:border-[#8b949e] hover:text-ink"
            >
              X
            </a>
            <a
              href={project.shareLinks.whatsApp}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-line-soft px-2.5 py-1 text-[#c9d1d9] transition-colors hover:border-[#8b949e] hover:text-ink"
            >
              WhatsApp
            </a>
          </div>
        </div>
      )}

      {/* Referral panel: code, state, reusable link, and owner controls */}
      {project.joinMode === 'referral' && (
        <div className="border-b border-line bg-[#161b22] px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#8b949e]">
            <span className="inline-flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5" />
              Referral link
            </span>
            {project.referralCode && (
              <code className="rounded border border-line-soft bg-background px-2 py-0.5 font-mono text-[11px] tracking-[0.12em] text-ink">
                {project.referralCode}
              </code>
            )}
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] ${
                codeState === 'active'
                  ? 'border-[#238636]/40 bg-[#238636]/15 text-[#3fb950]'
                  : codeState === 'revoked' || codeState === 'used'
                  ? 'border-[#da3633]/40 bg-[#da3633]/15 text-[#f85149]'
                  : codeState === 'missing'
                  ? 'border-line-soft text-[#8b949e]'
                  : 'border-[#d29922]/40 bg-[#d29922]/15 text-[#e3b341]'
              }`}
            >
              {codeStatusLabel}
            </span>
          </div>

          {/* No usable link: one button creates a fresh reusable code */}
          {codeState === 'missing' || codeState === 'revoked' ? (
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-lg text-[11px] leading-relaxed text-[#8b949e]">
                One reusable link for every applicant. Unlimited use by default, and you approve each
                request.
              </p>
              <button
                type="button"
                onClick={handleGenerateCode}
                disabled={generatingCode}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-success bg-success px-3.5 text-[12px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis disabled:pointer-events-none disabled:opacity-40"
              >
                <Link2 className="h-3.5 w-3.5" />
                {generatingCode ? 'Generating…' : 'Generate referral link'}
              </button>
            </div>
          ) : (
            <>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <div className="flex w-full max-w-md items-center gap-2 rounded-md border border-line-soft bg-background px-3 py-1.5">
                  <span className="flex-1 select-all truncate font-mono text-[11px] text-[#c9d1d9]">
                    {project.shareLinks.joinUrl}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="inline-flex flex-none items-center gap-1 rounded border border-line-soft px-2 py-0.5 text-[11px] text-[#e6edf3] transition-colors hover:border-[#8b949e] hover:text-ink"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleShare}
                  className="inline-flex h-7 items-center gap-1.5 rounded border border-line-soft px-2.5 text-[11px] text-[#e6edf3] transition-colors hover:border-[#8b949e] hover:text-ink"
                >
                  <Share2 className="h-3 w-3" />
                  Share
                </button>
                <button
                  type="button"
                  onClick={openManage}
                  className="inline-flex h-7 items-center gap-1.5 rounded border border-line-soft px-2.5 text-[11px] text-[#e6edf3] transition-colors hover:border-[#8b949e] hover:text-ink"
                >
                  <Settings2 className="h-3 w-3" />
                  Manage
                </button>
                <button
                  type="button"
                  onClick={handleGenerateCode}
                  disabled={generatingCode}
                  title="Generate a new code. The previous link stops working."
                  className="inline-flex h-7 items-center gap-1.5 rounded border border-line-soft px-2.5 text-[11px] text-[#e6edf3] transition-colors hover:border-[#8b949e] hover:text-ink disabled:pointer-events-none disabled:opacity-40"
                >
                  <RefreshCw className={`h-3 w-3 ${generatingCode ? 'animate-spin' : ''}`} />
                  {generatingCode ? 'Regenerating…' : 'Regenerate'}
                </button>
              </div>

              {/* Live usage count against the optional cap, plus expiry */}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#8b949e]">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3 w-3" />
                  {usageCount} applied
                  <span className="text-[#6e7681]">
                    {usageLimit ? `of ${usageLimit}` : '· Unlimited'}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3 w-3" />
                  {expiryLabel}
                </span>
              </div>

              {codeStatusNote && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#d29922]/30 bg-[#d29922]/10 px-3 py-1.5">
                  <p className="text-[11px] text-[#e3b341]">{codeStatusNote}</p>
                  {codeState !== 'used' && (
                    <button
                      type="button"
                      onClick={handleGenerateCode}
                      disabled={generatingCode}
                      className="text-[11px] font-semibold text-[#e3b341] hover:underline disabled:opacity-40"
                    >
                      Generate new link
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Applicants */}
      <div className="p-5">
        <h3 className="mb-2 text-[10px] uppercase tracking-[0.1em] text-[#6e7681]">
          Applicants ({applicants.length})
        </h3>

        {applicants.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12px] text-[#6e7681]">
            No applicants yet. Share your{' '}
            {project.joinMode === 'referral' ? 'referral link' : 'join link'} with people you want to
            build with.
          </div>
        ) : (
          <div>
            {applicants.map((applicant) => {
              const label = statusFor(applicant, project.joinMode);
              const statusClass =
                applicant.status === 'approved'
                  ? 'border-[#238636]/40 bg-[#238636]/15 text-[#3fb950]'
                  : applicant.status === 'rejected'
                  ? 'border-[#da3633]/40 bg-[#da3633]/15 text-[#f85149]'
                  : 'border-[#d29922]/40 bg-[#d29922]/15 text-[#e3b341]';

              return (
                <div
                  key={applicant.id}
                  className="flex flex-wrap items-center justify-between gap-4 border-b border-[#30363d] py-3.5 last:border-0"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="grid h-8 w-8 flex-none place-items-center overflow-hidden rounded-full border border-[#30363d] text-[11px] text-[#8b949e]">
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
                          className="text-[13px] font-normal text-link hover:underline"
                        >
                          @{applicant.userLogin}
                        </a>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] ${statusClass}`}
                        >
                          {label}
                        </span>
                      </div>

                      <div className="mt-1 text-[11px] text-[#8b949e]">
                        Account age: <strong className="font-normal text-[#c9d1d9]">{applicant.accountAge}</strong>
                        <span className="mx-1.5">&middot;</span>
                        Public repositories:{' '}
                        <strong className="font-normal text-[#c9d1d9]">{applicant.publicRepoCount}</strong>
                      </div>

                      {applicant.message && (
                        <p className="mt-2 border-l border-[#30363d] pl-2.5 text-[11px] leading-relaxed text-[#c9d1d9]">
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
                              className="inline-flex items-center gap-1 rounded border border-line-soft px-2 py-0.5 text-[11px] text-[#c9d1d9] transition-colors hover:border-[#8b949e] hover:text-ink"
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
                              className="inline-flex items-center gap-1 rounded border border-line-soft px-2 py-0.5 text-[11px] text-[#c9d1d9] transition-colors hover:border-[#8b949e] hover:text-ink"
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
                              className="inline-flex max-w-[180px] items-center gap-1 rounded border border-line-soft px-2 py-0.5 text-[11px] text-[#c9d1d9] transition-colors hover:border-[#8b949e] hover:text-ink"
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
                          className="h-7 rounded-md border border-success bg-success px-3 text-[12px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis disabled:opacity-40"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmReject(applicant)}
                          className="h-7 rounded-md border border-line-soft px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#f85149]/60 hover:text-[#f85149]"
                        >
                          Reject
                        </button>
                      </>
                    ) : applicant.status === 'approved' ? (
                      <span className="flex items-center gap-1 text-[11px] text-[#3fb950]">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Contributor
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-[#f85149]">
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
          <div className="w-full max-w-md rounded-xl border border-[#30363d] bg-panel p-6 shadow-2xl">
            <h3 className="mb-2 text-base font-normal text-ink">Approve @{confirmApprove.userLogin}?</h3>
            <p className="mb-5 text-[12px] leading-relaxed text-[#c9d1d9]">
              Approving makes @{confirmApprove.userLogin} a{' '}
              <strong className="font-normal text-ink">contributor on Crewlink</strong>. They will not be
              added as a GitHub collaborator or given write access. They can fork{' '}
              <code className="font-mono text-[11px] text-[#e6edf3]">{project.repoFullName}</code> and open
              pull requests for you to review and merge.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={loadingAction}
                onClick={() => setConfirmApprove(null)}
                className="h-9 rounded-md border border-line-soft px-4 text-[12px] text-[#8b949e] transition-colors hover:border-[#6e7681] hover:text-[#e6edf3] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loadingAction}
                onClick={handleConfirmApprove}
                className="h-9 rounded-md border border-success bg-success px-4 text-[12px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis disabled:opacity-40"
              >
                {loadingAction ? 'Approving…' : 'Confirm approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm: reject */}
      {confirmReject && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-[#30363d] bg-panel p-6 shadow-2xl">
            <h3 className="mb-2 text-base font-normal text-ink">Reject @{confirmReject.userLogin}?</h3>
            <p className="mb-5 text-[12px] leading-relaxed text-[#c9d1d9]">
              Are you sure you want to decline this applicant&apos;s request to join?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={loadingAction}
                onClick={() => setConfirmReject(null)}
                className="h-9 rounded-md border border-line-soft px-4 text-[12px] text-[#8b949e] transition-colors hover:border-[#6e7681] hover:text-[#e6edf3] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loadingAction}
                onClick={handleConfirmReject}
                className="h-9 rounded-md border border-[#da3633] bg-[#da3633] px-4 text-[12px] font-semibold text-white transition-colors hover:border-[#f85149] hover:bg-[#f85149] disabled:opacity-40"
              >
                {loadingAction ? 'Rejecting…' : 'Reject applicant'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Manage modal: optional usage limit, optional expiry, and revoke */}
      {managing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-[#30363d] bg-panel p-6 shadow-2xl">
            <h3 className="mb-2 text-base font-normal text-ink">Manage referral link</h3>
            <p className="mb-5 text-[12px] leading-relaxed text-[#c9d1d9]">
              Control how many people can apply through this link and when it stops accepting requests.
              Regenerating creates a new code and invalidates the current link.
            </p>

            {/* Optional cap on how many people can apply through the link */}
            <div className="mb-4">
              <label
                htmlFor="referral-usage-limit"
                className="mb-1.5 block text-[11px] tracking-[0.03em] text-[#8b949e]"
              >
                Usage limit
              </label>
              <input
                id="referral-usage-limit"
                type="number"
                min={1}
                step={1}
                value={limitInput}
                onChange={(event) => setLimitInput(event.target.value)}
                placeholder="Unlimited"
                className="w-full rounded-md border border-[#30363d] bg-background px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-ring"
              />
              <span className="mt-1 block text-[11px] text-[#6e7681]">
                Leave empty for unlimited. {usageCount} applicant{usageCount === 1 ? '' : 's'} so far.
              </span>
              {!limitIsValid && (
                <span className="mt-1 block text-[11px] text-[#f85149]">
                  Enter a whole number of 1 or more.
                </span>
              )}
            </div>

            {/* Optional end date; the link stops at the end of that day */}
            <div className="mb-4">
              <label
                htmlFor="referral-expiry"
                className="mb-1.5 block text-[11px] tracking-[0.03em] text-[#8b949e]"
              >
                Expiry date
              </label>
              <input
                id="referral-expiry"
                type="date"
                value={expiryInput}
                onChange={(event) => setExpiryInput(event.target.value)}
                className="w-full rounded-md border border-[#30363d] bg-background px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-ring"
              />
              <span className="mt-1 block text-[11px] text-[#6e7681]">
                Leave empty for no expiry. The link stops accepting requests at the end of this day.
              </span>
            </div>

            {/* Destructive revoke on the left; save/cancel on the right */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={revoking || codeState === 'revoked'}
                onClick={handleRevoke}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#da3633] px-3 text-[12px] text-[#f85149] transition-colors hover:bg-[#da3633]/10 disabled:pointer-events-none disabled:opacity-40"
              >
                <Ban className="h-3.5 w-3.5" />
                {revoking ? 'Revoking…' : codeState === 'revoked' ? 'Link revoked' : 'Revoke link'}
              </button>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={savingSettings}
                  onClick={() => setManaging(false)}
                  className="h-9 rounded-md border border-line-soft px-4 text-[12px] text-[#8b949e] transition-colors hover:border-[#6e7681] hover:text-[#e6edf3] disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingSettings || !limitIsValid}
                  onClick={handleSaveSettings}
                  className="h-9 rounded-md border border-success bg-success px-4 text-[12px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis disabled:opacity-40"
                >
                  {savingSettings ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm: delete */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-[#30363d] bg-panel p-6 shadow-2xl">
            <h3 className="mb-2 text-base font-normal text-ink">Delete {project.title}?</h3>
            <p className="mb-5 text-[12px] leading-relaxed text-[#c9d1d9]">
              This permanently removes the project, its join link, the applicant list and any uploaded
              files. Your GitHub repository and its collaborators are <strong className="font-normal text-ink">not</strong>{' '}
              affected. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={loadingAction}
                onClick={() => setConfirmDelete(false)}
                className="h-9 rounded-md border border-line-soft px-4 text-[12px] text-[#8b949e] transition-colors hover:border-[#6e7681] hover:text-[#e6edf3] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loadingAction}
                onClick={handleConfirmDelete}
                className="h-9 rounded-md border border-[#da3633] bg-[#da3633] px-4 text-[12px] font-semibold text-white transition-colors hover:border-[#f85149] hover:bg-[#f85149] disabled:opacity-40"
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
