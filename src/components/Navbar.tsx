'use client';

import React from 'react';
import Link from 'next/link';
import { Users, LogOut, Plus, LayoutDashboard, Compass, Send } from 'lucide-react';
import type { User } from '../types/index';

interface NavbarProps {
  user: User | null;
}

export function Navbar({ user }: NavbarProps) {
  return (
    <header className="border-b border-[#38322c] bg-[#1f1c19] py-3 sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-lg text-[#faf6f0] hover:opacity-90 transition">
            <Users className="w-6 h-6 text-amber-500" />
            <span className="tracking-tight">Crewlink</span>
          </Link>

          <Link
            href="/explore"
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-[#d6cec3] hover:text-[#faf6f0] transition"
          >
            <Compass className="w-4 h-4 text-amber-400" />
            <span>Explore</span>
          </Link>
        </div>

        <nav className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/explore"
            className="sm:hidden p-1.5 text-[#d6cec3] hover:text-[#faf6f0]"
            title="Explore projects"
          >
            <Compass className="w-5 h-5 text-amber-400" />
          </Link>

          {user ? (
            <>
              <Link
                href="/applications"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[#2a2622] text-[#e8e2d9] border border-[#38322c] hover:bg-[#38322c] transition"
                title="My Applications"
              >
                <Send className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden md:inline">Applications</span>
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[#2a2622] text-[#e8e2d9] border border-[#38322c] hover:bg-[#38322c] transition"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>Dashboard</span>
              </Link>
              <Link
                href="/projects/new"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-amber-600 text-white hover:bg-amber-500 transition shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden md:inline">New Project</span>
              </Link>
              <div className="flex items-center gap-2 pl-2 border-l border-[#38322c]">
                <img
                  src={user.avatarUrl || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'}
                  alt={user.login}
                  className="w-7 h-7 rounded-full border border-[#38322c]"
                />
                <span className="text-xs font-medium text-[#d6cec3] hidden sm:inline">@{user.login}</span>
              </div>
              <a
                href="/auth/logout"
                className="p-1.5 text-[#a89f91] hover:text-[#faf6f0] rounded hover:bg-[#2a2622] transition"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </a>
            </>
          ) : (
            <a
              href="/auth/github"
              className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-medium rounded-md bg-amber-600 text-white hover:bg-amber-500 transition shadow-sm"
            >
              Sign in with GitHub
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
