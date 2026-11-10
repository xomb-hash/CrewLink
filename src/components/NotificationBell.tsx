'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCircle2, Clock, UserPlus, XCircle } from 'lucide-react';

interface NotificationItem {
  id: string;
  kind: 'join_request' | 'application_status';
  title: string;
  detail?: string;
  href: string;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : `${Math.floor(days / 7)}w ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load notifications');
      const data = await res.json();
      setItems(Array.isArray(data.notifications) ? data.notifications : []);
      setPendingCount(Number(data.pendingCount) || 0);
    } catch {
      setError('Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      if (next) load();
      return next;
    });
  };

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative grid h-9 w-9 place-items-center rounded-full text-[#c9d1d9] transition-colors hover:bg-[#21262d] hover:text-ink"
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.4} />
        {pendingCount > 0 && (
          <span className="absolute right-1 top-1 grid min-w-[15px] place-items-center rounded-full bg-[#1f6feb] px-1 text-[9px] font-semibold leading-[15px] text-white">
            {pendingCount > 9 ? '9+' : pendingCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-[120] w-[320px] overflow-hidden rounded-xl border border-line bg-panel shadow-[0_16px_48px_rgba(0,0,0,0.7)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-[12px] text-ink">Notifications</span>
            {pendingCount > 0 && (
              <span className="text-[10px] uppercase tracking-[0.08em] text-[#8b949e]">
                {pendingCount} pending
              </span>
            )}
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {loading ? (
              <div className="px-4 py-6 text-center text-[12px] text-[#8b949e]">Loading…</div>
            ) : error ? (
              <div className="px-4 py-6 text-center text-[12px] text-[#f85149]">{error}</div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12px] text-[#8b949e]">
                No new activity. Join requests and decisions will appear here.
              </div>
            ) : (
              items.map((item) => {
                const Icon =
                  item.kind === 'join_request'
                    ? UserPlus
                    : item.title.startsWith('You were approved')
                    ? CheckCircle2
                    : item.title.startsWith('Your request')
                    ? XCircle
                    : Clock;
                const iconClass =
                  item.kind === 'join_request'
                    ? 'text-ink'
                    : item.title.startsWith('You were approved')
                    ? 'text-ink'
                    : item.title.startsWith('Your request')
                    ? 'text-[#f85149]'
                    : 'text-[#c9d1d9]';
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3 border-b border-[#30363d] px-4 py-3 transition-colors last:border-0 hover:bg-[#21262d]"
                  >
                    <Icon className={`mt-0.5 h-4 w-4 flex-none ${iconClass}`} strokeWidth={1.6} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] leading-snug text-[#f0f6fc]">{item.title}</p>
                      {item.detail && <p className="mt-0.5 text-[11px] text-[#8b949e]">{item.detail}</p>}
                    </div>
                    <span className="flex-none text-[10px] text-[#6e7681]">{timeAgo(item.createdAt)}</span>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
