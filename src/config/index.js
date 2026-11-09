// All settings live here. Values come from environment variables or the .env file.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
try { // tiny .env loader, so no package is needed
  for (const l of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
const env = () => process.env;
const githubApp = () => ({ appId: env().GITHUB_APP_ID, clientId: env().GITHUB_CLIENT_ID, clientSecret: env().GITHUB_CLIENT_SECRET,
  keyPath: env().GITHUB_APP_PRIVATE_KEY_PATH && path.resolve(ROOT, env().GITHUB_APP_PRIVATE_KEY_PATH) });
module.exports = {
  ROOT, githubApp,
  port: () => env().PORT || 3000,
  githubApi: () => env().GITHUB_API || "https://api.github.com",
  githubWeb: () => env().GITHUB_WEB || "https://github.com",
  baseUrl: (req) => env().BASE_URL || `http://${req.headers.host}`,
  dbFile: () => path.join(env().DATA_DIR || path.join(ROOT, "data"), "projects.json"),
  configured: () => { const a = githubApp(); return !!(a.appId && a.clientId && a.clientSecret && a.keyPath); },
};
