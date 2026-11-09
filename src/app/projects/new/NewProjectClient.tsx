'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GitBranch, AlertTriangle } from 'lucide-react';
import type { GitHubRepo } from '@/github/api';

export function NewProjectClient() {
  const router = useRouter();
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [repoError, setRepoError] = useState<string | null>(null);

  const [selectedRepoFullName, setSelectedRepoFullName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [joinMode, setJoinMode] = useState<'referral' | 'screening'>('referral');
  const [screeningUrl, setScreeningUrl] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRepos() {
      try {
        const res = await fetch('/api/repos');
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to load repositories');
        }
        const data = await res.json();
        setRepos(data.repos || []);
      } catch (err: unknown) {
        setRepoError(err instanceof Error ? err.message : 'Could not fetch repositories');
      } finally {
        setLoadingRepos(false);
      }
    }
    fetchRepos();
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
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoFullName: selectedRepoFullName,
          isPrivate: selectedRepo?.isPrivate || false,
          joinMode,
          screeningUrl: joinMode === 'screening' ? screeningUrl.trim() : '',
          title: title.trim() || selectedRepo?.name,
          description: description.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (data.errors ? data.errors.join(', ') : 'Failed to connect repository'));
      }

      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Connect a Repository</h1>
        <p className="text-sm text-gray-400 mt-1">
          Select a repository you administer to generate a unique join link for collaborators.
        </p>
      </div>

      {loadingRepos ? (
        <div className="p-8 text-center text-sm text-gray-400 bg-[#161b22] border border-[#30363d] rounded-xl">
          Loading your administrative repositories from GitHub...
        </div>
      ) : repoError ? (
        <div className="p-6 bg-[#161b22] border border-red-500/30 rounded-xl text-center">
          <p className="text-sm text-red-400 mb-4">{repoError}</p>
          <a
            href="/auth/github"
            className="inline-flex px-4 py-1.5 text-xs font-semibold rounded bg-[#21262d] text-white border border-[#30363d] hover:bg-[#30363d]"
          >
            Re-authenticate with GitHub
          </a>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-[#161b22] border border-[#30363d] rounded-xl p-6 space-y-5">
          {error && (
            <div className="p-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md">
              {error}
            </div>
          )}

          {/* Repo Selection */}
          <div>
            <label htmlFor="repo-select" className="block text-xs font-semibold text-gray-200 uppercase tracking-wider mb-2">
              GitHub Repository <span className="text-red-400">*</span>
            </label>
            <select
              id="repo-select"
              value={selectedRepoFullName}
              onChange={handleRepoSelect}
              required
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="" disabled>Select a repository you administer...</option>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.fullName}>
                  {repo.fullName} ({repo.isPrivate ? '🔒 Private' : '🌐 Public'})
                </option>
              ))}
            </select>
            <span className="block text-xs text-gray-500 mt-1">
              Only repositories where you have admin permissions are displayed.
            </span>
          </div>

          {/* Title */}
          <div>
            <label htmlFor="project-title" className="block text-xs font-semibold text-gray-200 uppercase tracking-wider mb-2">
              Project Title
            </label>
            <input
              id="project-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Next-Gen Dev Tools"
              maxLength={100}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
            <span className="block text-xs text-gray-500 mt-1">
              Defaults to repository name if left blank.
            </span>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="project-desc" className="block text-xs font-semibold text-gray-200 uppercase tracking-wider mb-2">
              Project Summary
            </label>
            <textarea
              id="project-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the goals and what collaborators you are looking for..."
              maxLength={500}
              rows={3}
              className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
            <span className="block text-xs text-gray-500 mt-1">
              Visible on the public join page (max 500 characters).
            </span>
          </div>

          {/* Join Mode Selection */}
          <div>
            <label className="block text-xs font-semibold text-gray-200 uppercase tracking-wider mb-2">
              Join Mode <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label
                className={`p-3.5 rounded-lg border cursor-pointer transition flex items-start gap-3 ${
                  joinMode === 'referral'
                    ? 'bg-blue-500/10 border-blue-500/50'
                    : 'bg-[#0d1117] border-[#30363d] hover:border-gray-500'
                }`}
              >
                <input
                  type="radio"
                  name="joinMode"
                  value="referral"
                  checked={joinMode === 'referral'}
                  onChange={() => setJoinMode('referral')}
                  className="mt-1"
                />
                <div>
                  <div className="font-semibold text-sm text-white">Referral link</div>
                  <div className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                    People sign in with GitHub and request to join. You review and approve.
                  </div>
                </div>
              </label>

              <label
                className={`p-3.5 rounded-lg border cursor-pointer transition flex items-start gap-3 ${
                  joinMode === 'screening'
                    ? 'bg-purple-500/10 border-purple-500/50'
                    : 'bg-[#0d1117] border-[#30363d] hover:border-gray-500'
                }`}
              >
                <input
                  type="radio"
                  name="joinMode"
                  value="screening"
                  checked={joinMode === 'screening'}
                  onChange={() => setJoinMode('screening')}
                  className="mt-1"
                />
                <div>
                  <div className="font-semibold text-sm text-white">Screening first</div>
                  <div className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                    Applicants complete your test or questionnaire link before approval.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Screening Link input if screening mode is selected */}
          {joinMode === 'screening' && (
            <div className="p-4 bg-[#0d1117] border border-[#30363d] rounded-lg space-y-3">
              <div>
                <label htmlFor="screening-url" className="block text-xs font-semibold text-gray-200 uppercase tracking-wider mb-1">
                  Screening Link <span className="text-red-400">*</span>
                </label>
                <input
                  id="screening-url"
                  type="url"
                  value={screeningUrl}
                  onChange={(e) => setScreeningUrl(e.target.value)}
                  placeholder="https://forms.gle/... or https://typeform.com/..."
                  required
                  className="w-full bg-[#161b22] border border-[#30363d] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 p-3 rounded">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                <span>
                  <strong>Advisory:</strong> Screening is on the honour system. Crewlink cannot check that someone finished a test. Never word the UI as if completion is verified.
                </span>
              </div>
            </div>
          )}

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#30363d]">
            <Link
              href="/dashboard"
              className="px-4 py-2 text-xs font-medium text-gray-400 hover:text-white transition"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-500 transition shadow disabled:opacity-50"
            >
              {submitting ? 'Connecting...' : 'Connect & Generate Join Link'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
