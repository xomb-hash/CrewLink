// Rules for what counts as valid input, plus HTML escaping.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;   // GitHub username rules
const REPO = /^[A-Za-z0-9._-]{1,100}$/;                              // GitHub repo name rules
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeNext = (n) => (typeof n === "string" && /^\/[^/\\]/.test(n) ? n : "/");   // only allow redirects inside this site
module.exports = { OWNER, REPO, esc, safeNext };
