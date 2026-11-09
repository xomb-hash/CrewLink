'use client';

import React, { useEffect, useRef } from 'react';
import { CreateProjectForm } from './CreateProjectForm';

interface CreateProjectDialogProps {
  onClose: () => void;
}

export function CreateProjectDialog({ onClose }: CreateProjectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="cl-dialog"
      aria-label="Create a project"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="p-7">
        <div className="mb-2.5 text-[10px] uppercase tracking-[0.1em] text-[#666]">New project</div>
        <h2 className="mb-2.5 text-xl font-light tracking-tight text-ink">Connect a repository</h2>
        <p className="mb-6 text-[13px] leading-relaxed text-[#aaa]">
          Get a shareable join link. You need admin access on the GitHub repo.
        </p>
        <CreateProjectForm onSuccess={onClose} onCancel={onClose} />
      </div>
    </dialog>
  );
}
