'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ExternalLink, ImagePlus, X } from 'lucide-react';
import { ProjectLogo } from './ProjectLogo';
import type { GitHubRepo } from '@/github/api';

interface CreateProjectFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

const labelClass = 'mb-1.5 block text-[11px] tracking-[0.03em] text-[#888]';
const fieldClass =
  'w-full rounded-md border border-[#262626] bg-black px-3 py-2 text-[13px] text-[#f0f0f0] outline-none transition-colors focus:border-[#f0f0f0]';
const hintClass = 'mt-1 block text-[11px] text-[#555]';

export function CreateProjectForm({ onSuccess, onCancel }: CreateProjectFormProps) {
  const router = useRouter();

  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [repoError, setRepoError] = useState<string | null>(null);

  const [selectedRepoFullName, setSelectedRepoFullName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creatorNote, setCreatorNote] = useState('');
  const [rolesInput, setRolesInput] = useState('');
  const [joinMode, setJoinMode] = useState<'referral' | 'screening'>('referral');
  const [screeningUrl, setScreeningUrl] = useState('');
  const [requireResume, setRequireResume] = useState(false);
  const [requireGithubLink, setRequireGithubLink] = useState(false);
  const [requireLinkedinLink, setRequireLinkedinLink] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  const clearLogo = () => {
    setLogoFile(null);
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setLogoFile(null);
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Logo must be a PNG, JPEG, or WebP image.');
      e.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo must be 2 MB or smaller.');
      e.target.value = '';
      return;
    }
    setError(null);
    setLogoFile(file);
  };

  useEffect(() => {
    let cancelled = false;

    async function fetchRepos() {
      try {
        const res = await fetch('/api/repos');
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to load repositories');
        }
        if (!cancelled) setRepos(data.repos || []);
      } catch (err: unknown) {
        if (!cancelled) {
          setRepoError(err instanceof Error ? err.message : 'Could not fetch repositories');
        }
      } finally {
        if (!cancelled) setLoadingRepos(false);
      }
    }

    fetchRepos();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRepoSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const fullName = e.target.value;
    setSelectedRepoFullName(fullName);
    const found = repos.find((r) => r.fullName === fullName);
    if (found) {
      if (!title) setTitle(found.name);
      if (!description && found.description) setDescription(found.description);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepoFullName) {
      setError('Please select a repository');
      return;
    }

    if (joinMode === 'screening' && !screeningUrl.trim()) {
      setError('Please provide a screening link for screening mode');
      return;
    }

    const selectedRepo = repos.find((r) => r.fullName === selectedRepoFullName);
    const roles = rolesInput
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean)
      .slice(0, 10);

    setSubmitting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('repoFullName', selectedRepoFullName);
      formData.append('isPrivate', String(selectedRepo?.isPrivate || false));
      formData.append('joinMode', joinMode);
      formData.append('screeningUrl', joinMode === 'screening' ? screeningUrl.trim() : '');
      formData.append('roles', JSON.stringify(roles));
      formData.append('title', title.trim() || selectedRepo?.name || '');
      formData.append('description', description.trim());
      formData.append('creatorNote', creatorNote.trim());
      formData.append('requireResume', String(requireResume));
      formData.append('requireGithubLink', String(requireGithubLink));
      formData.append('requireLinkedinLink', String(requireLinkedinLink));
      if (logoFile) formData.append('logo', logoFile);

      const res = await fetch('/api/projects', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (data.errors ? data.errors.join(', ') : 'Failed to connect repository'));
      }

      onSuccess?.();
      // A same-route push + refresh can leave a stale RSC payload on screen,
      // so load the dashboard from the server to guarantee the new project appears.
      window.location.assign('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {repoError ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-center">
          <p className="mb-3 text-xs text-red-300">{repoError}</p>
          <a
            href="/auth/github?redirect_to=%2Fdashboard"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#262626] px-3 py-1.5 text-xs text-[#ccc] transition-colors hover:border-[#555]"
          >
            Re-authenticate with GitHub
            <ExternalLink className="h-3 w-3" />
          </a>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => (onCancel ? onCancel() : router.push('/dashboard'))}
              className="text-xs text-[#888] transition-colors hover:text-[#ccc]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div>
            <label htmlFor="create-repo" className={labelClass}>
              GitHub repository <span className="text-[#f0f0f0]">*</span>
            </label>
            <select
              id="create-repo"
              value={selectedRepoFullName}
              onChange={handleRepoSelect}
              required
              disabled={loadingRepos}
              className={`${fieldClass} disabled:opacity-50`}
            >
              <option value="" disabled>
                {loadingRepos ? 'Loading your repositories…' : 'Select a repository you administer…'}
              </option>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.fullName}>
                  {repo.fullName} ({repo.isPrivate ? 'Private' : 'Public'})
                </option>
              ))}
            </select>
            <span className={hintClass}>Only repositories where you have admin permissions are listed.</span>
          </div>

          <div>
            <label htmlFor="create-title" className={labelClass}>
              Project name
            </label>
            <input
              id="create-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. city-bike-map"
              maxLength={100}
              className={fieldClass}
            />
            <span className={hintClass}>Defaults to the repository name.</span>
          </div>

          <div>
            <span className={labelClass}>Project logo (optional)</span>
            <div className="flex items-center gap-3 rounded-md border border-[#262626] bg-black p-3">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoPreview}
                  alt="Selected project logo"
                  className="h-12 w-12 flex-none rounded-lg border border-line-soft object-cover"
                />
              ) : (
                <ProjectLogo
                  title={title || selectedRepoFullName.split('/')[1] || 'Project'}
                  className="h-12 w-12"
                  textClassName="text-[15px]"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="inline-flex h-7 items-center gap-1.5 rounded border border-line-soft px-2.5 text-[11px] text-[#bbb] transition-colors hover:border-[#666] hover:text-ink"
                  >
                    <ImagePlus className="h-3.5 w-3.5" />
                    {logoFile ? 'Change logo' : 'Upload logo'}
                  </button>
                  {logoFile && (
                    <button
                      type="button"
                      onClick={clearLogo}
                      className="inline-flex h-7 items-center gap-1 rounded px-1.5 text-[11px] text-[#777] transition-colors hover:text-ink"
                    >
                      <X className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[#555]">
                  PNG, JPEG, or WebP up to 2 MB. Without one we generate art from the project name.
                </p>
              </div>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleLogoChange}
              aria-label="Project logo"
              className="sr-only"
            />
          </div>

          <div>
            <label htmlFor="create-mode" className={labelClass}>
              Join mode
            </label>
            <select
              id="create-mode"
              value={joinMode}
              onChange={(e) => setJoinMode(e.target.value === 'screening' ? 'screening' : 'referral')}
              className={fieldClass}
            >
              <option value="referral">Referral link — you approve each request</option>
              <option value="screening">Screening first — test or interview before approval</option>
            </select>
            {joinMode === 'referral' && (
              <span className={hintClass}>
                Referral projects get an invite code embedded in the link. Regenerate it any time from your
                dashboard.
              </span>
            )}
          </div>

          {joinMode === 'screening' && (
            <div className="space-y-2.5">
              <div>
                <label htmlFor="create-screening" className={labelClass}>
                  Screening link <span className="text-[#f0f0f0]">*</span>
                </label>
                <input
                  id="create-screening"
                  type="url"
                  value={screeningUrl}
                  onChange={(e) => setScreeningUrl(e.target.value)}
                  placeholder="https://forms.gle/… or https://typeform.com/…"
                  required
                  className={fieldClass}
                />
              </div>
              <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/[0.06] p-2.5 text-[11px] leading-relaxed text-amber-200/90">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span>
                  Screening is on the honour system. Crewlink cannot check that someone finished a test.
                </span>
              </div>
            </div>
          )}

          <div>
            <label htmlFor="create-desc" className={labelClass}>
              Short description
            </label>
            <input
              id="create-desc"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What are you building?"
              maxLength={500}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="create-creator-note" className={labelClass}>
              About the creator (optional)
            </label>
            <textarea
              id="create-creator-note"
              value={creatorNote}
              onChange={(e) => setCreatorNote(e.target.value)}
              placeholder="Who you are, what you are building, and what you are looking for in a collaborator."
              maxLength={600}
              rows={3}
              className={`${fieldClass} resize-y`}
            />
            <span className={hintClass}>Shown on the join page so applicants know who they are joining.</span>
          </div>

          <div>
            <label htmlFor="create-roles" className={labelClass}>
              Roles wanted (optional)
            </label>
            <input
              id="create-roles"
              type="text"
              value={rolesInput}
              onChange={(e) => setRolesInput(e.target.value)}
              placeholder="Frontend, UI Designer, Tester"
              className={fieldClass}
            />
            <span className={hintClass}>Comma-separated.</span>
          </div>

          <div>
            <span className={labelClass}>Ask applicants for</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-[#262626] bg-black px-3 py-2 text-[12px] text-[#ccc] transition-colors hover:border-[#444]">
                <input
                  type="checkbox"
                  checked={requireResume}
                  onChange={(e) => setRequireResume(e.target.checked)}
                  className="accent-white"
                />
                Resume required
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-[#262626] bg-black px-3 py-2 text-[12px] text-[#ccc] transition-colors hover:border-[#444]">
                <input
                  type="checkbox"
                  checked={requireGithubLink}
                  onChange={(e) => setRequireGithubLink(e.target.checked)}
                  className="accent-white"
                />
                GitHub link required
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-[#262626] bg-black px-3 py-2 text-[12px] text-[#ccc] transition-colors hover:border-[#444]">
                <input
                  type="checkbox"
                  checked={requireLinkedinLink}
                  onChange={(e) => setRequireLinkedinLink(e.target.checked)}
                  className="accent-white"
                />
                LinkedIn link required
              </label>
            </div>
            <span className={hintClass}>
              Applicants can always share these; checked items are compulsory before they can apply.
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
            <button
              type="button"
              onClick={() => (onCancel ? onCancel() : router.push('/dashboard'))}
              className="h-9 rounded-md border border-line-soft px-5 text-[13px] text-[#888] transition-colors hover:border-[#555] hover:text-[#ccc]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || loadingRepos}
              className="h-9 rounded-md border border-ink px-5 text-[13px] font-normal text-ink transition-colors hover:bg-ink hover:text-black disabled:pointer-events-none disabled:opacity-40"
            >
              {submitting ? 'Creating…' : 'Create & get link'}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
