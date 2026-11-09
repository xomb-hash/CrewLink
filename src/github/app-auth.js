// How the Crewlink GitHub App proves who it is: a short-lived signed token (JWT), swapped for an installation token.
const fs = require("fs"), crypto = require("crypto"), config = require("../config"), { gh } = require("./client");
function appJwt() {
  const a = config.githubApp(), b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"), now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "RS256", typ: "JWT" }), body = b64({ iat: now - 60, exp: now + 540, iss: a.appId });
  const sig = crypto.sign("RSA-SHA256", Buffer.from(head + "." + body), fs.readFileSync(a.keyPath)).toString("base64url");
  return `${head}.${body}.${sig}`;
}
async function installationToken(owner, repo) {
  const jwt = appJwt();
  const inst = await gh(`/repos/${owner}/${repo}/installation`, { token: jwt });
  if (inst.status === 0) return { error: "Couldn't reach GitHub. Try again." };
  if (!inst.ok) return { error: "The Crewlink GitHub App isn't installed on this repository. Install it, then try again." };
  const tok = await gh(`/app/installations/${inst.data.id}/access_tokens`, { method: "POST", token: jwt });
  if (!tok.ok) return { error: "Couldn't get permission from GitHub. Try again." };
  return { token: tok.data.token };
}
module.exports = { installationToken };
