// Create a project (POST /api/projects) and list the signed-in owner's projects (GET /api/projects).
const crypto = require("crypto"), config = require("../config"), db = require("../lib/db"), { gh } = require("../github/client");
const { send, readBody } = require("../lib/http"), { OWNER, REPO } = require("../lib/validate"), { me } = require("../auth/sessions"), { shareLinks } = require("./share");
const PLATFORMS = ["linkedin", "x", "whatsapp"];
const DRAFT_PLATFORMS = ["discord", "telegram", "bluesky", "mastodon", "linkedin", "whatsapp"];

async function create(req, res) {
  const s = me(req); if (!s) return send(res, 401, { error: "Sign in with GitHub first." });
  let b; try { b = await readBody(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const errors = {}, ownerName = String(b.ownerName || "").trim(), repoName = String(b.repoName || "").trim().replace(/\.git$/, "");
  if (!OWNER.test(ownerName)) errors.ownerName = "Enter the GitHub username or organisation that owns the repo.";
  if (!REPO.test(repoName)) errors.repoName = "Use letters, numbers, dots, dashes and underscores only.";
  const mode = b.mode === "screening" || b.mode === "referral" ? b.mode : null;
  if (!mode) errors.mode = "Choose a referral link or screening.";
  let screeningUrl = "";
  if (mode === "screening") { try { const x = new URL(String(b.screeningUrl || "")); if (!/^https?:$/.test(x.protocol)) throw 0; screeningUrl = x.href; } catch { errors.screeningUrl = "Add a valid link that starts with https://"; } }
  const roles = (Array.isArray(b.roles) ? b.roles : []).map((role) => String(role || "").trim()).filter(Boolean);
  if (roles.length > 5) errors.roles = "Add up to five roles.";
  if (roles.some((role) => role.length > 30)) errors.roles = "Each role can be up to 30 characters.";
  if (Object.keys(errors).length) return send(res, 400, { errors });

  // Only people with admin access to the repo may list it (they are the ones who can add collaborators).
  const r = await gh(`/repos/${ownerName}/${repoName}`, { token: s.token });
  if (r.status === 0) return send(res, 502, { error: "Couldn't reach GitHub. Try again." });
  if (!r.ok) return send(res, 400, { errors: { repoName: `We can't see ${ownerName}/${repoName}. Check the spelling, and make sure the Crewlink GitHub App is installed on that repository.` } });
  if (!(r.data.permissions && r.data.permissions.admin)) return send(res, 400, { errors: { repoName: "You need admin access to this repository to add collaborators." } });

  const project = {
    id: crypto.randomUUID(), token: crypto.randomBytes(9).toString("base64url"), createdBy: s.login,
    ownerName: (r.data.owner && r.data.owner.login) || ownerName, repoName: r.data.name || repoName, ownerType: (r.data.owner && r.data.owner.type) || "User", isPrivate: r.data.private !== false,
    mode, screeningUrl, verified: true, description: String(b.description || "").trim().slice(0, 280), screeningNote: String(b.screeningNote || "").trim().slice(0, 280),
    roles, share: (Array.isArray(b.share) ? b.share : []).filter((x) => PLATFORMS.includes(x)),
    draftPlatforms: (Array.isArray(b.draftPlatforms) ? b.draftPlatforms : []).filter((x, i, all) => DRAFT_PLATFORMS.includes(x) && all.indexOf(x) === i), createdAt: new Date().toISOString(),
  };
  const d = db.load(); d.projects.push(project); db.save(d);
  const joinUrl = config.baseUrl(req) + "/join/" + project.token;
  send(res, 201, { project, joinUrl, shareLinks: shareLinks(joinUrl, project) });
}
function list(req, res) {
  const s = me(req); if (!s) return send(res, 401, { error: "Sign in with GitHub first." });
  const d = db.load();
  send(res, 200, { projects: d.projects.filter((p) => p.createdBy === s.login).reverse().map((p) => ({ ...p, joinUrl: config.baseUrl(req) + "/join/" + p.token, applicants: d.applicants.filter((a) => a.projectId === p.id) })) });
}
async function repositoryStatus(req, res, ownerName, repoName) {
  const s = me(req); if (!s) return send(res, 401, { error: "Sign in with GitHub first." });
  if (!OWNER.test(ownerName) || !REPO.test(repoName)) return send(res, 400, { error: "Enter a GitHub owner and repository name." });
  const r = await gh(`/repos/${ownerName}/${repoName}`, { token: s.token });
  if (r.status === 0) return send(res, 502, { error: "Couldn't reach GitHub. Try again." });
  if (!r.ok) return send(res, 404, { found: false, error: "Repository not found, private to another account, or unavailable to your GitHub login." });
  send(res, 200, { found: true, private: r.data.private === true, name: r.data.full_name || `${ownerName}/${repoName}`, admin: !!(r.data.permissions && r.data.permissions.admin) });
}
module.exports = { create, list, repositoryStatus };
