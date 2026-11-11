'use client';

import React from 'react';
import Link from 'next/link';
import { Home, LayoutGrid, Compass, Send, Megaphone, Sparkles, BarChart3, LogOut, LogIn } from 'lucide-react';
import type { ShellUser } from './AppShell';

interface SidebarProps {
  user: ShellUser | null;
  pathname: string;
}

export function Sidebar({ user, pathname }: SidebarProps) {
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="Main"
      className="fixed left-0 top-14 bottom-0 z-[90] hidden w-[76px] flex-col items-center gap-0.5 border-r border-line bg-canvas-inset py-4 md:flex"
    >
      <NavItem href="/" label="Home" active={isActive('/')} icon={<Home className="h-[18px] w-[18px]" strokeWidth={1.4} />} />
      <NavItem
        href="/discover"
        label="Discover"
        active={isActive('/discover')}
        icon={<Compass className="h-[18px] w-[18px]" strokeWidth={1.4} />}
      />
      <NavItem
        href="/applications"
        label="Applications"
        active={isActive('/applications')}
        icon={<Send className="h-[18px] w-[18px]" strokeWidth={1.4} />}
      />
      <NavItem
        href="/publishing"
        label="Publishing"
        active={isActive('/publishing')}
        icon={<Megaphone className="h-[18px] w-[18px]" strokeWidth={1.4} />}
      />
      <NavItem
        href="/analytics"
        label="Analytics"
        active={isActive('/analytics')}
        icon={<BarChart3 className="h-[18px] w-[18px]" strokeWidth={1.4} />}
      />
      <NavItem
        href="/ai"
        label="AI Studio"
        active={isActive('/ai')}
        icon={<Sparkles className="h-[18px] w-[18px]" strokeWidth={1.4} />}
      />
      <NavItem
        href="/dashboard"
        label="Dashboard"
        active={isActive('/dashboard')}
        icon={<LayoutGrid className="h-[18px] w-[18px]" strokeWidth={1.4} />}
      />

      {user ? (
        <a
          href="/auth/logout"
          className="flex w-[64px] flex-col items-center gap-1 rounded-lg py-2.5 text-[10px] font-normal tracking-[0.02em] text-[#8b949e] transition-colors hover:bg-[#21262d] hover:text-[#e6edf3]"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.4} />
          Sign out
          <span className="mt-[-2px] h-[3px] w-[3px] rounded-full bg-selected opacity-0" />
        </a>
      ) : (
        <a
          href="/auth/github?redirect_to=%2Fdashboard"
          className="flex w-[64px] flex-col items-center gap-1 rounded-lg py-2.5 text-[10px] font-normal tracking-[0.02em] text-[#8b949e] transition-colors hover:bg-[#21262d] hover:text-[#e6edf3]"
        >
          <LogIn className="h-[18px] w-[18px]" strokeWidth={1.4} />
          Sign in
          <span className="mt-[-2px] h-[3px] w-[3px] rounded-full bg-selected opacity-0" />
        </a>
      )}
    </nav>
  );
}

function NavItem({
  href,
  label,
  active,
  icon,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? 'page' : undefined}
      className={`flex w-[64px] flex-col items-center gap-1 rounded-lg py-2.5 text-[10px] font-normal tracking-[0.02em] transition-colors hover:bg-[#21262d] hover:text-[#e6edf3] ${
        active ? 'text-ink' : 'text-[#8b949e]'
      }`}
    >
      {icon}
      {label}
      <span className={`mt-[-2px] h-[3px] w-[3px] rounded-full bg-selected ${active ? 'opacity-100' : 'opacity-0'}`} />
    </Link>
  );
}
