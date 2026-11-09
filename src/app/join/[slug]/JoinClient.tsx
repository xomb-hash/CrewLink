'use client';

import React, { useState } from 'react';
import { ExternalLink, CheckCircle2, Clock, XCircle, ArrowRight } from 'lucide-react';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import type { Project, User, Applicant } from '@/types/index';

interface JoinClientProps {
  project: Project & { githubUrl: string | null };
  currentUser: User | null;
  isOwner: boolean;
  existingApplication: Pick<Applicant, 'id' | 'status' | 'createdAt' | 'invitationSent'> | null;
}

export function JoinClient({
  project,
  currentUser,
  isOwner,
  existingApplication: initialExisting,
}: JoinClientProps) {
  const [existingApplication, setExistingApplication] = useState(initialExisting);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/join/${project.slug}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit application');
      }

      setExistingApplication(data.applicant);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not submit application');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4">
      <article className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden shadow-sm">
        {/* Project Header */}
        <div className="p-6 border-b border-[#30363d]">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
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

          <h1 className="text-2xl font-bold text-white mb-2">{project.title}</h1>

          <div className="mb-3">
            {!project.isPrivate && project.githubUrl ? (
              <a
                href={project.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-mono text-blue-400 hover:underline"
                title="Open code on GitHub"
              >
                <span>{project.repoFullName}</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            ) : (
              <span className="text-sm font-mono text-gray-400">{project.repoFullName}</span>
            )}
          </div>

          <p className="text-sm text-gray-300 leading-relaxed">
            {project.description || 'No description provided.'}
          </p>

          <div className="flex items-center gap-2 mt-5 text-xs text-gray-400">
            <span>Administered by</span>
            <img
              src={project.ownerAvatar || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'}
              alt={project.ownerLogin}
              className="w-5 h-5 rounded-full border border-[#30363d]"
            />
            <a
              href={`https://github.com/${project.ownerLogin}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-300 hover:text-white font-medium"
            >
              @{project.ownerLogin}
            </a>
          </div>
        </div>

        {/* Screening Section if applicable */}
        {project.joinMode === 'screening' && project.screeningUrl && (
          <div className="p-5 bg-purple-500/5 border-b border-[#30363d] space-y-2">
            <h3 className="text-sm font-bold text-purple-300">
              Step 1: Complete Screening Task
            </h3>
            <p className="text-xs text-gray-300 leading-relaxed">
              The project owner requires applicants to review or complete their screening task before requesting access.
            </p>
            <div className="pt-1">
              <a
                href={project.screeningUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-[#21262d] text-purple-300 border border-purple-500/30 hover:bg-[#30363d] transition"
              >
                <span>Open Screening Task</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            <p className="text-xs text-gray-500 italic pt-1">
              Note: Screening is based on the honour system. Confirm you have completed it before requesting approval below.
            </p>
          </div>
        )}

        {/* Application Section */}
        <div className="p-6">
          {isOwner ? (
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs leading-relaxed text-center">
              You are the owner of this repository. Share this join link with potential collaborators to receive requests!
            </div>
          ) : existingApplication ? (
            <div className="text-center py-6 px-4">
              <div className="inline-flex p-3 rounded-full mb-3 bg-[#0d1117] border border-[#30363d]">
                {existingApplication.status === 'approved' ? (
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                ) : existingApplication.status === 'rejected' ? (
                  <XCircle className="w-8 h-8 text-red-400" />
                ) : (
                  <Clock className="w-8 h-8 text-amber-400" />
                )}
              </div>

              <h3 className="text-base font-bold text-white capitalize mb-1">
                Application {existingApplication.status}
              </h3>

              <p className="text-xs text-gray-400 max-w-sm mx-auto leading-relaxed">
                {existingApplication.status === 'approved' ? (
                  <>
                    <strong className="text-emerald-400">You have been approved!</strong><br />
                    A real GitHub collaborator invitation has been dispatched. Please check your GitHub email or repository page to accept the invitation and access the code.
                  </>
                ) : existingApplication.status === 'rejected' ? (
                  'The project owner has reviewed and declined this request.'
                ) : (
                  'Your request has been submitted and is currently pending review by the project owner.'
                )}
              </p>
            </div>
          ) : !currentUser ? (
            <div className="text-center py-6 px-4 space-y-4">
              <p className="text-sm text-gray-300">
                Sign in with your GitHub account to request to join this project.
              </p>
              <a
                href={`/auth/github?redirect_to=${encodeURIComponent(`/join/${project.slug}`)}`}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-500 transition shadow"
              >
                <span>Sign in with GitHub to Apply</span>
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          ) : (
            <form onSubmit={handleApply} className="space-y-4">
              <div className="text-xs text-gray-400">
                Applying as <strong className="text-white">@{currentUser.login}</strong>
              </div>

              {error && (
                <div className="p-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="intro" className="block text-xs font-semibold text-gray-200 uppercase tracking-wider mb-2">
                  Introduce yourself or share relevant experience (optional)
                </label>
                <textarea
                  id="intro"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What parts of this project interest you?"
                  maxLength={300}
                  rows={3}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
                <span className="block text-xs text-gray-500 mt-1">
                  The owner will see your note along with your account age and public repository count.
                </span>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-xs font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-500 transition shadow disabled:opacity-50"
                >
                  {submitting ? 'Submitting request...' : 'Request to Join Project'}
                </button>
              </div>
            </form>
          )}
        </div>
      </article>
    </div>
  );
}
