// A copy-only personal post dialog. The server creates the text but never saves it.
import { personalPost } from "../../shared/api.js";
import { copyText } from "../../shared/clipboard.js";
import { esc } from "../../shared/utils.js";
const template = `<dialog id="personal-post" aria-labelledby="personal-post-title"><div class="dh"><h2 id="personal-post-title">Personal post</h2><button class="x" type="button" data-close aria-label="Close">✕</button></div><div class="db" id="personal-post-body"></div></dialog>`;
export function initPersonalPost() {
  document.body.insertAdjacentHTML("beforeend", template);
  const dialog = document.querySelector("#personal-post"), body = document.querySelector("#personal-post-body"); let project;
  const form = () => `<form id="personal-form"><label class="f"><span>Tone</span><select name="tone"><option value="casual">Casual</option><option value="professional">Professional</option></select></label><label class="f"><span>Roles wanted</span><textarea name="roles" maxlength="154">${esc((project.roles || []).join(", "))}</textarea></label><label class="f"><span>Extra line (optional)</span><input type="text" name="extraLine" maxlength="200"></label>${project.mode === "screening" ? '<label class="opt"><input type="checkbox" name="includeScreeningLink"> Include the screening link</label>' : ""}<button class="btn" type="submit">Create personal post</button></form><div id="personal-result"><p class="mu">Choose your tone and create a copy-only draft.</p></div>`;
  const generate = async () => {
    const values = new FormData(body.querySelector("#personal-form")); const result = body.querySelector("#personal-result"); result.innerHTML = '<p class="mu">Creating draft…</p>';
    const response = await personalPost(project.id, { tone: values.get("tone"), extraLine: values.get("extraLine"), includeScreeningLink: values.get("includeScreeningLink") === "on", roles: String(values.get("roles") || "").split(/[\n,]/).map((role) => role.trim()).filter(Boolean) });
    if (!response.ok) { result.innerHTML = `<div class="empty">${esc(response.data.error || "Can't create a personal post.")}</div>`; return; }
    result.innerHTML = `<label class="f"><span>Your copy-only draft</span><textarea id="personal-text">${esc(response.data.text)}</textarea></label><p class="mu" id="personal-count">${response.data.text.length} / 1000 characters</p>${response.data.checks.map((check) => `<p class="${check.level === "error" ? "er" : "mu"}">${esc(check.message)}</p>`).join("")}<button class="btn o" type="button" id="personal-copy">Copy</button>`;
  };
  dialog.onclick = (event) => { if (event.target.closest("[data-close]")) dialog.close(); if (event.target.closest("#personal-copy")) copyText(body.querySelector("#personal-text").value); };
  dialog.addEventListener("submit", (event) => { if (event.target.id === "personal-form") { event.preventDefault(); generate(); } });
  dialog.addEventListener("input", (event) => { if (event.target.id === "personal-text") body.querySelector("#personal-count").textContent = `${event.target.value.length} / 1000 characters`; });
  return { open: (nextProject) => { project = nextProject; dialog.showModal(); body.innerHTML = form(); } };
}
