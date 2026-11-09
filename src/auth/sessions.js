// Who is signed in. Sessions are kept in memory, so everyone signs in again after a restart.
const crypto = require("crypto"), { cookies } = require("../lib/http");
const sessions = new Map(), states = new Map();
const me = (req) => { const s = sessions.get(cookies(req).sid); return s && s.exp > Date.now() ? s : null; };
function createSession(user, token) {
  const sid = crypto.randomBytes(32).toString("base64url");
  sessions.set(sid, { login: user.login, avatar: user.avatar_url, createdAt: user.created_at, publicRepos: user.public_repos, token, exp: Date.now() + 7 * 864e5 });
  return sid;
}
const destroySession = (req) => sessions.delete(cookies(req).sid);
function newState(next) { const s = crypto.randomBytes(16).toString("base64url"); states.set(s, { next, exp: Date.now() + 6e5 }); return s; }
function takeState(s) { const st = states.get(s); states.delete(s); return st && st.exp > Date.now() ? st : null; }
module.exports = { me, createSession, destroySession, newState, takeState };
