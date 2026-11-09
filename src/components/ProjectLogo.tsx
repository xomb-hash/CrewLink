import React from 'react';

const GRADIENTS: Array<[string, string]> = [
  ['#2f2f2f', '#050505'],
  ['#3d3d3d', '#0b0b0b'],
  ['#242424', '#000000'],
  ['#4a4a4a', '#101010'],
  ['#333333', '#080808'],
  ['#292929', '#030303'],
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
  const cleanTitle = title.trim() || 'Project';
  const baseClass = `relative flex-none overflow-hidden rounded-lg border border-line-soft ${className}`;

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt={`${cleanTitle} logo`} className={`${baseClass} object-cover`} />
    );
  }

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
      aria-hidden="true"
      className={baseClass}
      style={{ backgroundImage: `linear-gradient(${angle}deg, ${from}, ${to})` }}
    >
      <span className="absolute -right-2 -top-3 h-8 w-8 rounded-full bg-white/[0.06]" />
      <span className="absolute -bottom-3 -left-1 h-7 w-7 rounded-full border border-white/[0.08]" />
      <span
        className={`relative grid h-full w-full place-items-center font-mono font-medium tracking-[0.04em] text-white/85 ${textClassName}`}
      >
        {initials || 'P'}
      </span>
    </div>
  );
}
