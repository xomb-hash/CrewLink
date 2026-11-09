// Someone requests to join (POST /api/join/:token) and the owner approves or rejects them.
const db = require("../lib/db"), { send } = require("../lib/http"), { me } = require("../auth/sessions"), { inviteCollaborator } = require("../github/invite");

function apply(req, res, token) {
  const s = me(req); if (!s) return send(res, 401, { error: "Sign in with GitHub first." });
  const d = db.load(), p = d.projects.find((x) => x.token === token);
  if (!p) return send(res, 404, { error: "This link doesn't exist." });
  if (d.applicants.some((a) => a.projectId === p.id && a.login.toLowerCase() === s.login.toLowerCase())) return send(res, 200, { message: "You already requested to join this project." });
  d.applicants.push({ projectId: p.id, login: s.login, avatar: s.avatar, accountCreated: s.createdAt, publicRepos: s.publicRepos, status: p.mode === "screening" ? "screening" : "applied", at: new Date().toISOString() });
  db.save(d); send(res, 201, { message: "Request sent. The owner will review it." });
}
async function decide(req, res, id, login, action) {
  const s = me(req); if (!s) return send(res, 401, { error: "Sign in with GitHub first." });
  const d = db.load(), p = d.projects.find((x) => x.id === id);
  if (!p) return send(res, 404, { error: "Project not found." });
  if (p.createdBy !== s.login) return send(res, 403, { error: "Only the project owner can do this." });
  const a = d.applicants.find((x) => x.projectId === id && x.login.toLowerCase() === login.toLowerCase());
  if (!a) return send(res, 404, { error: "Applicant not found." });
  if (action === "reject") { a.status = "rejected"; db.save(d); return send(res, 200, { status: "rejected", message: "Rejected." }); }
  const r = await inviteCollaborator(p.ownerName, p.repoName, a.login);
  if (!r.ok) return send(res, 502, { error: r.error });          // nothing changes if GitHub says no
  a.status = "approved"; db.save(d);
  send(res, 200, { status: "approved", message: `Invitation sent to ${a.login}. They must accept it on GitHub.` });
}
module.exports = { apply, decide };
