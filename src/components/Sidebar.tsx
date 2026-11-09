'use client';

import React from 'react';
import Link from 'next/link';
import { Home, LayoutGrid, Compass, Send, LogOut, LogIn } from 'lucide-react';
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
      className="fixed left-0 top-14 bottom-0 z-[90] hidden w-[68px] flex-col items-center gap-0.5 border-r border-line bg-black py-4 md:flex"
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
        label="Apps"
        active={isActive('/applications')}
        icon={<Send className="h-[18px] w-[18px]" strokeWidth={1.4} />}
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
          className="flex w-[52px] flex-col items-center gap-1 rounded-lg py-2.5 text-[10px] font-light tracking-[0.05em] text-[#9c9c9c] transition-colors hover:bg-[#1c1c1c] hover:text-[#dedede]"
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.4} />
          Sign out
          <span className="mt-[-2px] h-[3px] w-[3px] rounded-full bg-ink opacity-0" />
        </a>
      ) : (
        <a
          href="/auth/github?redirect_to=%2Fdashboard"
          className="flex w-[52px] flex-col items-center gap-1 rounded-lg py-2.5 text-[10px] font-light tracking-[0.05em] text-[#9c9c9c] transition-colors hover:bg-[#1c1c1c] hover:text-[#dedede]"
        >
          <LogIn className="h-[18px] w-[18px]" strokeWidth={1.4} />
          Sign in
          <span className="mt-[-2px] h-[3px] w-[3px] rounded-full bg-ink opacity-0" />
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
      className={`flex w-[52px] flex-col items-center gap-1 rounded-lg py-2.5 text-[10px] font-light tracking-[0.05em] transition-colors hover:bg-[#1c1c1c] hover:text-[#dedede] ${
        active ? 'text-ink' : 'text-[#9c9c9c]'
      }`}
    >
      {icon}
      {label}
      <span className={`mt-[-2px] h-[3px] w-[3px] rounded-full bg-ink ${active ? 'opacity-100' : 'opacity-0'}`} />
    </Link>
  );
}
