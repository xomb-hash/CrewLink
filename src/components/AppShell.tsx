'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';
import { MobileNav } from './MobileNav';

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
  const pathname = usePathname();

  return (
    <>
      <Topbar user={user} />
      <Sidebar user={user} pathname={pathname} />
      <MobileNav user={user} pathname={pathname} />

      <main className="min-h-screen pt-14 pb-20 md:pb-0 md:pl-[68px]">{children}</main>
    </>
  );
}
