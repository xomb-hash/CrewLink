import React from 'react';
import { Lock, Globe } from 'lucide-react';

interface VisibilityBadgeProps {
  isPrivate: boolean;
  showText?: boolean;
}

export function VisibilityBadge({ isPrivate, showText = true }: VisibilityBadgeProps) {
  const Icon = isPrivate ? Lock : Globe;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[#3f3f3f] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.06em] text-[#c2c2c2]"
      title={isPrivate ? 'Private repository' : 'Public repository'}
    >
      <Icon className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
      {showText && <span>{isPrivate ? 'Private' : 'Public'}</span>}
    </span>
  );
}
