'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Plus, Bell, LogOut } from 'lucide-react';
import type { User } from '../types/index';

interface NavbarProps {
  user: User | null;
}

export function Navbar({ user }: NavbarProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/explore?q=${encodeURIComponent(searchQuery.trim())}`);
    } else {
      router.push('/explore');
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 h-[56px] z-50 bg-[#141210]/95 backdrop-blur-md border-b border-[#38322c] px-4 md:px-6 flex items-center justify-between gap-4">
      {/* Left: YouTube-style Crewlink Logo */}
      <div className="flex items-center gap-3 min-w-[130px] flex-none">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold text-base text-[#faf6f0] tracking-tight hover:opacity-90 transition"
        >
          <div className="w-[26px] h-[19px] rounded-[5px] bg-amber-500 flex items-center justify-center shadow-sm">
            <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 fill-stone-950 translate-x-[0.5px]">
              <path d="M2.5 1.5l7 4.5-7 4.5z" />
            </svg>
          </div>
          <span className="font-bold tracking-tight text-base text-[#faf6f0]">crewlink</span>
        </Link>
      </div>

      {/* Center: YouTube-style Search Box */}
      <form onSubmit={handleSearch} className="flex-1 max-w-[480px] hidden sm:block">
        <div className="flex items-center border border-[#38322c] rounded-full overflow-hidden bg-[#1f1c19] focus-within:border-amber-500 transition-colors shadow-inner">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search projects, technologies, roles..."
            className="flex-1 bg-transparent px-4 py-1.5 text-xs text-[#faf6f0] outline-none placeholder:text-[#a89f91]"
          />
          <button
            type="submit"
            aria-label="Search"
            className="px-4 py-2 bg-[#2a2622] text-[#a89f91] hover:text-[#faf6f0] border-l border-[#38322c] transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>

      {/* Right Actions */}
      <div className="flex items-center gap-2.5 flex-none ml-auto">
        {user ? (
          <>
            {/* Create Button (YouTube style) */}
            <Link
              href="/projects/new"
              className="inline-flex items-center gap-1.5 border border-[#38322c] rounded-full px-3.5 py-1.5 text-xs font-medium text-[#faf6f0] bg-[#1f1c19] hover:bg-[#2a2622] hover:border-amber-500/50 transition shadow-sm"
              title="Connect a repository"
            >
              <Plus className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Create</span>
            </Link>

            {/* Notifications Bell */}
            <Link
              href="/applications"
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#a89f91] hover:text-[#faf6f0] hover:bg-[#2a2622] transition relative"
              title="My Applications"
            >
              <Bell className="w-4 h-4" />
              <span className="absolute 1.5 top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500" />
            </Link>

            {/* User Avatar */}
            <Link
              href="/dashboard"
              className="flex items-center gap-2 pl-1 group"
              title={`Logged in as @${user.login}`}
            >
              <img
                src={user.avatarUrl || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'}
                alt={user.login}
                className="w-7 h-7 rounded-full border border-[#38322c] group-hover:border-amber-500 transition"
              />
              <span className="text-xs text-[#d6cec3] group-hover:text-[#faf6f0] hidden lg:inline max-w-[90px] truncate">
                @{user.login}
              </span>
            </Link>

            {/* Sign Out */}
            <a
              href="/auth/logout"
              className="p-1.5 text-[#a89f91] hover:text-[#faf6f0] rounded hover:bg-[#2a2622] transition"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </a>
          </>
        ) : (
          <a
            href="/auth/github"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full bg-amber-500 text-stone-950 hover:bg-amber-400 transition shadow"
          >
            <span>Sign in with GitHub</span>
          </a>
        )}
      </div>
    </header>
  );
}
