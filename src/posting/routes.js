const crypto = require("crypto"), config = require("../config"), db = require("../lib/db");
const { send, readBody } = require("../lib/http"), { me } = require("../auth/sessions"), { byId } = require("../platforms/registry");
const { draftPost, draftPersonalPost } = require("./drafts"), { checkDraft } = require("./checks");

const findProject = (data, id, login) => data.projects.find((project) => project.id === id && project.createdBy === login);
const withJoinUrl = (req, project, data) => ({ ...project, joinUrl: config.baseUrl(req) + "/join/" + project.token, approvedDrafts: data.drafts.filter((draft) => draft.projectId === project.id && draft.status === "approved") });
const owner = (req, res, projectId) => {
  const session = me(req); if (!session) { send(res, 401, { error: "Sign in with GitHub first." }); return null; }
  const data = db.load(), project = findProject(data, projectId, session.login);
  if (!project) { send(res, 403, { error: "Only the project owner can manage drafts." }); return null; }
  return { data, project, session };
};
const view = (req, project, data, draft) => {
  const context = withJoinUrl(req, project, data);
  context.approvedDrafts = context.approvedDrafts.filter((approved) => approved.id !== draft.id);
  return { ...draft, checks: checkDraft(context, draft.platformId, draft.text) };
};

async function createDrafts(req, res, projectId) {
  const found = owner(req, res, projectId); if (!found) return;
  let body; try { body = await readBody(req); } catch (error) { return send(res, 400, { error: error.message }); }
  const requested = (Array.isArray(body.platforms) ? body.platforms : found.project.draftPlatforms || []).filter((id, index, ids) => byId(id) && ids.indexOf(id) === index);
  if (!requested.length) return send(res, 400, { error: "Choose at least one draft platform." });
  const project = withJoinUrl(req, found.project, found.data), made = [];
  for (const platformId of requested) {
    let draft = found.data.drafts.find((item) => item.projectId === projectId && item.platformId === platformId && item.status !== "skipped");
    if (!draft) { draft = { id: crypto.randomUUID(), projectId, platformId, text: draftPost(project, platformId), status: "drafted", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; found.data.drafts.push(draft); }
    made.push(view(req, found.project, found.data, draft));
  }
  db.save(found.data); send(res, 201, { drafts: made });
}
function listDrafts(req, res, projectId) {
  const found = owner(req, res, projectId); if (!found) return;
  send(res, 200, { drafts: found.data.drafts.filter((draft) => draft.projectId === projectId).map((draft) => view(req, found.project, found.data, draft)) });
}
async function editDraft(req, res, draftId) {
  const session = me(req); if (!session) return send(res, 401, { error: "Sign in with GitHub first." });
  const data = db.load(), draft = data.drafts.find((item) => item.id === draftId), project = draft && findProject(data, draft.projectId, session.login);
  if (!draft || !project) return send(res, 403, { error: "Only the project owner can edit this draft." });
  let body; try { body = await readBody(req); } catch (error) { return send(res, 400, { error: error.message }); }
  draft.text = String(body.text || "").slice(0, 10000); draft.status = "edited"; draft.updatedAt = new Date().toISOString();
  delete draft.approvedText; delete draft.approvedHash; delete draft.approvedAt; delete draft.approvedBy;
  db.save(data); send(res, 200, { draft: view(req, project, data, draft) });
}
function approveDraft(req, res, draftId) {
  const session = me(req); if (!session) return send(res, 401, { error: "Sign in with GitHub first." });
  const data = db.load(), draft = data.drafts.find((item) => item.id === draftId), project = draft && findProject(data, draft.projectId, session.login);
  if (!draft || !project) return send(res, 403, { error: "Only the project owner can approve this draft." });
  const checks = checkDraft(withJoinUrl(req, project, data), draft.platformId, draft.text);
  if (checks.some((check) => check.level === "error")) return send(res, 400, { error: "Fix errors before approving.", checks });
  draft.status = "approved"; draft.approvedText = draft.text; draft.approvedHash = crypto.createHash("sha256").update(draft.text).digest("hex"); draft.approvedAt = new Date().toISOString(); draft.approvedBy = session.login; draft.updatedAt = draft.approvedAt;
  db.save(data); send(res, 200, { draft: view(req, project, data, draft) });
}
function skipDraft(req, res, draftId) {
  const session = me(req); if (!session) return send(res, 401, { error: "Sign in with GitHub first." });
  const data = db.load(), draft = data.drafts.find((item) => item.id === draftId), project = draft && findProject(data, draft.projectId, session.login);
  if (!draft || !project) return send(res, 403, { error: "Only the project owner can skip this draft." });
  draft.status = "skipped"; draft.updatedAt = new Date().toISOString(); db.save(data); send(res, 200, { draft: view(req, project, data, draft) });
}
async function personalPost(req, res, projectId) {
  const found = owner(req, res, projectId); if (!found) return;
  let body; try { body = await readBody(req); } catch (error) { return send(res, 400, { error: error.message }); }
  const requestedRoles = Array.isArray(body.roles) ? body.roles.map((role) => String(role || "").trim()).filter(Boolean).slice(0, 5).map((role) => role.slice(0, 30)) : found.project.roles;
  const project = { ...withJoinUrl(req, found.project, found.data), roles: requestedRoles }, text = draftPersonalPost(project, body);
  send(res, 200, { text, checks: checkDraft(project, "personal", text) });
}
module.exports = { createDrafts, listDrafts, editDraft, approveDraft, skipDraft, personalPost };
