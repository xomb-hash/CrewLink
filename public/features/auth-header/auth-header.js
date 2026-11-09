// The top-right corner: your avatar and Sign out, or a Sign in with GitHub button.
import { logout } from "../../shared/api.js";
import { esc } from "../../shared/utils.js";
import { button } from "../../components/button/button.js";
export function renderAuthHeader(user) {
  const who = document.getElementById("who");
  who.innerHTML = user ? `<img src="${esc(user.avatar)}" alt="" width="28" height="28"><b>${esc(user.login)}</b>${button("Sign out", { variant: "o", size: "sm", attrs: { id: "out" } })}`
    : '<a class="btn o" href="/auth/github">Sign in with GitHub</a>';
  const out = document.getElementById("out");
  if (out) out.onclick = async () => { await logout(); location.reload(); };
}
