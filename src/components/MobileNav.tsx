'use client';

import React from 'react';
import Link from 'next/link';
import { Home, LayoutGrid, Compass, LogOut, LogIn } from 'lucide-react';
import type { ShellUser } from './AppShell';

interface MobileNavProps {
  user: ShellUser | null;
  pathname: string;
}

export function MobileNav({ user, pathname }: MobileNavProps) {
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  const itemClass = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-light tracking-[0.04em] ${
      active ? 'text-ink' : 'text-[#9c9c9c]'
    }`;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-[90] flex border-t border-line bg-black pb-[env(safe-area-inset-bottom,0px)] md:hidden"
    >
      <Link href="/" prefetch={false} aria-current={isActive('/') ? 'page' : undefined} className={itemClass(isActive('/'))}>
        <Home className="h-[18px] w-[18px]" strokeWidth={1.4} />
        Home
      </Link>
      <Link
        href="/discover"
        prefetch={false}
        aria-current={isActive('/discover') ? 'page' : undefined}
        className={itemClass(isActive('/discover'))}
      >
        <Compass className="h-[18px] w-[18px]" strokeWidth={1.4} />
        Discover
      </Link>
      <Link
        href="/dashboard"
        prefetch={false}
        aria-current={isActive('/dashboard') ? 'page' : undefined}
        className={itemClass(isActive('/dashboard'))}
      >
        <LayoutGrid className="h-[18px] w-[18px]" strokeWidth={1.4} />
        Dashboard
      </Link>
      {user ? (
        <a href="/auth/logout" className={itemClass(false)}>
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.4} />
          Sign out
        </a>
      ) : (
        <a href="/auth/github?redirect_to=%2Fdashboard" className={itemClass(false)}>
          <LogIn className="h-[18px] w-[18px]" strokeWidth={1.4} />
          Sign in
        </a>
      )}
    </nav>
  );
}
