'use client';

import React from 'react';
import Link from 'next/link';
import { Plus, Search } from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import type { ShellUser } from './AppShell';

interface TopbarProps {
  user: ShellUser | null;
  onCreate: () => void;
}

export function Topbar({ user, onCreate }: TopbarProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-[100] flex h-14 items-center gap-4 border-b border-line bg-black/90 px-6 backdrop-blur-xl">
      <Link href="/" className="flex min-w-[120px] flex-none items-center gap-2 text-[15px] font-normal tracking-[0.1em] text-ink">
        <span className="grid h-[22px] w-[22px] place-items-center rounded-[5px] border border-ink">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-[11px] w-[11px]">
            <path d="M2 6h4M8 3l3 3-3 3" />
          </svg>
        </span>
        <span className="hidden sm:inline">crewlink</span>
      </Link>

      <form action="/" method="get" role="search" className="hidden max-w-[480px] flex-1 sm:block">
        <div className="flex items-center rounded-md border border-line-soft transition-colors focus-within:border-ink">
          <input
            type="search"
            name="q"
            placeholder="Search your projects…"
            aria-label="Search projects"
            className="h-9 flex-1 border-0 bg-transparent px-3.5 text-[13px] text-ink outline-none"
          />
          <button
            type="submit"
            aria-label="Search"
            className="grid h-9 w-11 place-items-center border-l border-line text-ink-dim transition-colors hover:text-ink"
          >
            <Search className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </form>

      <div className="ml-auto flex flex-none items-center gap-2.5">
        <button
          type="button"
          onClick={onCreate}
          aria-label="Create project"
          className="flex h-[34px] items-center gap-1.5 rounded-md border border-ink px-3 text-[13px] font-normal text-ink transition-colors hover:bg-ink hover:text-black"
        >
          <Plus className="h-[13px] w-[13px]" strokeWidth={1.5} />
          Create
        </button>

        {user ? (
          <>
            <NotificationBell />
            <Link
              href="/dashboard"
              title={`@${user.login}`}
              className="grid h-[30px] w-[30px] place-items-center overflow-hidden rounded-full border border-[#333] text-[12px] text-[#aaa]"
            >
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatarUrl} alt={user.login} className="h-full w-full object-cover" />
              ) : (
                user.login.charAt(0).toUpperCase()
              )}
            </Link>
          </>
        ) : (
          <a
            href="/auth/github?redirect_to=%2Fdashboard"
            className="flex h-[34px] items-center rounded-md border border-ink px-3.5 text-[13px] text-ink transition-colors hover:bg-ink hover:text-black"
          >
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}
