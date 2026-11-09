// Sign in with GitHub: /auth/github, /auth/github/callback, /auth/logout and /api/me.
const config = require("../config"), { gh } = require("../github/client"), { send, redirect, cookies, makeCookie } = require("../lib/http");
const { safeNext } = require("../lib/validate"), S = require("./sessions");

function start(req, res, u) {
  if (!config.configured()) return send(res, 503, "<h1>GitHub App not configured</h1><p>Copy .env.example to .env and fill it in. See README.md.</p>", "text/html");
  const state = S.newState(safeNext(u.searchParams.get("next")));
  const q = new URLSearchParams({ client_id: config.githubApp().clientId, redirect_uri: config.baseUrl(req) + "/auth/github/callback", state });
  redirect(res, `${config.githubWeb()}/login/oauth/authorize?${q}`, { "Set-Cookie": makeCookie(req, "oauth_state", state, 600) });
}
async function callback(req, res, u) {
  const state = u.searchParams.get("state"), code = u.searchParams.get("code"), st = S.takeState(state);
  const fail = (c, t) => send(res, c, `<h1>Sign-in failed</h1><p>${t} <a href='/'>Go back</a> and try again.</p>`, "text/html");
  if (!st || cookies(req).oauth_state !== state || !code) return fail(400, "The sign-in request expired or didn't match.");
  const app = config.githubApp();
  const t = await gh("/login/oauth/access_token", { method: "POST", base: config.githubWeb(), accept: "application/json",
    body: { client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: config.baseUrl(req) + "/auth/github/callback" } });
  const token = t.data && t.data.access_token;
  if (!token) return fail(400, "GitHub didn't accept the sign-in.");
  const user = await gh("/user", { token });
  if (!user.ok) return fail(502, "Couldn't read your GitHub profile.");
  const sid = S.createSession(user.data, token);
  redirect(res, st.next, { "Set-Cookie": [makeCookie(req, "sid", sid, 7 * 86400), makeCookie(req, "oauth_state", "", 0)] });
}
function logout(req, res) { S.destroySession(req); send(res, 200, { ok: true }, "application/json", { "Set-Cookie": makeCookie(req, "sid", "", 0) }); }
function whoami(req, res) { const s = S.me(req); send(res, 200, { user: s ? { login: s.login, avatar: s.avatar } : null }); }
module.exports = { start, callback, logout, whoami };
