'use client';

import React from 'react';
import { Lock, Globe } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface VisibilityBadgeProps {
  isPrivate: boolean;
  showText?: boolean;
}

export function VisibilityBadge({ isPrivate, showText = true }: VisibilityBadgeProps) {
  if (isPrivate) {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 px-2 py-0.5 text-xs font-medium bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
        title="Private repository"
      >
        <Lock className="w-3.5 h-3.5" />
        {showText && <span>Private</span>}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="gap-1.5 px-2 py-0.5 text-xs font-medium bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/20"
      title="Public repository"
    >
      <Globe className="w-3.5 h-3.5" />
      {showText && <span>Public</span>}
    </Badge>
  );
}
