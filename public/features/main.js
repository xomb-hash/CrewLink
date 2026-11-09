// Starts the page: finds out who is signed in, then starts each feature.
import { getMe } from "../shared/api.js";
import { renderAuthHeader } from "./auth-header/auth-header.js";
import { initMyProjects } from "./my-projects/my-projects.js";
import { initCreateProject } from "./create-project/create-project.js";
import { initPostReview } from "./post-review/post-review.js";
import { initPersonalPost } from "./personal-post/personal-post.js";

let user = null;
const getUser = () => user;
const review = initPostReview(), personal = initPersonalPost();
const projects = initMyProjects({ getUser, onReview: review.open, onPersonal: personal.open });
initCreateProject({ getUser, onCreated: projects.refresh });
getMe().then((u) => { user = u; renderAuthHeader(user); projects.refresh(); });
