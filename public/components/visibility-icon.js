// SVG Icons for repository visibility
// Globe = Public, Lock = Private
export const ICONS = {
  globe: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm6.5-5.5a13.3 13.3 0 0 1 2.2 5.5H5.8a13.3 13.3 0 0 1 2.2-5.5Zm-3.7.8A13.8 13.8 0 0 0 3 8h1.4a15 15 0 0 1 1.4-4.7ZM8 13.5a13.3 13.3 0 0 1-2.2-5.5h4.4a13.3 13.3 0 0 1-2.2 5.5Zm3.7-.8A13.8 13.8 0 0 0 13 8h-1.4a15 15 0 0 1-1.4 4.7ZM5.8 8h-1.4A15 15 0 0 1 3 8a13.8 13.8 0 0 0 1.3 4.7A15 15 0 0 1 5.8 8Zm4.4 0a15 15 0 0 1 1.4 4.7A13.8 13.8 0 0 0 13 8h-1.4a15 15 0 0 1-1.4-4.7A13.8 13.8 0 0 0 10.2 8Z"/>
  </svg>`,
  lock: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M4 4a4 4 0 0 1 8 0v2h.5A1.5 1.5 0 0 1 14 7.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-6A1.5 1.5 0 0 1 3.5 6H4V4Zm1.5 2h5V4a2.5 2.5 0 0 0-5 0v2ZM8 9a1 1 0 0 0-1 1v1.5a1 1 0 1 0 2 0V10a1 1 0 0 0-1-1Z"/>
  </svg>`
};

export function renderVisibilityIcon(isPrivate, options = {}) {
  const icon = isPrivate ? ICONS.lock : ICONS.globe;
  const label = isPrivate ? 'Private repository' : 'Public repository';
  const showText = options.showText || false;

  if (showText) {
    return `<span class="visibility-badge ${isPrivate ? 'private' : 'public'}" title="${label}">
      <span class="visibility-icon">${icon}</span>
      <span>${isPrivate ? 'Private' : 'Public'}</span>
    </span>`;
  }

  return `<span class="visibility-icon" title="${label}" aria-label="${label}">${icon}</span>`;
}
