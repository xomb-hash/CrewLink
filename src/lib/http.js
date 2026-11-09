// Small helpers for requests and responses: send JSON or HTML, redirect, read the body, cookies, rate limit.
const config = require("../config");
const hits = new Map();
const limited = (ip) => { const n = Date.now(), a = (hits.get(ip) || []).filter((t) => n - t < 36e5); a.push(n); hits.set(ip, a); return a.length > 60; };
const send = (res, code, data, type = "application/json", extra = {}) => {
  const h = { "Content-Type": type + "; charset=utf-8", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra };
  if (type === "text/html") h["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com; frame-ancestors 'none'";
  res.writeHead(code, h); res.end(type === "application/json" ? JSON.stringify(data) : data);
};
const redirect = (res, to, extra = {}) => { res.writeHead(302, { Location: to, ...extra }); res.end(); };
const readBody = (req) => new Promise((ok, no) => {
  let s = ""; req.on("data", (c) => { s += c; if (s.length > 10000) { no(new Error("Request too large")); req.destroy(); } });
  req.on("end", () => { try { ok(JSON.parse(s || "{}")); } catch { no(new Error("Invalid JSON")); } });
});
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter((a) => a[0] && a[1] !== undefined));
const makeCookie = (req, name, val, age) => `${name}=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${config.baseUrl(req).startsWith("https") ? "; Secure" : ""}`;
module.exports = { limited, send, redirect, readBody, cookies, makeCookie };
