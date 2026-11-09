import React from 'react';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { GitBranch, ShieldCheck, UserCheck, ArrowRight, Compass, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import type { Project } from '@/types/index';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await getCurrentUser();
  let previewProjects: Project[] = [];

  try {
    const allProjects = await storage.listProjects();
    previewProjects = allProjects.slice(0, 3);
  } catch {
    previewProjects = [];
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 text-center">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-semibold uppercase tracking-wider mb-6">
        Crewlink for GitHub
      </div>

      <h1 className="text-4xl sm:text-5xl font-extrabold text-[#faf6f0] tracking-tight leading-tight mb-6 max-w-3xl mx-auto">
        Where builders find each other and start creating together.
      </h1>

      <p className="text-lg text-[#a89f91] max-w-2xl mx-auto mb-10 leading-relaxed">
        Connect a GitHub repository, share one join link, and decide who comes aboard. Or browse projects looking for teammates and request to join.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-4 mb-16">
        <Link
          href="/explore"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-amber-500 text-stone-950 font-semibold hover:bg-amber-400 transition shadow-lg shadow-amber-950/40"
        >
          <Compass className="w-4 h-4" />
          <span>Explore Open Projects</span>
          <ArrowRight className="w-4 h-4" />
        </Link>

        {user ? (
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#2a2622] text-[#d6cec3] border border-[#38322c] font-medium hover:bg-[#38322c] hover:text-[#faf6f0] transition"
          >
            <span>Go to Dashboard</span>
          </Link>
        ) : (
          <a
            href="/auth/github"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#2a2622] text-[#d6cec3] border border-[#38322c] font-medium hover:bg-[#38322c] hover:text-[#faf6f0] transition"
          >
            <span>Sign in with GitHub</span>
          </a>
        )}
      </div>

      {/* Featured Projects Preview if any exist */}
      {previewProjects.length > 0 && (
        <section className="mb-16 text-left">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-[#faf6f0] flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <span>Looking for Collaborators</span>
            </h2>
            <Link
              href="/explore"
              className="text-xs font-semibold text-amber-400 hover:underline inline-flex items-center gap-1"
            >
              <span>View all projects</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {previewProjects.map((project) => (
              <Card
                key={project.id}
                className="bg-[#1f1c19] border-[#38322c] p-4 rounded-xl flex flex-col justify-between hover:border-[#4a423a] transition"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <VisibilityBadge isPrivate={project.isPrivate} />
                    <Badge
                      variant="outline"
                      className="text-[10px] px-2 py-0.5 rounded-full capitalize font-medium text-[#d6cec3] border-[#38322c]"
                    >
                      {project.joinMode === 'screening' ? 'Screening' : 'Referral'}
                    </Badge>
                  </div>

                  <h3 className="font-bold text-[#faf6f0] text-sm line-clamp-1 mb-1">
                    {project.title}
                  </h3>
                  <p className="text-xs text-[#a89f91] line-clamp-2 mb-3">
                    {project.description || 'No description provided.'}
                  </p>

                  {project.roles && project.roles.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap mb-4">
                      {project.roles.slice(0, 2).map((role) => (
                        <Badge
                          key={role}
                          variant="outline"
                          className="text-[10px] px-1.5 py-0.5 rounded bg-[#141210] text-amber-400 border-amber-500/20"
                        >
                          {role}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <Link
                  href={`/join/${project.slug}`}
                  className="inline-flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded-md bg-[#2a2622] text-xs font-medium text-amber-400 hover:bg-[#38322c] transition border border-[#38322c]"
                >
                  <span>Request to Join</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* How it works */}
      <section id="how-it-works" className="text-left pt-6 border-t border-[#38322c]/60">
        <h2 className="text-center text-2xl font-bold text-[#faf6f0] mb-8">How Crewlink Works</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[#1f1c19] border border-[#38322c] rounded-xl p-6">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center mb-4">
              <GitBranch className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#faf6f0] mb-2">1. Connect or Explore</h3>
            <p className="text-sm text-[#a89f91] leading-relaxed">
              Owners connect repos they administer. Builders explore open projects looking for specific skills.
            </p>
          </div>

          <div className="bg-[#1f1c19] border border-[#38322c] rounded-xl p-6">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center mb-4">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#faf6f0] mb-2">2. Apply &amp; Screen</h3>
            <p className="text-sm text-[#a89f91] leading-relaxed">
              Applicants sign in with GitHub, review roles wanted, and request to join (completing screening tasks if required).
            </p>
          </div>

          <div className="bg-[#1f1c19] border border-[#38322c] rounded-xl p-6">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4">
              <UserCheck className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#faf6f0] mb-2">3. Invite &amp; Build</h3>
            <p className="text-sm text-[#a89f91] leading-relaxed">
              Owners approve based on account age and repo count. Approval sends a real GitHub collaborator invitation.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-12 bg-[#1f1c19] border border-[#38322c] rounded-xl p-6 text-left">
        <h3 className="text-base font-bold text-[#faf6f0] mb-2">Purpose-built for connecting builders</h3>
        <p className="text-sm text-[#a89f91] leading-relaxed">
          Crewlink only connects people. It is not a chat app and does not track post-approval team performance. Once approved on GitHub, teams continue collaborating on GitHub, Discord, or WhatsApp.
        </p>
      </section>
    </div>
  );
}
