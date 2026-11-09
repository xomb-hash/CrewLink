'use client';

import React, { useState } from 'react';
import { ExternalLink, CheckCircle2, Clock, XCircle, ArrowRight, FileText, ShieldCheck } from 'lucide-react';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Project, User, Applicant } from '@/types/index';

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
  const [proofUrl, setProofUrl] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
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
        body: JSON.stringify({ message, proofUrl, linkedinUrl }),
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
            <form onSubmit={handleApply} className="space-y-5">
              {/* Verified GitHub Profile Proof Box */}
              <div className="p-3.5 bg-[#141210] border border-[#38322c] rounded-lg">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    {currentUser.avatarUrl ? (
                      <img
                        src={currentUser.avatarUrl}
                        alt={currentUser.login}
                        className="w-8 h-8 rounded-full border border-[#38322c]"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-[#2a2622] flex items-center justify-center">
                        <GitHubIcon className="w-4 h-4 text-amber-400" />
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-sm text-[#faf6f0]">@{currentUser.login}</span>
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.2 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          <ShieldCheck className="w-3 h-3" /> Verified GitHub
                        </span>
                      </div>
                      <div className="text-[11px] text-[#a89f91]">
                        {currentUser.publicRepos ?? 0} public repos &bull; GitHub profile attached
                      </div>
                    </div>
                  </div>

                  <a
                    href={`https://github.com/${currentUser.login}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-amber-400 hover:underline font-medium"
                  >
                    <span>View Profile</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              {error && (
                <div className="p-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-md">
                  {error}
                </div>
              )}

              {/* Proof / CV / Portfolio Link */}
              <div>
                <label htmlFor="proof-url" className="block text-xs font-semibold text-[#faf6f0] uppercase tracking-wider mb-1.5">
                  Proof of Work / CV / Portfolio (Optional)
                </label>
                <div className="relative">
                  <FileText className="w-4 h-4 text-[#a89f91] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    id="proof-url"
                    type="url"
                    value={proofUrl}
                    onChange={(e) => setProofUrl(e.target.value)}
                    placeholder="https://portfolio.dev or Google Drive CV link"
                    className="pl-9 bg-[#141210] border-[#38322c] text-[#faf6f0] focus-visible:border-amber-500 placeholder:text-[#a89f91] text-xs h-9"
                  />
                </div>
                <span className="block text-[11px] text-[#a89f91] mt-1">
                  Add a link to your resume, portfolio, personal website, or proof of past work.
                </span>
              </div>

              {/* LinkedIn Profile Link */}
              <div>
                <label htmlFor="linkedin-url" className="block text-xs font-semibold text-[#faf6f0] uppercase tracking-wider mb-1.5">
                  LinkedIn Profile (Optional)
                </label>
                <div className="relative">
                  <LinkedInIcon className="w-4 h-4 text-[#a89f91] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <Input
                    id="linkedin-url"
                    type="url"
                    value={linkedinUrl}
                    onChange={(e) => setLinkedinUrl(e.target.value)}
                    placeholder="https://linkedin.com/in/yourprofile"
                    className="pl-9 bg-[#141210] border-[#38322c] text-[#faf6f0] focus-visible:border-amber-500 placeholder:text-[#a89f91] text-xs h-9"
                  />
                </div>
                <span className="block text-[11px] text-[#a89f91] mt-1">
                  Help the owner review your background and credentials.
                </span>
              </div>

              {/* Intro Message */}
              <div>
                <label htmlFor="intro" className="block text-xs font-semibold text-[#faf6f0] uppercase tracking-wider mb-1.5">
                  Introduce yourself or share relevant experience (optional)
                </label>
                <Textarea
                  id="intro"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What parts of this project interest you, or what relevant skills do you bring?"
                  maxLength={300}
                  rows={3}
                  className="bg-[#141210] border-[#38322c] text-[#faf6f0] focus-visible:border-amber-500 placeholder:text-[#a89f91] text-xs"
                />
                <span className="block text-[11px] text-[#a89f91] mt-1">
                  The owner will see your note alongside your account age and public repository count.
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
