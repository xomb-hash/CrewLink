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
    <header className="border-b border-[#30363d] bg-[#161b22] py-3 sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-lg text-white hover:opacity-90 transition">
            <Users className="w-6 h-6 text-emerald-500" />
            <span>Crewlink</span>
          </Link>

          <Link
            href="/explore"
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-gray-300 hover:text-white transition"
          >
            <Compass className="w-4 h-4 text-emerald-400" />
            <span>Explore</span>
          </Link>
        </div>

        <nav className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/explore"
            className="sm:hidden p-1.5 text-gray-300 hover:text-white"
            title="Explore projects"
          >
            <Compass className="w-5 h-5 text-emerald-400" />
          </Link>

          {user ? (
            <>
              <Link
                href="/applications"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[#21262d] text-gray-200 border border-[#30363d] hover:bg-[#30363d] transition"
                title="My Applications"
              >
                <Send className="w-3.5 h-3.5 text-blue-400" />
                <span className="hidden md:inline">Applications</span>
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[#21262d] text-gray-200 border border-[#30363d] hover:bg-[#30363d] transition"
              >
                <LayoutDashboard className="w-3.5 h-3.5" />
                <span>Dashboard</span>
              </Link>
              <Link
                href="/projects/new"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-500 transition shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden md:inline">New Project</span>
              </Link>
              <div className="flex items-center gap-2 pl-2 border-l border-[#30363d]">
                <img
                  src={user.avatarUrl || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'}
                  alt={user.login}
                  className="w-7 h-7 rounded-full border border-[#30363d]"
                />
                <span className="text-xs font-medium text-gray-300 hidden sm:inline">@{user.login}</span>
              </div>
              <a
                href="/auth/logout"
                className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-[#21262d] transition"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </a>
            </>
          ) : (
            <a
              href="/auth/github"
              className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-500 transition shadow-sm"
            >
              Sign in with GitHub
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
