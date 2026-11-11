'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Compass } from 'lucide-react';
import { AdvisoryBanners } from '@/components/AdvisoryBanners';
import { ProjectCard } from '@/components/ProjectCard';
import { ProjectLogo } from '@/components/ProjectLogo';
import type { Project, Applicant, ShareLinks, ReferralSettings } from '@/types/index';

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
  isPrivate: boolean;
}

interface DashboardUser {
  login: string;
  name?: string;
  avatarUrl?: string;
}

// --- Payload returned by the referral API after generate/update/revoke ---
interface ReferralResponse {
  referralCode: string;
  referralCodeCreatedAt?: string;
  referralCodeExpiresAt?: string;
  referralCodeUsageLimit?: number;
  referralCodeRevokedAt?: string;
  referralCodeUsedAt?: string;
  usageCount: number;
  shareLinks: ShareLinks;
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

  // --- Merge fresh referral data into the matching project card ---
  const applyReferralResponse = (projectId: string, data: ReferralResponse) => {
    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? {
              ...project,
              referralCode: data.referralCode || project.referralCode,
              referralCodeCreatedAt: data.referralCodeCreatedAt,
              referralCodeExpiresAt: data.referralCodeExpiresAt,
              referralCodeUsageLimit: data.referralCodeUsageLimit,
              referralCodeRevokedAt: data.referralCodeRevokedAt,
              referralCodeUsedAt: data.referralCodeUsedAt,
              shareLinks: data.shareLinks,
            }
          : project
      )
    );
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
    showToast(`@${login} is now a contributor. They can fork the repo and open pull requests.`);
    await reloadProjects();
  };

  // --- Owner action: generate or replace the reusable link ---
  const handleGenerateCode = async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/referral-code`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to generate referral link');
      return;
    }
    applyReferralResponse(projectId, data);
    showToast('Referral link ready — share it with as many people as you like.');
  };

  // --- Owner action: save the optional usage limit and expiry ---
  const handleUpdateReferral = async (projectId: string, settings: ReferralSettings) => {
    const res = await fetch(`/api/projects/${projectId}/referral-code`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to update the referral link');
      return;
    }
    applyReferralResponse(projectId, data);
    showToast('Referral link settings saved.');
  };

  // --- Owner action: deactivate the link immediately ---
  const handleRevokeCode = async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/referral-code`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to revoke the referral link');
      return;
    }
    applyReferralResponse(projectId, data);
    showToast('Referral link revoked. The old link no longer accepts applications.');
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
        <div className="grid h-11 w-11 flex-none place-items-center overflow-hidden rounded-full border border-[#30363d] text-base text-[#c9d1d9]">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarUrl} alt={user.login} className="h-full w-full object-cover" />
          ) : (
            user.login.charAt(0).toUpperCase()
          )}
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-normal text-ink">{user.name || user.login}</h2>
          <p className="text-[11px] text-[#8b949e]">Signed in with GitHub &middot; @{user.login}</p>
        </div>
        <Link
          href="/discover"
          className="ml-auto inline-flex h-8 flex-none items-center gap-1.5 rounded-md border border-line-soft px-3 text-[12px] text-[#c9d1d9] transition-colors hover:border-[#6e7681] hover:text-[#f0f6fc]"
        >
          <Compass className="h-3.5 w-3.5" />
          Discover projects
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Your projects</h1>
          <p className="mt-0.5 text-[12px] text-[#8b949e]">
            Manage join links, review requests, and grow your contributor list.
          </p>
        </div>
      </div>

      {/* Advisory banners required by specification */}
      <AdvisoryBanners />

      {projects.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-line-soft bg-panel px-6 py-16 text-center">
          <h3 className="mb-2 text-sm font-normal text-ink">No repositories connected yet</h3>
          <p className="mx-auto mb-6 max-w-md text-[12px] leading-relaxed text-[#8b949e]">
            Connect a GitHub repository where you have admin permissions with the Create button in the top
            right, or browse projects to join.
          </p>
          <Link
            href="/discover"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-success bg-success px-5 text-[13px] font-semibold text-white transition-colors hover:border-success-emphasis hover:bg-success-emphasis"
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
              onUpdateReferral={handleUpdateReferral}
              onRevokeCode={handleRevokeCode}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {joinedProjects.length > 0 && (
        <section className="mt-10">
          <div className="mb-4">
            <h2 className="text-lg font-semibold tracking-tight text-ink">Projects you joined</h2>
            <p className="mt-0.5 text-[12px] text-[#8b949e]">Requests you sent to other creators.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {joinedProjects.map((item) => {
              const statusLabel =
                item.status === 'approved' ? 'Contributor' : item.status === 'rejected' ? 'Declined' : 'Pending';
              const statusClass =
                item.status === 'approved'
                  ? 'border-[#238636]/40 bg-[#238636]/15 text-[#3fb950]'
                  : item.status === 'rejected'
                  ? 'border-[#da3633]/40 bg-[#da3633]/15 text-[#f85149]'
                  : 'border-[#d29922]/40 bg-[#d29922]/15 text-[#e3b341]';
              const detail =
                item.status === 'approved'
                  ? item.isPrivate
                    ? 'You are a contributor. This repository is private, so its code stays with the owner.'
                    : 'You are a contributor — fork the repo and open a pull request.'
                  : item.status === 'rejected'
                  ? 'The creator declined this request.'
                  : 'Waiting for the creator to review.';
              return (
                <Link
                  key={item.id}
                  href={`/join/${item.slug}`}
                  className="group flex items-start gap-3 rounded-[10px] border border-line bg-panel p-4 transition-colors hover:border-[#8b949e]"
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
                    <p className="mt-0.5 text-[11px] text-[#8b949e]">by @{item.ownerLogin}</p>
                    <p className="mt-1 text-[11px] text-[#8b949e]">{detail}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {toastMessage && (
        <div className="fixed bottom-24 left-1/2 z-[300] -translate-x-1/2 rounded-lg border border-line bg-panel px-5 py-2.5 text-[12px] text-ink shadow-lg md:bottom-7">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
