// Checks that the page files are served, and that server code and docs are not.
const test = require("node:test"), assert = require("node:assert");
let app, B;
test.before(async () => { app = await require("../src/app").start(0); B = "http://127.0.0.1:" + app.address().port; });
test.after(() => { app.closeAllConnections && app.closeAllConnections(); app.close(); });
test("serves the page, styles and scripts", async () => {
  for (const [p, t] of [["/", "text/html"], ["/styles/base.css", "text/css"], ["/components/button/button.css", "text/css"], ["/features/main.js", "text/javascript"]]) {
    const r = await fetch(B + p); assert.equal(r.status, 200, p); assert.match(r.headers.get("content-type"), new RegExp(t), p);
  }
});
test("does not serve server code, docs or paths outside public", async () => {
  for (const p of ["/src/app.js", "/server.js", "/README.md", "/public/README.md", "/features/README.md", "/%2e%2e/server.js", "/..%2fserver.js", "/.env"]) assert.equal((await fetch(B + p)).status, 404, p);
});
test("security policy blocks inline scripts", async () => assert.match((await fetch(B + "/")).headers.get("content-security-policy"), /script-src 'self'(;|$)/));
