// Run with: node --test   (uses a fake GitHub, so no real account or keys are needed)
const test = require("node:test"), assert = require("node:assert"), http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const calls = [];
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const auth = (req.headers.authorization || "").replace("Bearer ", ""), u = req.url, j = (c, o) => { res.writeHead(c, { "Content-Type": "application/json" }); res.end(o === undefined ? "" : JSON.stringify(o)); };
    if (u === "/login/oauth/access_token") return j(200, { access_token: "tok-" + JSON.parse(b).code });
    if (u === "/user") return j(200, { login: auth.replace("tok-", ""), avatar_url: "", created_at: "2020-01-01T00:00:00Z", public_repos: 5 });
    if (u === "/repos/alice/proj") return auth === "tok-alice" ? j(200, { permissions: { admin: true }, private: false, owner: { login: "alice", type: "User" }, name: "proj" }) : j(404, {});
    if (u === "/repos/alice/proj/installation") return j(200, { id: 7 });
    if (u === "/app/installations/7/access_tokens") return j(201, { token: "inst-tok" });
    if (u.startsWith("/repos/alice/proj/collaborators/")) { calls.push({ u, auth, body: JSON.parse(b || "{}") }); return u.endsWith("/carol") ? j(403, { message: "no" }) : j(201, {}); }
    j(404, {});
  });
});
let app, B, jt, pid;
const api = (p, cookie, body, method = "POST") => fetch(B + p, { method, headers: { "Content-Type": "application/json", cookie: cookie || "" }, body: method === "GET" ? undefined : JSON.stringify(body || {}) });
async function login(name) {
  const a = await fetch(B + "/auth/github", { redirect: "manual" });
  const state = new URL(a.headers.get("location")).searchParams.get("state"), oc = a.headers.get("set-cookie").match(/oauth_state=([^;]+)/)[1];
  const c = await fetch(`${B}/auth/github/callback?code=${name}&state=${state}`, { redirect: "manual", headers: { cookie: "oauth_state=" + oc } });
  return "sid=" + c.headers.get("set-cookie").match(/sid=([^;]+)/)[1];
}
test.before(async () => {
  await new Promise((r) => mock.listen(0, r));
  const m = "http://127.0.0.1:" + mock.address().port, dir = fs.mkdtempSync(path.join(os.tmpdir(), "cl-"));
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  fs.writeFileSync(path.join(dir, "k.pem"), privateKey);
  Object.assign(process.env, { GITHUB_API: m, GITHUB_WEB: m, GITHUB_APP_ID: "1", GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "sec", GITHUB_APP_PRIVATE_KEY_PATH: path.join(dir, "k.pem"), DATA_DIR: dir });
  app = await require("../src/app").start(0); B = "http://127.0.0.1:" + app.address().port; process.env.BASE_URL = B;
});
test.after(() => { for (const s of [app, mock]) { s.closeAllConnections && s.closeAllConnections(); s.close(); } });

test("create needs sign-in", async () => assert.equal((await api("/api/projects", "", { ownerName: "alice", repoName: "proj", mode: "referral" })).status, 401));
test("bad callback state is rejected", async () => assert.equal((await fetch(B + "/auth/github/callback?code=x&state=nope")).status, 400));
test("owner creates a project; repos they can't administer are refused", async () => {
  const alice = await login("alice");
  const found = await api("/api/repositories/alice/proj", alice, null, "GET"); assert.equal(found.status, 200); assert.equal((await found.json()).found, true);
  const missing = await api("/api/repositories/alice/missing", alice, null, "GET"); assert.equal(missing.status, 404);
  const bad = await api("/api/projects", alice, { ownerName: "other", repoName: "repo", mode: "referral" });
  assert.equal(bad.status, 400);
  const ok = await api("/api/projects", alice, { ownerName: "alice", repoName: "proj", mode: "referral", share: ["x"] });
  assert.equal(ok.status, 201); const d = await ok.json(); assert.equal(d.project.isPrivate, false); jt = d.joinUrl.split("/").pop(); pid = d.project.id;
});
test("draft routes enforce ownership, checks, approval, and edited status", async () => {
  const alice = await login("alice"), bob = await login("bob");
  assert.equal((await api(`/api/projects/${pid}/drafts`, bob, null, "GET")).status, 403);
  const made = await api(`/api/projects/${pid}/drafts`, alice, { platforms: ["discord"] }); assert.equal(made.status, 201);
  const draft = (await made.json()).drafts[0]; assert.equal(draft.status, "drafted");
  assert.equal((await api(`/api/projects/${pid}/personal-post`, bob, { tone: "casual" })).status, 403);
  const personal = await api(`/api/projects/${pid}/personal-post`, alice, { tone: "casual" }); assert.equal(personal.status, 200); assert.match((await personal.json()).text, new RegExp(`/join/${jt}`));
  const badEdit = await api(`/api/drafts/${draft.id}`, alice, { text: "missing required link" }, "PUT"); assert.equal(badEdit.status, 200);
  const refused = await api(`/api/drafts/${draft.id}/approve`, alice); assert.equal(refused.status, 400);
  const text = `Join our project: ${B}/join/${jt}`;
  const edited = await api(`/api/drafts/${draft.id}`, alice, { text }, "PUT"); assert.equal((await edited.json()).draft.status, "edited");
  const approved = await api(`/api/drafts/${draft.id}/approve`, alice); const approvedData = await approved.json(); assert.equal(approved.status, 200); assert.equal(approvedData.draft.status, "approved"); assert.equal(approvedData.draft.approvedText, text); assert.match(approvedData.draft.approvedHash, /^[a-f0-9]{64}$/);
  const changed = await api(`/api/drafts/${draft.id}`, alice, { text: `${text} now` }, "PUT"); const changedData = await changed.json(); assert.equal(changedData.draft.status, "edited"); assert.equal(changedData.draft.approvedText, undefined);
  const skipped = await api(`/api/drafts/${draft.id}/skip`, alice); assert.equal((await skipped.json()).draft.status, "skipped");
});
test("applicants must sign in, and duplicates are ignored", async () => {
  assert.equal((await api("/api/join/" + jt, "")).status, 401);
  const bob = await login("bob"), carol = await login("carol");
  assert.equal((await api("/api/join/" + jt, bob)).status, 201);
  assert.equal((await api("/api/join/" + jt, bob)).status, 200);
  assert.equal((await api("/api/join/" + jt, carol)).status, 201);
});
test("only the owner can approve", async () => assert.equal((await api(`/api/projects/${pid}/applicants/carol/approve`, await login("bob"))).status, 403));
test("approve sends a read-only invitation and updates the status", async () => {
  const alice = await login("alice");
  const r = await api(`/api/projects/${pid}/applicants/bob/approve`, alice); assert.equal(r.status, 200);
  assert.deepEqual(calls[0], { u: "/repos/alice/proj/collaborators/bob", auth: "inst-tok", body: { permission: "pull" } });
  const list = await (await api("/api/projects", alice, null, "GET")).json();
  assert.equal(list.projects[0].applicants.find((a) => a.login === "bob").status, "approved");
});
test("if GitHub refuses, the status does not change", async () => {
  const alice = await login("alice");
  assert.equal((await api(`/api/projects/${pid}/applicants/carol/approve`, alice)).status, 502);
  const list = await (await api("/api/projects", alice, null, "GET")).json();
  assert.equal(list.projects[0].applicants.find((a) => a.login === "carol").status, "applied");
});
