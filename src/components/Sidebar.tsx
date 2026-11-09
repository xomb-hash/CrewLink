'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Compass, Send, LayoutDashboard, User } from 'lucide-react';

interface SidebarProps {
  user?: { login: string } | null;
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();

  const navItems = [
    {
      label: 'Home',
      href: '/',
      icon: Home,
      isActive: pathname === '/',
    },
    {
      label: 'Explore',
      href: '/explore',
      icon: Compass,
      isActive: pathname === '/explore' || pathname.startsWith('/explore/'),
    },
    {
      label: 'Apps',
      href: user ? '/applications' : '/auth/github',
      icon: Send,
      isActive: pathname === '/applications',
    },
    {
      label: 'You',
      href: user ? '/dashboard' : '/auth/github',
      icon: user ? LayoutDashboard : User,
      isActive: pathname === '/dashboard' || pathname.startsWith('/projects/'),
    },
  ];

  return (
    <>
      {/* Desktop YouTube-style Left Sidebar (68px wide) */}
      <nav
        aria-label="Main Sidebar"
        className="hidden md:flex fixed top-[56px] left-0 bottom-0 w-[68px] bg-[#141210] border-r border-[#38322c] flex-col items-center py-3 gap-1 z-40"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`w-[56px] flex flex-col items-center justify-center gap-1 py-2.5 rounded-lg text-[10px] tracking-wide transition-all ${
                item.isActive
                  ? 'text-[#faf6f0] font-semibold bg-[#1f1c19]'
                  : 'text-[#a89f91] hover:text-[#faf6f0] hover:bg-[#1f1c19]/60'
              }`}
            >
              <Icon className={`w-5 h-5 ${item.isActive ? 'text-amber-400' : 'text-[#a89f91]'}`} />
              <span>{item.label}</span>
              {/* YouTube Active Indicator Dot */}
              <div
                className={`w-1 h-1 rounded-full bg-amber-400 -mt-0.5 transition-opacity ${
                  item.isActive ? 'opacity-100' : 'opacity-0'
                }`}
              />
            </Link>
          );
        })}
      </nav>

      {/* Mobile YouTube-style Bottom Navigation Bar */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 h-14 bg-[#1f1c19] border-t border-[#38322c] z-50 flex items-center justify-around px-2"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1 rounded text-[10px] transition-colors ${
                item.isActive
                  ? 'text-amber-400 font-semibold'
                  : 'text-[#a89f91] hover:text-[#faf6f0]'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
