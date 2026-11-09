'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { AdvisoryBanners } from '@/components/AdvisoryBanners';
import { ProjectCard } from '@/components/ProjectCard';
import { Button } from '@/components/ui/button';
import type { Project, Applicant, ShareLinks } from '@/types/index';

interface ProjectWithDetails extends Project {
  shareLinks: ShareLinks;
  applicants: Applicant[];
}

interface DashboardClientProps {
  initialProjects: ProjectWithDetails[];
}

export function DashboardClient({ initialProjects }: DashboardClientProps) {
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

  return (
    <div className="max-w-5xl mx-auto px-4">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#faf6f0]">Owner Dashboard</h1>
          <p className="text-sm text-[#a89f91] mt-0.5">
            Manage your connected repositories, share join links, and review collaborator requests.
          </p>
        </div>
        <Button asChild size="sm" className="bg-amber-500 text-stone-950 font-semibold hover:bg-amber-400 border-0 h-9">
          <Link href="/projects/new" className="inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" />
            <span>Connect Repository</span>
          </Link>
        </Button>
      </div>

      {/* Advisory banners required by specification */}
      <AdvisoryBanners />

      {/* Projects List */}
      {projects.length === 0 ? (
        <div className="text-center py-16 px-4 bg-[#1f1c19] border border-dashed border-[#38322c] rounded-xl">
          <h3 className="text-lg font-bold text-[#faf6f0] mb-2">No repositories connected yet</h3>
          <p className="text-sm text-[#a89f91] max-w-md mx-auto mb-6">
            Connect a GitHub repository where you have admin permissions to generate your first join link.
          </p>
          <Button asChild className="bg-amber-500 text-stone-950 font-semibold hover:bg-amber-400 border-0 h-10">
            <Link href="/projects/new" className="inline-flex items-center gap-2">
              <Plus className="w-4 h-4" />
              <span>Connect Your First Repository</span>
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))}
        </div>
      )}

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 bg-[#1f1c19] border-l-4 border-amber-500 border border-[#38322c] text-[#faf6f0] px-4 py-3 rounded-lg shadow-xl text-sm z-50">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
