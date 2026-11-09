'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { GitHubRepo } from '@/github/api';

export function NewProjectClient() {
  const router = useRouter();
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [repoError, setRepoError] = useState<string | null>(null);

  const [selectedRepoFullName, setSelectedRepoFullName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [rolesInput, setRolesInput] = useState('');
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
    const roles = rolesInput
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean)
      .slice(0, 10);

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
          roles,
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
        <h1 className="text-2xl font-bold text-[#faf6f0]">Connect a Repository</h1>
        <p className="text-sm text-[#a89f91] mt-1">
          Select a repository you administer to generate a unique join link for collaborators.
        </p>
      </div>

      {loadingRepos ? (
        <Card className="p-8 text-center text-sm text-[#a89f91] bg-[#1f1c19] border-[#38322c]">
          Loading your administrative repositories from GitHub...
        </Card>
      ) : repoError ? (
        <Card className="p-6 bg-[#1f1c19] border-red-500/30 text-center">
          <p className="text-sm text-red-400 mb-4">{repoError}</p>
          <a
            href="/auth/github"
            className="inline-flex px-4 py-1.5 text-xs font-semibold rounded bg-[#2a2622] text-[#faf6f0] border border-[#38322c] hover:bg-[#38322c]"
          >
            Re-authenticate with GitHub
          </a>
        </Card>
      ) : (
        <form onSubmit={handleSubmit}>
          <Card className="bg-[#1f1c19] border-[#38322c] p-6 space-y-5">
            {error && (
              <div className="p-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md">
                {error}
              </div>
            )}

            {/* Repo Selection */}
            <div>
              <Label htmlFor="repo-select" className="text-xs font-semibold text-[#faf6f0] uppercase tracking-wider mb-2 block">
                GitHub Repository <span className="text-red-400">*</span>
              </Label>
              <select
                id="repo-select"
                value={selectedRepoFullName}
                onChange={handleRepoSelect}
                required
                className="w-full bg-[#141210] border border-[#38322c] rounded-md px-3 py-2 text-sm text-[#faf6f0] focus:outline-none focus:border-amber-500"
              >
                <option value="" disabled>Select a repository you administer...</option>
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.fullName} className="bg-[#1f1c19] text-[#faf6f0]">
                    {repo.fullName} ({repo.isPrivate ? '🔒 Private' : '🌐 Public'})
                  </option>
                ))}
              </select>
              <span className="block text-xs text-[#a89f91] mt-1">
                Only repositories where you have admin permissions are displayed.
              </span>
            </div>

            {/* Title */}
            <div>
              <Label htmlFor="project-title" className="text-xs font-semibold text-[#faf6f0] uppercase tracking-wider mb-2 block">
                Project Title
              </Label>
              <Input
                id="project-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Next-Gen Dev Tools"
                maxLength={100}
                className="bg-[#141210] border-[#38322c] text-[#faf6f0] focus-visible:border-amber-500 placeholder:text-[#a89f91]"
              />
              <span className="block text-xs text-[#a89f91] mt-1">
                Defaults to repository name if left blank.
              </span>
            </div>

            {/* Description */}
            <div>
              <Label htmlFor="project-desc" className="text-xs font-semibold text-[#faf6f0] uppercase tracking-wider mb-2 block">
                Project Summary
              </Label>
              <Textarea
                id="project-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the goals and what collaborators you are looking for..."
                maxLength={500}
                rows={3}
                className="bg-[#141210] border-[#38322c] text-[#faf6f0] focus-visible:border-amber-500 placeholder:text-[#a89f91]"
              />
              <span className="block text-xs text-[#a89f91] mt-1">
                Visible on the public join page (max 500 characters).
              </span>
            </div>

            {/* Roles */}
            <div>
              <Label htmlFor="project-roles" className="text-xs font-semibold text-[#faf6f0] uppercase tracking-wider mb-2 block">
                Roles Wanted (Optional)
              </Label>
              <Input
                id="project-roles"
                type="text"
                value={rolesInput}
                onChange={(e) => setRolesInput(e.target.value)}
                placeholder="e.g. Frontend Engineer, UI Designer, Tester"
                className="bg-[#141210] border-[#38322c] text-[#faf6f0] focus-visible:border-amber-500 placeholder:text-[#a89f91]"
              />
              <span className="block text-xs text-[#a89f91] mt-1">
                Comma-separated list of skills or roles you are looking for.
              </span>
            </div>

            {/* Join Mode Selection */}
            <div>
              <Label className="text-xs font-semibold text-[#faf6f0] uppercase tracking-wider mb-2 block">
                Join Mode <span className="text-red-400">*</span>
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={`p-3.5 rounded-lg border cursor-pointer transition flex items-start gap-3 ${
                    joinMode === 'referral'
                      ? 'bg-amber-500/10 border-amber-500/50'
                      : 'bg-[#141210] border-[#38322c] hover:border-[#4a423a]'
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
                    <div className="font-semibold text-sm text-[#faf6f0]">Referral link</div>
                    <div className="text-xs text-[#a89f91] mt-0.5 leading-relaxed">
                      People sign in with GitHub and request to join. You review and approve.
                    </div>
                  </div>
                </label>

                <label
                  className={`p-3.5 rounded-lg border cursor-pointer transition flex items-start gap-3 ${
                    joinMode === 'screening'
                      ? 'bg-purple-500/10 border-purple-500/50'
                      : 'bg-[#141210] border-[#38322c] hover:border-[#4a423a]'
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
                    <div className="font-semibold text-sm text-[#faf6f0]">Screening first</div>
                    <div className="text-xs text-[#a89f91] mt-0.5 leading-relaxed">
                      Applicants complete your test or questionnaire link before approval.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Screening Link input if screening mode is selected */}
            {joinMode === 'screening' && (
              <div className="p-4 bg-[#141210] border border-[#38322c] rounded-lg space-y-3">
                <div>
                  <Label htmlFor="screening-url" className="text-xs font-semibold text-[#faf6f0] uppercase tracking-wider mb-1 block">
                    Screening Link <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="screening-url"
                    type="url"
                    value={screeningUrl}
                    onChange={(e) => setScreeningUrl(e.target.value)}
                    placeholder="https://forms.gle/... or https://typeform.com/..."
                    required
                    className="bg-[#1f1c19] border-[#38322c] text-[#faf6f0] focus-visible:border-purple-500 placeholder:text-[#a89f91]"
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
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#38322c]">
              <Link
                href="/dashboard"
                className="px-4 py-2 text-xs font-medium text-[#a89f91] hover:text-[#faf6f0] transition"
              >
                Cancel
              </Link>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-amber-500 text-stone-950 font-semibold hover:bg-amber-400 border-0"
              >
                {submitting ? 'Connecting...' : 'Connect & Generate Join Link'}
              </Button>
            </div>
          </Card>
        </form>
      )}
    </div>
  );
}
