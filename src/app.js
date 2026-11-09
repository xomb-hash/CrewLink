// The router: it only decides which feature handles each URL. Add a new feature by adding a line here.
const http = require("http"), config = require("./config");
const { send, limited } = require("./lib/http"), auth = require("./auth/routes"), projects = require("./projects/routes"), posting = require("./posting/routes");
const { serveStatic } = require("./lib/static"), applicants = require("./applicants/routes"), { joinPage } = require("./applicants/join-page");

async function handler(req, res) {
  const u = new URL(req.url, "http://localhost"), P = u.pathname;
  try {
    if (req.method === "POST" || req.method === "PUT") {
      if (limited(req.socket.remoteAddress)) return send(res, 429, { error: "Too many requests. Try again later." });
      if (!/^application\/json/.test(req.headers["content-type"] || "")) return send(res, 415, { error: "Expected JSON." });
    }
    if (req.method === "GET") {
      if (P === "/auth/github") return auth.start(req, res, u);
      if (P === "/auth/github/callback") return auth.callback(req, res, u);
      if (P === "/api/me") return auth.whoami(req, res);
      if (P === "/api/projects") return projects.list(req, res);
      const repo = P.match(/^\/api\/repositories\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/); if (repo) return projects.repositoryStatus(req, res, repo[1], repo[2]);
      let m = P.match(/^\/api\/projects\/([\w-]{36})\/drafts$/); if (m) return posting.listDrafts(req, res, m[1]);
      const j = P.match(/^\/join\/([\w-]{6,40})$/); if (j) return joinPage(req, res, j[1]);
      if (serveStatic(req, res, P)) return;
    } else if (req.method === "POST") {
      if (P === "/auth/logout") return auth.logout(req, res);
      if (P === "/api/projects") return projects.create(req, res);
      let m = P.match(/^\/api\/projects\/([\w-]{36})\/drafts$/); if (m) return posting.createDrafts(req, res, m[1]);
      m = P.match(/^\/api\/projects\/([\w-]{36})\/personal-post$/); if (m) return posting.personalPost(req, res, m[1]);
      m = P.match(/^\/api\/drafts\/([\w-]{36})\/approve$/); if (m) return posting.approveDraft(req, res, m[1]);
      m = P.match(/^\/api\/drafts\/([\w-]{36})\/skip$/); if (m) return posting.skipDraft(req, res, m[1]);
      m = P.match(/^\/api\/join\/([\w-]{6,40})$/); if (m) return applicants.apply(req, res, m[1]);
      m = P.match(/^\/api\/projects\/([\w-]{36})\/applicants\/([A-Za-z0-9-]{1,39})\/(approve|reject)$/); if (m) return applicants.decide(req, res, m[1], m[2], m[3]);
    } else if (req.method === "PUT") {
      const m = P.match(/^\/api\/drafts\/([\w-]{36})$/); if (m) return posting.editDraft(req, res, m[1]);
    }
    send(res, 404, { error: "Not found" });
  } catch (e) { console.error(e); send(res, 500, { error: "Something went wrong." }); }
}
const start = (port = config.port()) => new Promise((ok) => { const s = http.createServer(handler).listen(port, () => ok(s)); });
module.exports = { start };
