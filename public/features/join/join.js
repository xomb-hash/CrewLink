// Used by the join page the server builds (src/applicants/join-page.js): sends the "Request to join" click.
const b = document.getElementById("b");
b.onclick = async () => {
  b.disabled = true;
  const r = await fetch("/api/join/" + encodeURIComponent(b.dataset.token), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const d = await r.json().catch(() => ({}));
  document.getElementById("m").textContent = d.message || d.error || "Something went wrong.";
  b.disabled = false;
};
