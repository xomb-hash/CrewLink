'use client';

import React, { useState } from 'react';
import { ExternalLink, CheckCircle2, Clock, XCircle, ArrowRight } from 'lucide-react';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
      <Card className="bg-[#1f1c19] border-[#38322c] p-0 overflow-hidden shadow-sm gap-0">
        {/* Project Header */}
        <div className="p-6 border-b border-[#38322c]">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Badge
              variant="outline"
              className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                project.joinMode === 'screening'
                  ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}
            >
              {project.joinMode === 'screening' ? 'Screening first' : 'Referral link'}
            </Badge>
            <VisibilityBadge isPrivate={project.isPrivate} />
          </div>

          <h1 className="text-2xl font-bold text-[#faf6f0] mb-2">{project.title}</h1>

          <div className="mb-3">
            {!project.isPrivate && project.githubUrl ? (
              <a
                href={project.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-mono text-amber-400 hover:underline"
                title="Open code on GitHub"
              >
                <span>{project.repoFullName}</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            ) : (
              <span className="text-sm font-mono text-[#a89f91]">{project.repoFullName}</span>
            )}
          </div>

          <p className="text-sm text-[#d6cec3] leading-relaxed">
            {project.description || 'No description provided.'}
          </p>

          <div className="flex items-center gap-2 mt-5 text-xs text-[#a89f91]">
            <span>Administered by</span>
            <img
              src={project.ownerAvatar || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'}
              alt={project.ownerLogin}
              className="w-5 h-5 rounded-full border border-[#38322c]"
            />
            <a
              href={`https://github.com/${project.ownerLogin}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#d6cec3] hover:text-[#faf6f0] font-medium"
            >
              @{project.ownerLogin}
            </a>
          </div>
        </div>

        {/* Screening Section if applicable */}
        {project.joinMode === 'screening' && project.screeningUrl && (
          <div className="p-5 bg-purple-500/5 border-b border-[#38322c] space-y-2">
            <h3 className="text-sm font-bold text-purple-300">
              Step 1: Complete Screening Task
            </h3>
            <p className="text-xs text-[#d6cec3] leading-relaxed">
              The project owner requires applicants to review or complete their screening task before requesting access.
            </p>
            <div className="pt-1">
              <a
                href={project.screeningUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-[#2a2622] text-purple-300 border border-purple-500/30 hover:bg-[#38322c] transition"
              >
                <span>Open Screening Task</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
            <p className="text-xs text-[#a89f91] italic pt-1">
              Note: Screening is based on the honour system. Confirm you have completed it before requesting approval below.
            </p>
          </div>
        )}

        {/* Application Section */}
        <div className="p-6">
          {isOwner ? (
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs leading-relaxed text-center">
              You are the owner of this repository. Share this join link with potential collaborators to receive requests!
            </div>
          ) : existingApplication ? (
            <div className="text-center py-6 px-4">
              <div className="inline-flex p-3 rounded-full mb-3 bg-[#141210] border border-[#38322c]">
                {existingApplication.status === 'approved' ? (
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                ) : existingApplication.status === 'rejected' ? (
                  <XCircle className="w-8 h-8 text-red-400" />
                ) : (
                  <Clock className="w-8 h-8 text-amber-400" />
                )}
              </div>

              <h3 className="text-base font-bold text-[#faf6f0] capitalize mb-1">
                Application {existingApplication.status}
              </h3>

              <p className="text-xs text-[#a89f91] max-w-sm mx-auto leading-relaxed">
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
              <p className="text-sm text-[#d6cec3]">
                Sign in with your GitHub account to request to join this project.
              </p>
              <a
                href={`/auth/github?redirect_to=${encodeURIComponent(`/join/${project.slug}`)}`}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-md bg-amber-500 text-stone-950 hover:bg-amber-400 transition shadow"
              >
                <span>Sign in with GitHub to Apply</span>
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          ) : (
            <form onSubmit={handleApply} className="space-y-4">
              <div className="text-xs text-[#a89f91]">
                Applying as <strong className="text-[#faf6f0]">@{currentUser.login}</strong>
              </div>

              {error && (
                <div className="p-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="intro" className="block text-xs font-semibold text-[#faf6f0] uppercase tracking-wider mb-2">
                  Introduce yourself or share relevant experience (optional)
                </label>
                <Textarea
                  id="intro"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What parts of this project interest you?"
                  maxLength={300}
                  rows={3}
                  className="bg-[#141210] border-[#38322c] text-[#faf6f0] focus-visible:border-amber-500 placeholder:text-[#a89f91]"
                />
                <span className="block text-xs text-[#a89f91] mt-1">
                  The owner will see your note along with your account age and public repository count.
                </span>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  type="submit"
                  disabled={submitting}
                  className="bg-amber-500 text-stone-950 font-semibold hover:bg-amber-400 border-0"
                >
                  {submitting ? 'Submitting request...' : 'Request to Join Project'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}
