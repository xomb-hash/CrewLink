// visibilityIcon(true) gives a lock for a private repo; visibilityIcon(false) gives a globe for a public one.
// A project that doesn't say is treated as private, which is the safe choice.
const LOCK = '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 016 0v2"/>';
const GLOBE = '<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/>';
export function visibilityIcon(isPrivate) {
  const pub = isPrivate === false;
  const label = pub ? "Public repository. Click the name to open the code." : "Private repository. Only people with access on GitHub can see the code.";
  return `<span class="vis${pub ? " pub" : ""}" role="img" aria-label="${label}" title="${label}"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${pub ? GLOBE : LOCK}</svg></span>`;
}
