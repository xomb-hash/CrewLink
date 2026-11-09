// The Create button: the form window, sending it to the backend, and the share buttons shown afterwards.
import { createProject, repositoryStatus } from "../../shared/api.js";
import { esc } from "../../shared/utils.js";
import { copyText } from "../../shared/clipboard.js";
import { toast } from "../../components/toast/toast.js";

const NAMES = { linkedin: "LinkedIn", x: "X", whatsapp: "WhatsApp" };
const TEMPLATE = `<dialog id="dlg" aria-labelledby="dt">
<div class="dh"><h2 id="dt">Create project</h2><button class="x" id="cx" aria-label="Close">✕</button></div>
<div class="db"><form id="f" novalidate>
<div class="row2">
<label class="f"><span>GitHub owner name</span><input type="text" name="ownerName" id="ownerName" placeholder="octocat" autocomplete="off" maxlength="39"><div class="er" id="err-ownerName"></div></label>
<label class="f"><span>Repository name</span><input type="text" name="repoName" id="repoName" placeholder="Hello-World" autocomplete="off" maxlength="100"><div class="er" id="err-repoName"></div></label>
</div><div class="pv" id="pv"></div><div style="display:flex;gap:8px;align-items:center;margin:-6px 0 14px"><button class="btn o sm" id="check-repo" type="button">Check repository</button><span class="mu" id="repo-status" aria-live="polite"></span></div>
<label class="f"><span>What are you building, and who do you need? (optional)</span><textarea name="description" maxlength="280"></textarea></label>
<label class="f"><span>Roles wanted (optional, up to 5; separate with commas or new lines)</span><textarea name="roles" maxlength="154" placeholder="Designer, Node.js developer"></textarea><div class="er" id="err-roles"></div></label>
<fieldset><legend>How should people join?</legend>
<label class="opt"><input type="radio" name="mode" value="referral" checked><div><b>Referral link</b><small>People open your link, sign in with GitHub, and you approve them.</small></div></label>
<label class="opt"><input type="radio" name="mode" value="screening"><div><b>Screening first</b><small>People complete your test or interview before you approve them.</small></div></label>
<div id="scr" hidden>
<label class="f"><span>Screening link (online test, interview scheduler or form)</span><input type="url" name="screeningUrl" placeholder="https://"><div class="er" id="err-screeningUrl"></div></label>
<label class="f"><span>Note to applicants (optional)</span><input type="text" name="screeningNote" maxlength="280" placeholder="Finish this 30 minute task, then request to join"></label>
</div></fieldset>
<fieldset><legend>Where should your post appear?</legend><div class="chk">
<label class="opt"><input type="checkbox" name="share" value="linkedin"> LinkedIn</label>
<label class="opt"><input type="checkbox" name="share" value="x"> X</label>
<label class="opt"><input type="checkbox" name="share" value="whatsapp"> WhatsApp</label>
</div><p class="mu" style="font-size:13px;margin-top:8px">Each one opens with your post ready to send. You press Post yourself.</p></fieldset>
<fieldset><legend>Create local drafts for (optional)</legend><div class="chk">
<label class="opt"><input type="checkbox" name="draftPlatforms" value="discord"> Discord</label>
<label class="opt"><input type="checkbox" name="draftPlatforms" value="telegram"> Telegram</label>
<label class="opt"><input type="checkbox" name="draftPlatforms" value="bluesky"> Bluesky</label>
<label class="opt"><input type="checkbox" name="draftPlatforms" value="mastodon"> Mastodon</label>
<label class="opt"><input type="checkbox" name="draftPlatforms" value="linkedin"> LinkedIn</label>
<label class="opt"><input type="checkbox" name="draftPlatforms" value="whatsapp"> WhatsApp</label>
</div><p class="mu" style="font-size:13px;margin-top:8px">These drafts stay in Crewlink until you review and approve them. Nothing is posted.</p></fieldset>
<div class="er" id="err-all"></div>
<div style="display:flex;gap:8px;margin-top:8px"><button class="btn" id="go" type="submit">Create project</button><button class="btn o" type="button" id="cc">Cancel</button></div>
</form>
<div id="done" hidden><p><b>Project created.</b> <span class="mu">Repository verified on GitHub.</span></p>
<div class="lk"><input type="text" id="jl" readonly aria-label="Join link"><button class="btn" id="cp" type="button">Copy</button></div>
<div class="shr" id="shr"></div><button class="btn o" id="dn" type="button">Done</button></div>
</div></dialog>`;

