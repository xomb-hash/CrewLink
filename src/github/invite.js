// Sends the GitHub collaborator invitation. Returns { ok: true } or { ok: false, error: "message for the owner" }.
const { gh } = require("./client"), { installationToken } = require("./app-auth");
async function inviteCollaborator(owner, repo, login) {
  const t = await installationToken(owner, repo);
  if (t.error) return { ok: false, error: t.error };
  const r = await gh(`/repos/${owner}/${repo}/collaborators/${login}`, { method: "PUT", token: t.token, body: { permission: "pull" } });
  if (r.ok) return { ok: true };
  if (r.status === 404) return { ok: false, error: `GitHub couldn't find the user ${login}.` };
  if (r.status === 403) return { ok: false, error: "GitHub refused. Check the app has Administration: Read and write permission." };
  return { ok: false, error: "GitHub couldn't send the invitation. Try again." };
}
module.exports = { inviteCollaborator };
