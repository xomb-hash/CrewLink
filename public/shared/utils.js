export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const codeUrl = (p) => `https://github.com/${encodeURIComponent(p.ownerName)}/${encodeURIComponent(p.repoName)}`;
export const age = (d) => { const y = (Date.now() - new Date(d)) / 31557600000; return y < 1 ? "under 1 yr" : Math.floor(y) + " yr"; };
