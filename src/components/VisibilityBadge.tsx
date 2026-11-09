'use client';

import React from 'react';
import { Lock, Globe } from 'lucide-react';

interface VisibilityBadgeProps {
  isPrivate: boolean;
  showText?: boolean;
}

export function VisibilityBadge({ isPrivate, showText = true }: VisibilityBadgeProps) {
  if (isPrivate) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30"
        title="Private repository"
      >
        <Lock className="w-3.5 h-3.5" />
        {showText && <span>Private</span>}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30"
      title="Public repository"
    >
      <Globe className="w-3.5 h-3.5" />
      {showText && <span>Public</span>}
    </span>
  );
}
