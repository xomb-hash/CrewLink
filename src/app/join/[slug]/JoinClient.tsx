'use client';

import React, { useState } from 'react';
import { ExternalLink, CheckCircle2, Clock, XCircle, ArrowRight, Code2, Briefcase, Upload, KeyRound } from 'lucide-react';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import { ProjectLogo } from '@/components/ProjectLogo';
import type { Project, Applicant } from '@/types/index';

type JoinProject = Omit<Project, 'referralCode' | 'referralCodeCreatedAt' | 'referralCodeUsedAt' | 'logoPath'> & {
  githubUrl: string | null;
  logoUrl: string | null;
  requiresReferralCode: boolean;
};

interface JoinCreator {
  login: string;
  name?: string;
  avatarUrl?: string;
  accountAge: string;
  publicRepos: number;
  note?: string;
}

interface JoinClientProps {
  project: JoinProject;
  creator: JoinCreator;
  currentUser: { id: string | number; login: string; name?: string; avatarUrl?: string } | null;
  isOwner: boolean;
  existingApplication: Pick<Applicant, 'id' | 'status' | 'createdAt' | 'invitationSent'> | null;
  initialReferralCode: string;
  referralCodeError: string;
}

const MAX_RESUME_MB = 5;

export function JoinClient({
  project,
  creator,
  currentUser,
  isOwner,
  existingApplication: initialExisting,
  initialReferralCode,
  referralCodeError,
}: JoinClientProps) {
  const [existingApplication, setExistingApplication] = useState(initialExisting);
  const [referralCode, setReferralCode] = useState(initialReferralCode);
  const [codeError, setCodeError] = useState(referralCodeError);
  const [message, setMessage] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setResumeFile(null);
      return;
    }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Resume must be a PDF file.');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_RESUME_MB * 1024 * 1024) {
      setError(`Resume must be ${MAX_RESUME_MB} MB or smaller.`);
      e.target.value = '';
      return;
    }
    setError(null);
    setResumeFile(file);
  };

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    if (project.requiresReferralCode && !referralCode.trim()) {
      setError('Enter the referral code from the creator’s link.');
      setSubmitting(false);
      return;
    }
    if (project.requireGithubLink && !githubUrl.trim()) {
      setError('This project requires a GitHub profile link.');
      setSubmitting(false);
      return;
    }
    if (project.requireLinkedinLink && !linkedinUrl.trim()) {
      setError('This project requires a LinkedIn profile link.');
      setSubmitting(false);
      return;
    }
    if (project.requireResume && !resumeFile) {
      setError('This project requires a PDF resume.');
      setSubmitting(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('message', message);
      formData.append('githubUrl', githubUrl.trim());
      formData.append('linkedinUrl', linkedinUrl.trim());
      formData.append('referralCode', referralCode.trim());
      if (resumeFile) formData.append('resume', resumeFile);

      const res = await fetch(`/api/join/${project.slug}/apply`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error || (Array.isArray(data.errors) ? data.errors.join(' ') : 'Failed to submit application')
        );
      }

      setExistingApplication(data.applicant);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not submit application');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="cl-rise overflow-hidden rounded-[10px] border border-line bg-panel">
        {/* Project header */}
        <div className="border-b border-line p-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.06em] ${
                project.joinMode === 'screening'
                  ? 'border-[#8957e5]/40 bg-[#8957e5]/10 text-[#d2a8ff]'
                  : 'border-[#1f6feb]/40 bg-[#1f6feb]/10 text-[#79c0ff]'
              }`}
            >
              {project.joinMode === 'screening' ? 'Screening' : 'Referral'}
            </span>
            <VisibilityBadge isPrivate={project.isPrivate} />
          </div>

          <div className="mb-3 flex items-start gap-3">
            <ProjectLogo
              title={project.title}
              logoUrl={project.logoUrl}
              className="h-12 w-12"
              textClassName="text-[17px]"
            />
            <div className="min-w-0">
              <h1 className="mb-1.5 text-xl font-semibold tracking-tight text-ink">{project.title}</h1>
              {!project.isPrivate && project.githubUrl ? (
                <a
                  href={project.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-mono text-[12px] text-link transition-colors hover:underline"
                  title="Open code on GitHub"
                >
                  <span>{project.repoFullName}</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : (
                <span className="font-mono text-[12px] text-[#8b949e]">{project.repoFullName}</span>
              )}
            </div>
          </div>

          <p className="text-[13px] leading-relaxed text-[#c9d1d9]">
            {project.description || 'No description provided.'}
          </p>

          {project.roles && project.roles.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {project.roles.map((role) => (
                <span key={role} className="rounded-full border border-[#30363d] px-2.5 py-0.5 text-[11px] text-[#8b949e]">
                  {role}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Creator */}
        <div className="border-b border-line p-6">
          <h2 className="mb-3 text-[10px] uppercase tracking-[0.1em] text-[#6e7681]">About the creator</h2>
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 flex-none place-items-center overflow-hidden rounded-full border border-[#30363d] text-[12px] text-[#c9d1d9]">
              {creator.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={creator.avatarUrl} alt={creator.login} className="h-full w-full object-cover" />
              ) : (
                creator.login.charAt(0).toUpperCase()
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[14px] text-ink">{creator.name || creator.login}</span>
                <a
                  href={`https://github.com/${creator.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-[#8b949e] transition-colors hover:text-ink"
                >
                  @{creator.login}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {creator.accountAge && (
                <div className="mt-1 text-[11px] text-[#8b949e]">
                  GitHub account: <strong className="font-normal text-[#c9d1d9]">{creator.accountAge}</strong>
                  <span className="mx-1.5">&middot;</span>
                  <strong className="font-normal text-[#c9d1d9]">{creator.publicRepos}</strong> public repositories
                </div>
              )}

              {creator.note && (
                <p className="mt-3 whitespace-pre-line border-l border-[#21262d] pl-3 text-[12px] leading-relaxed text-[#c9d1d9]">
                  {creator.note}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Screening step */}
        {project.joinMode === 'screening' && project.screeningUrl && (
          <div className="space-y-2 border-b border-line bg-panel-2 p-5">
            <h3 className="text-[13px] font-normal text-ink">Step 1: Complete the screening task</h3>
            <p className="text-[12px] leading-relaxed text-[#c9d1d9]">
              The project owner requires applicants to review or complete their screening task before requesting
              access.
            </p>
            <div className="pt-1">
              <a
                href={project.screeningUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-success bg-success px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis"
              >
                <span>Open screening task</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <p className="pt-1 text-[11px] italic text-[#8b949e]">
              Note: Screening is based on the honour system. Confirm you have completed it before requesting
              approval below.
            </p>
          </div>
        )}

        {/* Application */}
        <div className="p-6">
          {isOwner ? (
            <div className="rounded-lg border border-line-soft bg-panel-2 p-4 text-center text-[12px] leading-relaxed text-[#e6edf3]">
              You are the owner of this repository. Share this join link with potential collaborators to receive
              requests.
            </div>
          ) : existingApplication ? (
            <div className="px-4 py-6 text-center">
              <div className="mb-3 inline-grid place-items-center rounded-full border border-line-soft bg-background p-3">
                {existingApplication.status === 'approved' ? (
                  <CheckCircle2 className="h-7 w-7 text-[#3fb950]" />
                ) : existingApplication.status === 'rejected' ? (
                  <XCircle className="h-7 w-7 text-[#f85149]" />
                ) : (
                  <Clock className="h-7 w-7 text-[#e3b341]" />
                )}
              </div>

              <h3 className="mb-1 text-sm font-normal capitalize text-ink">
                Application {existingApplication.status}
              </h3>

              <p className="mx-auto max-w-sm text-[12px] leading-relaxed text-[#8b949e]">
                {existingApplication.status === 'approved' ? (
                  <>
                    <strong className="font-normal text-ink">You have been approved!</strong>
                    <br />
                    A real GitHub collaborator invitation has been dispatched. Please check your GitHub email or
                    repository page to accept the invitation and access the code.
                  </>
                ) : existingApplication.status === 'rejected' ? (
                  'The project owner has reviewed and declined this request.'
                ) : (
                  'Your request has been submitted and is currently pending review by the project owner.'
                )}
              </p>
            </div>
          ) : !currentUser ? (
            <div className="space-y-4 px-4 py-6 text-center">
              <p className="text-[13px] text-[#c9d1d9]">
                Sign in with your GitHub account to request to join this project.
              </p>
              {project.requiresReferralCode && (
                <p className="mx-auto max-w-sm text-[11px] leading-relaxed text-[#8b949e]">
                  You will need the referral code from the creator’s link.
                </p>
              )}
              <a
                href={`/auth/github?redirect_to=${encodeURIComponent(
                  `/join/${project.slug}${
                    initialReferralCode ? `?ref=${encodeURIComponent(initialReferralCode)}` : ''
                  }`
                )}`}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-success bg-success px-5 text-[12px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis"
              >
                <span>Sign in with GitHub to apply</span>
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          ) : (
            <form onSubmit={handleApply} className="space-y-4">
              <div className="text-[11px] text-[#8b949e]">
                Applying as <strong className="font-normal text-ink">@{currentUser.login}</strong>
              </div>

              {project.requiresReferralCode && (
                <div>
                  <label htmlFor="apply-code" className="mb-1.5 block text-[11px] tracking-[0.03em] text-[#8b949e]">
                    Referral code <span className="text-ink">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 flex-none text-[#8b949e]" />
                    <input
                      id="apply-code"
                      type="text"
                      value={referralCode}
                      onChange={(e) => {
                        setReferralCode(e.target.value.toUpperCase());
                        setCodeError('');
                      }}
                      placeholder="e.g. ABCD2345"
                      required
                      maxLength={32}
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full rounded-md border border-[#30363d] bg-background px-3 py-2 font-mono text-[13px] uppercase tracking-[0.08em] text-ink outline-none transition-colors focus:border-ring"
                    />
                  </div>
                  <span className={`mt-1 block text-[11px] ${codeError ? 'text-[#e6edf3]' : 'text-[#6e7681]'}`}>
                    {codeError || 'Pre-filled when you open the creator’s referral link.'}
                  </span>
                </div>
              )}

              {error && (
                <div className="rounded-md border border-[#da3633]/40 bg-[#da3633]/10 px-3 py-2 text-[12px] text-[#f85149]">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="intro" className="mb-1.5 block text-[11px] tracking-[0.03em] text-[#8b949e]">
                  Introduce yourself or share relevant experience (optional)
                </label>
                <textarea
                  id="intro"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What parts of this project interest you?"
                  maxLength={300}
                  rows={3}
                  className="w-full resize-y rounded-md border border-[#30363d] bg-background px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-ring"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="apply-github" className="mb-1.5 block text-[11px] tracking-[0.03em] text-[#8b949e]">
                    GitHub profile{project.requireGithubLink ? <span className="text-ink"> *</span> : ' (optional)'}
                  </label>
                  <div className="flex items-center gap-2">
                    <Code2 className="h-4 w-4 flex-none text-[#8b949e]" />
                    <input
                      id="apply-github"
                      type="url"
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                      placeholder="https://github.com/username"
                      required={project.requireGithubLink}
                      className="w-full rounded-md border border-[#30363d] bg-background px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-ring"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="apply-linkedin" className="mb-1.5 block text-[11px] tracking-[0.03em] text-[#8b949e]">
                    LinkedIn profile{project.requireLinkedinLink ? <span className="text-ink"> *</span> : ' (optional)'}
                  </label>
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4 flex-none text-[#8b949e]" />
                    <input
                      id="apply-linkedin"
                      type="url"
                      value={linkedinUrl}
                      onChange={(e) => setLinkedinUrl(e.target.value)}
                      placeholder="https://www.linkedin.com/in/username"
                      required={project.requireLinkedinLink}
                      className="w-full rounded-md border border-[#30363d] bg-background px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-ring"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="apply-resume" className="mb-1.5 block text-[11px] tracking-[0.03em] text-[#8b949e]">
                  Resume{project.requireResume ? <span className="text-ink"> *</span> : ' (optional)'}
                </label>
                <label
                  htmlFor="apply-resume"
                  className="flex cursor-pointer items-center gap-2.5 rounded-md border border-dashed border-[#30363d] bg-background px-3 py-2.5 text-[12px] text-[#8b949e] transition-colors hover:border-[#6e7681] hover:text-[#e6edf3]"
                >
                  <Upload className="h-4 w-4 flex-none" />
                  <span className="truncate">
                    {resumeFile
                      ? `${resumeFile.name} (${(resumeFile.size / (1024 * 1024)).toFixed(1)} MB)`
                      : `Choose a PDF (max ${MAX_RESUME_MB} MB)`}
                  </span>
                </label>
                <input
                  id="apply-resume"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={handleResumeChange}
                  className="sr-only"
                />
                <span className="mt-1 block text-[11px] text-[#6e7681]">
                  Only the project owner can open your resume.
                </span>
              </div>

              <span className="block text-[11px] text-[#6e7681]">
                The owner will see your note, links, and resume along with your GitHub account age and public
                repository count.
              </span>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-9 rounded-md border border-success bg-success px-5 text-[13px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis disabled:opacity-40"
                >
                  {submitting ? 'Submitting request…' : 'Request to join project'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
