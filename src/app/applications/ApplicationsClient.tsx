'use client';

import React from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, XCircle, ExternalLink, ArrowRight, Compass, FolderGit2, FileText } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import type { UserApplication, User } from '@/types/index';

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9h2.78v8.37H6.46v-8.37M7.85 6.25a1.62 1.62 0 1 0 0 3.24 1.62 1.62 0 0 0 0-3.24Z" />
    </svg>
  );
}

interface ApplicationsClientProps {
  applications: UserApplication[];
  user: User;
}

export function ApplicationsClient({ applications, user }: ApplicationsClientProps) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">My applications</h1>
          <p className="mt-1 text-[12px] text-[#8b949e]">
            Track your requests to collaborate on GitHub projects.
          </p>
        </div>

        <Button asChild size="sm" variant="outline" className="bg-panel-2 border-line text-[#e6edf3] hover:bg-[#21262d] hover:text-ink">
          <Link href="/explore" className="inline-flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-ink" />
            <span>Explore projects</span>
          </Link>
        </Button>
      </div>

      {applications.length === 0 ? (
        <Card className="p-10 text-center bg-panel border-line rounded-xl">
          <FolderGit2 className="w-10 h-10 text-[#6e7681] mx-auto mb-3" strokeWidth={1.25} />
          <h3 className="text-base font-semibold text-ink mb-1.5">No applications yet</h3>
          <p className="text-[12px] text-[#8b949e] max-w-sm mx-auto mb-5 leading-relaxed">
            You haven&apos;t requested to join any projects yet. Browse open projects to find something exciting to build!
          </p>
          <Button asChild className="self-center bg-success text-white font-semibold hover:bg-success-emphasis border-0">
            <Link href="/explore" className="inline-flex items-center gap-2">
              <span>Explore projects</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <Card
              key={app.id}
              className="bg-panel border-line p-5 rounded-xl hover:border-[#6e7681] transition"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1.5 max-w-xl">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <Link
                      href={`/join/${app.project.slug}`}
                      className="text-lg font-semibold text-ink hover:underline"
                    >
                      {app.project.title}
                    </Link>
                    <VisibilityBadge isPrivate={app.project.isPrivate} />
                    <Badge
                      variant="outline"
                      className={`text-xs px-2.5 py-0.5 rounded-full capitalize font-medium ${
                        app.status === 'approved'
                          ? 'bg-[#238636]/15 text-[#3fb950] border-[#238636]/40'
                          : app.status === 'rejected'
                          ? 'bg-[#da3633]/15 text-[#f85149] border-[#da3633]/40'
                          : 'bg-[#d29922]/15 text-[#e3b341] border-[#d29922]/40'
                      }`}
                    >
                      {app.status === 'approved' && <CheckCircle2 className="w-3.5 h-3.5 mr-1 inline" />}
                      {app.status === 'pending' && <Clock className="w-3.5 h-3.5 mr-1 inline" />}
                      {app.status === 'rejected' && <XCircle className="w-3.5 h-3.5 mr-1 inline" />}
                      {app.status}
                    </Badge>
                  </div>

                  <div className="text-xs text-[#8b949e] font-mono flex items-center gap-2">
                    <span>{app.project.repoFullName}</span>
                    <span>&bull;</span>
                    <span>Administered by @{app.project.ownerLogin}</span>
                  </div>

                  {app.project.description && (
                    <p className="text-xs text-[#e6edf3] leading-relaxed pt-1">
                      {app.project.description}
                    </p>
                  )}

                  {app.message && (
                    <div className="mt-2 text-xs text-[#8b949e] bg-background p-2.5 rounded border border-line/60">
                      <span className="text-[#8b949e]/70">Your intro note: </span>&ldquo;{app.message}&rdquo;
                    </div>
                  )}

                  {(app.proofUrl || app.linkedinUrl) && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {app.proofUrl && (
                        <a
                          href={app.proofUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-[#21262d] text-[#e6edf3] border border-line-soft hover:bg-[#30363d] transition"
                        >
                          <FileText className="w-3 h-3 text-ink" />
                          <span>Attached CV / Portfolio</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                        </a>
                      )}

                      {app.linkedinUrl && (
                        <a
                          href={app.linkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-[#21262d] text-[#e6edf3] border border-line-soft hover:bg-[#30363d] transition"
                        >
                          <LinkedInIcon className="w-3 h-3 text-[#c9d1d9]" />
                          <span>Attached LinkedIn</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                        </a>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button asChild size="sm" variant="outline" className="bg-background border-line text-[#e6edf3] hover:text-ink hover:bg-panel-2">
                    <Link href={`/join/${app.project.slug}`}>
                      View project
                    </Link>
                  </Button>

                  {app.status === 'approved' && !app.project.isPrivate && (
                    <Button asChild size="sm" className="bg-success text-white font-semibold hover:bg-success-emphasis border-0">
                      <a
                        href={`https://github.com/${app.project.repoFullName}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5"
                      >
                        <span>Open on GitHub</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>

              {/* Status Notification Callout */}
              {app.status === 'approved' && (
                <div className="mt-4 p-3 bg-[#238636]/10 border border-[#238636]/40 rounded-lg text-xs text-[#3fb950] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-ink" />
                  <span>
                    <strong>Invitation Sent!</strong> A GitHub collaborator invite has been dispatched. Please check your GitHub email or repository page to accept collaborator access.
                  </span>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
