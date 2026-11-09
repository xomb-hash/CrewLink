'use client';

import React, { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';
import { CreateProjectDialog } from './CreateProjectDialog';

export interface ShellUser {
  id: string;
  login: string;
  name?: string;
  avatarUrl?: string;
}

interface AppShellProps {
  user: ShellUser | null;
  children: React.ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const openCreate = () => {
    if (!user) {
      router.push('/auth/github?redirect_to=' + encodeURIComponent('/dashboard'));
      return;
    }
    setCreateOpen(true);
  };

  return (
    <>
      <Topbar user={user} onCreate={openCreate} />
      <Sidebar user={user} pathname={pathname} />
      <MobileNav user={user} pathname={pathname} />

      <main className="min-h-screen pt-14 pb-20 md:pb-0 md:pl-[68px]">{children}</main>

      {createOpen && user && <CreateProjectDialog onClose={() => setCreateOpen(false)} />}
    </>
  );
}
