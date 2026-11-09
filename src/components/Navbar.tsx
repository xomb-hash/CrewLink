'use client';

import React from 'react';
import Link from 'next/link';
import { Users, LogOut, Plus, LayoutDashboard } from 'lucide-react';
import type { User } from '../types/index';

interface NavbarProps {
  user: User | null;
}

export function Navbar({ user }: NavbarProps) {
  return (
    <header className="border-b border-[#30363d] bg-[#161b22] py-3 sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 font-bold text-lg text-white hover:opacity-90 transition">
          <Users className="w-6 h-6 text-emerald-500" />
          <span>Crewlink</span>
        </Link>

        <nav className="flex items-center gap-3">
          {user ? (
            <>
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
                <span>New Project</span>
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
              className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-500 transition"
            >
              Sign in with GitHub
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