export function initCreateProject({ getUser, onCreated }) {
  document.body.insertAdjacentHTML("beforeend", TEMPLATE);
  const $ = (s) => document.querySelector(s), dlg = $("#dlg"), f = $("#f");
  const normalizeRepo = () => {
    const input = $("#repoName"), owner = $("#ownerName"), raw = input.value.trim().replace(/^https?:\/\/(?:www\.)?github\.com\//i, "").replace(/^github\.com\//i, "").replace(/\.git$/, "");
    const parts = raw.split("/").filter(Boolean), currentOwner = owner.value.trim().toLowerCase();
    if (parts.length > 1 && (!currentOwner || parts[0].toLowerCase() === currentOwner)) { if (!currentOwner) owner.value = parts[0]; input.value = parts[1]; }
    else if (parts.length) input.value = parts[0];
  };
  const preview = () => { $("#pv").textContent = "github.com/" + ($("#ownerName").value.trim() || "owner") + "/" + ($("#repoName").value.trim() || "repo"); };
  const clearErrors = () => document.querySelectorAll(".er").forEach((e) => (e.textContent = ""));
  f.addEventListener("input", preview);
  $("#repoName").addEventListener("blur", () => { normalizeRepo(); preview(); });
  f.elements.mode.forEach((r) => (r.onchange = () => ($("#scr").hidden = f.elements.mode.value !== "screening")));
  ["#cx", "#cc", "#dn"].forEach((s) => ($(s).onclick = () => dlg.close()));

  $("#new").onclick = () => {
    const user = getUser(); if (!user) { location.href = "/auth/github"; return; }
    f.reset(); clearErrors(); f.hidden = false; $("#done").hidden = true; $("#scr").hidden = true;
    f.elements.ownerName.value = user.login; preview(); dlg.showModal(); $("#repoName").focus();
  };

  $("#check-repo").onclick = async () => {
    clearErrors(); normalizeRepo(); preview(); const owner = $("#ownerName").value.trim(), repo = $("#repoName").value.trim(), status = $("#repo-status");
    if (!owner || !repo) { status.textContent = "Enter an owner and repository name first."; return; }
    status.textContent = "Checking GitHub…"; const result = await repositoryStatus(owner, repo);
    if (!result.ok) { status.textContent = result.data.error || "Couldn't check the repository."; return; }
    status.textContent = result.data.private ? `Repository found: ${result.data.name} (private).` : `Repository found: ${result.data.name} (public).`;
    if (!result.data.admin) status.textContent += " You need admin access to create a project.";
  };

  f.onsubmit = async (e) => {
    e.preventDefault(); clearErrors();
    const v = f.elements, btn = $("#go"); btn.disabled = true; btn.textContent = "Checking GitHub…";
    const r = await createProject({ ownerName: v.ownerName.value, repoName: v.repoName.value, description: v.description.value, roles: v.roles.value.split(/[\n,]/).map((role) => role.trim()).filter(Boolean), mode: v.mode.value,
      screeningUrl: v.screeningUrl.value, screeningNote: v.screeningNote.value, share: [...f.querySelectorAll("input[name=share]:checked")].map((i) => i.value), draftPlatforms: [...f.querySelectorAll("input[name=draftPlatforms]:checked")].map((i) => i.value) });
    btn.disabled = false; btn.textContent = "Create project";
    if (r.status === 401) { location.href = "/auth/github"; return; }
    if (!r.ok) {
      if (r.data.errors) for (const k in r.data.errors) { const el = $("#err-" + k); if (el) el.textContent = r.data.errors[k]; }
      else $("#err-all").textContent = r.data.error || "Something went wrong.";
      return;
    }
    showDone(r.data); onCreated();
  };

  function showDone(d) {
    f.hidden = true; $("#done").hidden = false; $("#jl").value = d.joinUrl; $("#cp").onclick = () => copyText(d.joinUrl);
    const sel = d.project.share;
    $("#shr").innerHTML = sel.length ? sel.map((k) => `<a class="btn o" href="${esc(d.shareLinks[k])}" target="_blank" rel="noopener noreferrer">Post on ${NAMES[k]}</a>`).join("") : '<span class="mu">No platform selected. Copy the link above to share it anywhere.</span>';
    if (navigator.share) {
      const b = document.createElement("button"); b.className = "btn o"; b.type = "button"; b.textContent = "Share from this device";
      b.onclick = () => navigator.share({ title: d.project.repoName, text: "Join my project", url: d.joinUrl }).catch(() => {}); $("#shr").appendChild(b);
    }
  }
}
