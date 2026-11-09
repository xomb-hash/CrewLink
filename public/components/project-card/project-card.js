// projectCard(project) returns the card for one project, with its applicants and Approve / Reject buttons.
import { esc, age, codeUrl } from "../../shared/utils.js";
import { visibilityIcon } from "../visibility-icon/visibility-icon.js";
import { button } from "../button/button.js";
import { tag, status } from "../tag/tag.js";

export function applicantRow(p, a) {
  const open = a.status === "applied" || a.status === "screening";
  const attrs = (act) => ({ "data-act": act, "data-pid": p.id, "data-login": a.login, "data-ot": p.ownerType });
  return `<div class="ar"><div class="who"><img src="${esc(a.avatar || "")}" alt="" width="28" height="28"><div>
<a href="https://github.com/${esc(a.login)}" target="_blank" rel="noopener noreferrer"><b>${esc(a.login)}</b></a>
<div class="mu" style="font-size:12px">Account ${age(a.accountCreated)} · ${Number(a.publicRepos) || 0} public repos</div></div></div>
<div class="who">${status(a.status)}${open ? button("Approve", { size: "sm", attrs: attrs("approve") }) + button("Reject", { variant: "o", size: "sm", attrs: attrs("reject") }) : ""}</div></div>`;
}
export function projectCard(p) {
  const pub = p.isPrivate === false, name = `${esc(p.ownerName)}/${esc(p.repoName)}`;
  const title = pub ? `<a href="${esc(codeUrl(p))}" target="_blank" rel="noopener noreferrer">${name}</a>` : name;
  const view = pub ? ` <a class="btn o sm" href="${esc(codeUrl(p))}" target="_blank" rel="noopener noreferrer">View code</a>` : "";
  const rows = p.applicants.length ? p.applicants.map((a) => applicantRow(p, a)).join("") : '<p class="mu" style="font-size:13px">No requests yet. Share your join link.</p>';
  return `<div class="pc"><b>${visibilityIcon(p.isPrivate)}${title}</b>${tag(pub ? "Public" : "Private")}${tag(p.mode === "screening" ? "Screening first" : "Referral link")}${tag(p.applicants.length + " requests")}
<p class="mu" style="margin:10px 0">${esc(p.description || "No description")}</p>${button("Copy join link", { variant: "o", size: "sm", attrs: { "data-l": p.joinUrl } })}${view}
<div style="margin-top:12px">${rows}</div></div>`;
}
