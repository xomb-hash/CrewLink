// Every call from the page to the backend is here. If a backend route changes, change it here only.
async function call(path, { method = "GET", body } = {}) {
  try {
    const r = await fetch(path, { method, headers: method === "GET" ? undefined : { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body || {}) });
    let data = {}; try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };
  } catch { return { ok: false, status: 0, data: { error: "Can't reach the server. Is it running?" } }; }
}
export const getMe = async () => (await call("/api/me")).data.user || null;
export const listProjects = () => call("/api/projects");
export const createProject = (body) => call("/api/projects", { method: "POST", body });
export const decide = (projectId, login, action) => call(`/api/projects/${encodeURIComponent(projectId)}/applicants/${encodeURIComponent(login)}/${action}`, { method: "POST" });
export const logout = () => call("/auth/logout", { method: "POST" });
