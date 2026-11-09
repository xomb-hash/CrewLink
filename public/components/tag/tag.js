import { esc } from "../../shared/utils.js";
export const tag = (text) => `<span class="tag">${esc(text)}</span>`;
export const status = (text) => `<span class="st ${esc(text)}">${esc(text)}</span>`;
