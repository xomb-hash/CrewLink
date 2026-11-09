'use client';

import React from 'react';
import { CreateProjectForm } from '@/components/CreateProjectForm';

export function NewProjectClient() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-10">
      <div className="cl-rise w-full max-w-xl rounded-xl border border-line bg-panel p-7">
        <div className="mb-2.5 text-[10px] uppercase tracking-[0.1em] text-[#666]">New project</div>
        <h1 className="mb-2.5 text-xl font-light tracking-tight text-ink">Connect a repository</h1>
        <p className="mb-6 text-[13px] leading-relaxed text-[#aaa]">
          Get a shareable join link. You need admin access on the GitHub repo.
        </p>
        <CreateProjectForm />
      </div>
    </div>
  );
}
