// button("Approve", { variant: "o", size: "sm", attrs: { id: "x" } }) returns the HTML for a button.
import { esc } from "../../shared/utils.js";
export function button(label, { variant = "", size = "", attrs = {} } = {}) {
  const cls = ["btn", variant, size].filter(Boolean).join(" ");
  const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
  return `<button class="${cls}"${a}>${esc(label)}</button>`;
}
