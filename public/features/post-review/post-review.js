// Owner-only local review for platform drafts. This screen never sends a post to a platform.
import { createDrafts, listDrafts, editDraft, approveDraft, skipDraft } from "../../shared/api.js";
import { copyText } from "../../shared/clipboard.js";
import { esc } from "../../shared/utils.js";
const names = { discord: "Discord", telegram: "Telegram", bluesky: "Bluesky", mastodon: "Mastodon", linkedin: "LinkedIn", whatsapp: "WhatsApp" };
const limits = { discord: 2000, telegram: 4096, bluesky: 300, mastodon: 500, linkedin: 3000, whatsapp: 1000 };
const count = (text, platform) => platform === "bluesky" && Intl.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length : text.length;
const template = `<dialog id="post-review" aria-labelledby="post-review-title"><div class="dh"><h2 id="post-review-title">Review posts</h2><button class="x" type="button" data-close aria-label="Close">✕</button></div><div class="db" id="post-review-body"></div></dialog>`;

export function initPostReview() {
  document.body.insertAdjacentHTML("beforeend", template);
  const dialog = document.querySelector("#post-review"), body = document.querySelector("#post-review-body"); let project;
  const render = (drafts) => {
    body.innerHTML = drafts.length ? drafts.map((draft) => `<section class="draft" data-id="${esc(draft.id)}" data-platform="${esc(draft.platformId)}"><div class="draft-head"><b>${names[draft.platformId]}</b><span class="mu">${esc(draft.status)}</span></div><textarea aria-label="${names[draft.platformId]} draft" data-text>${esc(draft.text)}</textarea><p class="mu" data-count>${count(draft.text, draft.platformId)} / ${limits[draft.platformId]}${draft.platformId === "bluesky" ? " graphemes" : " characters"}</p><div class="checks">${draft.checks.map((check) => `<p class="${check.level === "error" ? "er" : "mu"}">${esc(check.message)}</p>`).join("") || "<p class=\"mu\">No checks to show.</p>"}</div>${draft.platformId === "whatsapp" ? `<p class="mu">Copy this, then paste it into your own WhatsApp Channel.</p><button class="btn o sm" data-copy>Copy</button>` : ""}<div class="draft-actions"><button class="btn o sm" data-save>Save changes</button><button class="btn sm" data-approve ${draft.checks.some((check) => check.level === "error") ? "disabled" : ""}>Approve</button><button class="btn o sm" data-skip>Skip</button></div></section>`).join("") : '<div class="empty"><b>No drafts yet</b><p class="mu">Choose draft platforms when creating a project, then return here.</p></div>';
  };
  const load = async () => {
    body.innerHTML = '<p class="mu">Loading drafts…</p>';
    let result = await listDrafts(project.id);
    if (result.ok && !result.data.drafts.length && project.draftPlatforms && project.draftPlatforms.length) result = await createDrafts(project.id, project.draftPlatforms);
    if (!result.ok) { body.innerHTML = `<div class="empty">${esc(result.data.error || "Can't load drafts.")}</div>`; return; }
    render(result.data.drafts);
  };
  dialog.onclick = async (event) => {
    if (event.target.closest("[data-close]")) return dialog.close();
    const section = event.target.closest(".draft"); if (!section) return;
    const id = section.dataset.id, text = section.querySelector("[data-text]").value;
    if (event.target.closest("[data-copy]")) return copyText(text);
    let result;
    if (event.target.closest("[data-save]")) result = await editDraft(id, text);
    if (event.target.closest("[data-approve]")) result = await approveDraft(id);
    if (event.target.closest("[data-skip]")) result = await skipDraft(id);
    if (result) { if (!result.ok) { const checks = result.data.checks || []; section.querySelector(".checks").innerHTML = `<p class="er">${esc(result.data.error || "Couldn't update draft.")}</p>${checks.map((check) => `<p class="er">${esc(check.message)}</p>`).join("")}`; } else load(); }
  };
  dialog.addEventListener("input", (event) => { const input = event.target.closest("[data-text]"); if (!input) return; const section = input.closest(".draft"), platform = section.dataset.platform; section.querySelector("[data-count]").textContent = `${count(input.value, platform)} / ${limits[platform]}${platform === "bluesky" ? " graphemes" : " characters"}`; });
  return { open: (nextProject) => { project = nextProject; dialog.showModal(); load(); } };
}
