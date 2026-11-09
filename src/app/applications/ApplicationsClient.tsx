'use client';

import React from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, XCircle, ExternalLink, ArrowRight, Sparkles, FolderGit2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import type { UserApplication, User } from '@/types/index';

interface ApplicationsClientProps {
  applications: UserApplication[];
  user: User;
}

export function ApplicationsClient({ applications, user }: ApplicationsClientProps) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">My Applications</h1>
          <p className="text-sm text-gray-400 mt-1">
            Track your requests to collaborate on GitHub projects.
          </p>
        </div>

        <Button asChild size="sm" variant="outline" className="bg-[#161b22] border-[#30363d] text-gray-200 hover:bg-[#21262d]">
          <Link href="/explore" className="inline-flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Explore More Projects</span>
          </Link>
        </Button>
      </div>

      {applications.length === 0 ? (
        <Card className="p-12 text-center bg-[#161b22] border-[#30363d] rounded-xl">
          <FolderGit2 className="w-12 h-12 text-gray-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-white mb-2">No applications yet</h3>
          <p className="text-sm text-gray-400 max-w-md mx-auto mb-6">
            You haven&apos;t requested to join any projects yet. Browse open projects to find something exciting to build!
          </p>
          <Button asChild className="bg-emerald-600 text-white hover:bg-emerald-500 border-0">
            <Link href="/explore" className="inline-flex items-center gap-2">
              <span>Explore Projects</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <Card
              key={app.id}
              className="bg-[#161b22] border-[#30363d] p-5 rounded-xl hover:border-gray-500/80 transition"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1.5 max-w-xl">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <Link
                      href={`/join/${app.project.slug}`}
                      className="text-lg font-bold text-white hover:underline"
                    >
                      {app.project.title}
                    </Link>
                    <VisibilityBadge isPrivate={app.project.isPrivate} />
                    <Badge
                      variant="outline"
                      className={`text-xs px-2.5 py-0.5 rounded-full capitalize font-medium ${
                        app.status === 'approved'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : app.status === 'rejected'
                          ? 'bg-red-500/10 text-red-400 border-red-500/30'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      }`}
                    >
                      {app.status === 'approved' && <CheckCircle2 className="w-3.5 h-3.5 mr-1 inline" />}
                      {app.status === 'pending' && <Clock className="w-3.5 h-3.5 mr-1 inline" />}
                      {app.status === 'rejected' && <XCircle className="w-3.5 h-3.5 mr-1 inline" />}
                      {app.status}
                    </Badge>
                  </div>

                  <div className="text-xs text-gray-400 font-mono flex items-center gap-2">
                    <span>{app.project.repoFullName}</span>
                    <span>&bull;</span>
                    <span>Administered by @{app.project.ownerLogin}</span>
                  </div>

                  {app.project.description && (
                    <p className="text-xs text-gray-300 leading-relaxed pt-1">
                      {app.project.description}
                    </p>
                  )}

                  {app.message && (
                    <div className="mt-2 text-xs text-gray-400 bg-[#0d1117] p-2.5 rounded border border-[#30363d]/60">
                      <span className="text-gray-500">Your intro note: </span>&ldquo;{app.message}&rdquo;
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button asChild size="sm" variant="outline" className="bg-[#0d1117] border-[#30363d] text-gray-300 hover:text-white">
                    <Link href={`/join/${app.project.slug}`}>
                      View Project
                    </Link>
                  </Button>

                  {app.status === 'approved' && !app.project.isPrivate && (
                    <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500 border-0">
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
                <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
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
