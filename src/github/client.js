// One function that talks to GitHub. Every other GitHub file uses this.
const config = require("../config");
async function gh(p, { method = "GET", token, body, base, accept } = {}) {
  try {
    const r = await fetch((base || config.githubApi()) + p, {
      method, signal: AbortSignal.timeout(8000), body: body ? JSON.stringify(body) : undefined,
      headers: { Accept: accept || "application/vnd.github+json", "User-Agent": "crewlink-prototype", "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    });
    let data = null; try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };       // status 0 means GitHub could not be reached
  } catch { return { ok: false, status: 0, data: null }; }
}
module.exports = { gh };
