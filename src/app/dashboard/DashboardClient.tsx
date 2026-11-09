'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Compass } from 'lucide-react';
import { AdvisoryBanners } from '@/components/AdvisoryBanners';
import { ProjectCard } from '@/components/ProjectCard';
import { ProjectLogo } from '@/components/ProjectLogo';
import type { Project, Applicant, ShareLinks } from '@/types/index';

interface ProjectWithDetails extends Project {
  shareLinks: ShareLinks;
  applicants: Applicant[];
  logoUrl: string | null;
}

interface JoinedProject {
  id: string;
  slug: string;
  title: string;
  description?: string;
  logoUrl: string | null;
  ownerLogin: string;
  status: Applicant['status'];
  invitationSent: boolean;
}

interface DashboardUser {
  login: string;
  name?: string;
  avatarUrl?: string;
}

interface DashboardClientProps {
  initialProjects: ProjectWithDetails[];
  joinedProjects: JoinedProject[];
  user: DashboardUser;
}

export function DashboardClient({ initialProjects, joinedProjects, user }: DashboardClientProps) {
  const [projects, setProjects] = useState<ProjectWithDetails[]>(initialProjects);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const reloadProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch {
      // ignore
    }
  };

  const handleApprove = async (projectId: string, applicantId: string, login: string) => {
    const res = await fetch(`/api/projects/${projectId}/applicants/${applicantId}/approve`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to approve applicant');
      return;
    }
    showToast(`Invitation sent to @${login}! They must accept on GitHub.`);
    await reloadProjects();
  };

  const handleGenerateCode = async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/referral-code`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to generate referral code');
      return;
    }
    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? { ...project, referralCode: data.referralCode, shareLinks: data.shareLinks }
          : project
      )
    );
    showToast('New invite code generated. Previously shared links no longer work.');
  };

  const handleReject = async (projectId: string, applicantId: string, login: string) => {
    const res = await fetch(`/api/projects/${projectId}/applicants/${applicantId}/reject`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to reject applicant');
      return;
    }
    showToast(`Application from @${login} rejected.`);
    await reloadProjects();
  };

  const handleDelete = async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to delete project');
      return;
    }
    setProjects((prev) => prev.filter((project) => project.id !== projectId));
    showToast('Project deleted.');
  };

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <div className="mb-7 flex flex-wrap items-center gap-3.5 rounded-[10px] border border-line bg-panel p-5">
        <div className="grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-full border border-[#3f3f3f] text-base text-[#c9c9c9]">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarUrl} alt={user.login} className="h-full w-full object-cover" />
          ) : (
            user.login.charAt(0).toUpperCase()
          )}
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-normal text-ink">{user.name || user.login}</h2>
          <p className="text-[11px] text-[#9c9c9c]">Signed in with GitHub &middot; @{user.login}</p>
        </div>
        <Link
          href="/discover"
          className="ml-auto inline-flex h-8 flex-none items-center gap-1.5 rounded-md border border-line-soft px-3 text-[12px] text-[#c9c9c9] transition-colors hover:border-[#808080] hover:text-[#f2f2f2]"
        >
          <Compass className="h-3.5 w-3.5" />
          Discover projects
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-light tracking-tight text-ink">Your projects</h1>
          <p className="mt-0.5 text-[12px] text-[#9c9c9c]">
            Manage join links, review requests, and send GitHub invitations.
          </p>
        </div>
      </div>

      {/* Advisory banners required by specification */}
      <AdvisoryBanners />

      {projects.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-line-soft bg-panel px-6 py-16 text-center">
          <h3 className="mb-2 text-sm font-normal text-ink">No repositories connected yet</h3>
          <p className="mx-auto mb-6 max-w-md text-[12px] leading-relaxed text-[#a8a8a8]">
            Connect a GitHub repository where you have admin permissions with the Create button in the top
            right, or browse projects to join.
          </p>
          <Link
            href="/discover"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-ink px-5 text-[13px] text-ink transition-colors hover:bg-ink hover:text-black"
          >
            <Compass className="h-4 w-4" />
            Discover projects
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onApprove={handleApprove}
              onReject={handleReject}
              onGenerateCode={handleGenerateCode}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {joinedProjects.length > 0 && (
        <section className="mt-10">
          <div className="mb-4">
            <h2 className="text-lg font-light tracking-tight text-ink">Projects you joined</h2>
            <p className="mt-0.5 text-[12px] text-[#9c9c9c]">Requests you sent to other creators.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {joinedProjects.map((item) => {
              const statusLabel =
                item.status === 'approved' ? 'Approved' : item.status === 'rejected' ? 'Declined' : 'Pending';
              const statusClass =
                item.status === 'approved'
                  ? 'border-ink text-ink'
                  : item.status === 'rejected'
                  ? 'border-[#3f3f3f] text-[#a8a8a8]'
                  : 'border-[#6b6b6b] text-[#dedede]';
              return (
                <Link
                  key={item.id}
                  href={`/join/${item.slug}`}
                  className="group flex items-start gap-3 rounded-[10px] border border-line bg-panel p-4 transition-colors hover:border-[#9c9c9c]"
                >
                  <ProjectLogo
                    title={item.title}
                    logoUrl={item.logoUrl}
                    className="h-10 w-10"
                    textClassName="text-[13px]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="truncate text-[13px] text-ink">{item.title}</h3>
                      <span
                        className={`flex-none rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.05em] ${statusClass}`}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[#9c9c9c]">by @{item.ownerLogin}</p>
                    <p className="mt-1 text-[11px] text-[#a8a8a8]">
                      {item.status === 'approved'
                        ? 'Invitation sent — accept it on GitHub.'
                        : item.status === 'rejected'
                        ? 'The creator declined this request.'
                        : 'Waiting for the creator to review.'}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {toastMessage && (
        <div className="fixed bottom-24 left-1/2 z-[300] -translate-x-1/2 rounded-lg bg-ink px-5 py-2.5 text-[12px] text-black shadow-lg md:bottom-7">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
