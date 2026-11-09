// The list of your projects, with applicants and the Approve / Reject / Copy link buttons.
import { listProjects, decide } from "../../shared/api.js";
import { copyText } from "../../shared/clipboard.js";
import { toast } from "../../components/toast/toast.js";
import { projectCard } from "../../components/project-card/project-card.js";

export function initMyProjects({ getUser, onReview, onPersonal }) {
  const list = document.getElementById("list"); let current = [];
  async function refresh() {
    if (!getUser()) { list.innerHTML = '<div class="empty"><b>Sign in to create and manage projects</b><p class="mu" style="margin:6px 0 14px">We use your GitHub account, so there is nothing new to set up.</p><a class="btn" href="/auth/github">Sign in with GitHub</a></div>'; return; }
    list.innerHTML = '<p class="mu" style="margin-top:24px">Loading…</p>';
    const r = await listProjects();
    if (!r.ok) { list.innerHTML = '<div class="empty">Can\'t load projects. Is the server running?</div>'; return; }
    const { projects } = r.data; current = projects;
    list.innerHTML = projects.length ? '<div class="grid">' + projects.map(projectCard).join("") + "</div>" : '<div class="empty"><b>No projects yet</b><p class="mu" style="margin:6px 0 14px">Press Create to add your first one.</p></div>';
  }
  list.onclick = async (e) => {
    const c = e.target.closest("[data-l]"); if (c) { copyText(c.dataset.l); return; }
    const review = e.target.closest("[data-review]"); if (review) return onReview(current.find((project) => project.id === review.dataset.review));
    const personal = e.target.closest("[data-personal]"); if (personal) return onPersonal(current.find((project) => project.id === personal.dataset.personal));
    const b = e.target.closest("[data-act]"); if (!b) return;
    if (b.dataset.act === "approve" && b.dataset.ot === "User" && !confirm("This is a personal repository, so GitHub gives collaborators write access. Send the invitation anyway?")) return;
    b.disabled = true;
    const r = await decide(b.dataset.pid, b.dataset.login, b.dataset.act);
    toast(r.data.message || r.data.error || "Done");
    refresh();
  };
  return { refresh };
}
