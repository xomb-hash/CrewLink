'use client';

import React, { useEffect, useRef, useState } from 'react';

const GRADIENTS: Array<[string, string]> = [
  ['#1f6feb', '#0d1117'],
  ['#238636', '#0d1117'],
  ['#8957e5', '#0d1117'],
  ['#d29922', '#0d1117'],
  ['#1f6feb', '#010409'],
  ['#3fb950', '#010409'],
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash;
}

interface ProjectLogoProps {
  title: string;
  logoUrl?: string | null;
  className?: string;
  textClassName?: string;
}

export function ProjectLogo({ title, logoUrl, className = 'h-10 w-10', textClassName = 'text-[15px]' }: ProjectLogoProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const cleanTitle = title.trim() || 'Project';
  const baseClass = `relative flex-none overflow-hidden rounded-lg border border-line-soft ${className}`;

  useEffect(() => {
    setFailed(false);
    setLoaded(false);
    const img = imgRef.current;
    if (img && img.complete) {
      if (img.naturalWidth > 0) setLoaded(true);
      else setFailed(true);
    }
  }, [logoUrl]);

  const [from, to] = GRADIENTS[hashName(cleanTitle.toLowerCase()) % GRADIENTS.length];
  const angle = 120 + (hashName(cleanTitle) % 90);
  const initials = cleanTitle
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <div
      className={baseClass}
      style={{ backgroundImage: `linear-gradient(${angle}deg, ${from}, ${to})` }}
    >
      <span aria-hidden="true" className="absolute -right-2 -top-3 h-8 w-8 rounded-full bg-white/[0.06]" />
      <span aria-hidden="true" className="absolute -bottom-3 -left-1 h-7 w-7 rounded-full border border-white/[0.08]" />
      <span
        aria-hidden="true"
        className={`relative grid h-full w-full place-items-center font-mono font-medium tracking-[0.04em] text-white/85 ${textClassName}`}
      >
        {initials || 'P'}
      </span>
      {logoUrl && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={logoUrl}
          alt={`${cleanTitle} logo`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  );
}
