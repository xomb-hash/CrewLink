import React from 'react';
import { ArrowRight, GitBranch, ShieldCheck, UserCheck } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { generateShareLinks } from '@/projects/share';
import { projectLogoUrl } from '@/projects/logo';
import { HomeClient, type HomeProject, type HomeDiscoverProject } from './HomeClient';

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'just now';
  const diff = Date.now() - then;
  if (diff < 60_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q : '';

  if (!user) {
    return <Landing />;
  }

  const rawProjects = await storage.getProjectsByOwner(user.login);

  const projects: HomeProject[] = await Promise.all(
    rawProjects.map(async (project) => {
      const applicants = await storage.getApplicantsByProject(project.id);
      const shareLinks = generateShareLinks(project);

      return {
        id: project.id,
        slug: project.slug,
        title: project.title,
        description: project.description || '',
        ownerLogin: project.ownerLogin,
        repoFullName: project.repoFullName,
        isPrivate: project.isPrivate,
        joinMode: project.joinMode,
        roles: project.roles || [],
        applicantCount: applicants.length,
        joinUrl: shareLinks.joinUrl,
        logoUrl: projectLogoUrl(project),
        createdAtLabel: timeAgo(project.createdAt),
      };
    })
  );

  const allProjects = await storage.listProjects();
  const discoverProjects: HomeDiscoverProject[] = allProjects
    .filter(
      (project) =>
        !project.isPrivate && project.ownerLogin.toLowerCase() !== user.login.toLowerCase()
    )
    .slice(0, 3)
    .map((project) => ({
      id: project.id,
      slug: project.slug,
      title: project.title,
      description: project.description || '',
      ownerLogin: project.ownerLogin,
      joinMode: project.joinMode,
      roles: project.roles || [],
      logoUrl: projectLogoUrl(project),
      requiresCode: project.joinMode === 'referral',
    }));

  return (
    <HomeClient
      projects={projects}
      discoverProjects={discoverProjects}
      initialQuery={query}
    />
  );
}

function Landing() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16 text-center">
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-line-soft px-3 py-1 text-[10px] uppercase tracking-[0.1em] text-[#8b949e]">
        Crewlink for GitHub
      </div>

      <h1 className="mx-auto mb-6 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-5xl">
        Where builders find each other and start creating together.
      </h1>

      <p className="mx-auto mb-10 max-w-2xl text-[15px] leading-relaxed text-[#c9d1d9]">
        Connect a GitHub repository, share one join link, and decide who comes aboard. Once approved,
        Crewlink sends real GitHub collaborator invitations.
      </p>

      <div className="mb-16 flex flex-wrap items-center justify-center gap-3">
        <a
          href="/auth/github?redirect_to=%2Fdashboard"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-success bg-success px-6 text-[13px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis"
        >
          Sign in with GitHub
          <ArrowRight className="h-4 w-4" />
        </a>
        <a
          href="#how-it-works"
          className="inline-flex h-10 items-center rounded-md border border-line-soft px-6 text-[13px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#e6edf3]"
        >
          How it works
        </a>
      </div>

      <section id="how-it-works" className="border-t border-line pt-10 text-left">
        <h2 className="mb-7 text-center text-lg font-semibold tracking-tight text-ink">How Crewlink works</h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-[10px] border border-line bg-panel p-6">
            <div className="mb-4 grid h-9 w-9 place-items-center rounded-lg border border-line-soft text-[#c9d1d9]">
              <GitBranch className="h-4 w-4" strokeWidth={1.5} />
            </div>
            <h3 className="mb-1.5 text-[13px] font-normal text-ink">1. Connect your repo</h3>
            <p className="text-[12px] leading-relaxed text-[#8b949e]">
              Sign in with GitHub and select a repository where you have administrative access.
            </p>
          </div>

          <div className="rounded-[10px] border border-line bg-panel p-6">
            <div className="mb-4 grid h-9 w-9 place-items-center rounded-lg border border-line-soft text-[#c9d1d9]">
              <ShieldCheck className="h-4 w-4" strokeWidth={1.5} />
            </div>
            <h3 className="mb-1.5 text-[13px] font-normal text-ink">2. Choose join mode</h3>
            <p className="text-[12px] leading-relaxed text-[#8b949e]">
              Pick <strong className="font-normal text-[#e6edf3]">Referral link</strong> for standard review or{' '}
              <strong className="font-normal text-[#e6edf3]">Screening first</strong> to require an interview or test link.
            </p>
          </div>

          <div className="rounded-[10px] border border-line bg-panel p-6">
            <div className="mb-4 grid h-9 w-9 place-items-center rounded-lg border border-line-soft text-[#c9d1d9]">
              <UserCheck className="h-4 w-4" strokeWidth={1.5} />
            </div>
            <h3 className="mb-1.5 text-[13px] font-normal text-ink">3. Review &amp; invite</h3>
            <p className="text-[12px] leading-relaxed text-[#8b949e]">
              Review applicants by account age and public repo count. Approving dispatches a real GitHub
              collaborator invitation.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-[10px] border border-line bg-panel p-6 text-left">
        <h3 className="mb-1.5 text-[13px] font-normal text-ink">Purpose-built for connecting builders</h3>
        <p className="text-[12px] leading-relaxed text-[#8b949e]">
          Crewlink only connects people. It is not a chat app and does not track post-approval team
          performance. Once approved on GitHub, teams continue collaborating on GitHub, Discord, or WhatsApp.
        </p>
      </section>
    </div>
  );
}
