// Serves the files in public/ (pages, styles, scripts). Only listed file types, and never anything outside public/.
const fs = require("fs"), path = require("path"), config = require("../config"), { send } = require("./http");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
const ROOT = path.join(config.ROOT, "public");
function serveStatic(req, res, pathname) {
  let p; try { p = decodeURIComponent(pathname); } catch { return false; }
  if (p.endsWith("/")) p += "index.html";
  const file = path.normalize(path.join(ROOT, p)), type = TYPES[path.extname(file)];
  if (!file.startsWith(ROOT + path.sep) || !type) return false;
  let data; try { data = fs.readFileSync(file); } catch { return false; }
  if (type === "text/html") send(res, 200, data.toString("utf8"), "text/html");
  else { res.writeHead(200, { "Content-Type": type + (type.startsWith("text") ? "; charset=utf-8" : ""), "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" }); res.end(data); }
  return true;
}
module.exports = { serveStatic };
