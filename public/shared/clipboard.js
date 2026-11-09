import { toast } from "../components/toast/toast.js";
export const copyText = (t) => navigator.clipboard.writeText(t).then(() => toast("Link copied"), () => toast("Copy failed. Select the link and copy it."));
