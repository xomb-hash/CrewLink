import { config } from '../config/index.js';
import { storage } from '../lib/storage.js';
import { getCurrentUser } from '../auth/index.js';
import { getGitHubClient } from '../github/index.js';
import { parseBody, sendJson, sendError } from '../lib/request.js';
import { validateProjectInput } from '../lib/validation.js';

export function generateShareLinks(project, baseUrl = config.appUrl) {
  const joinUrl = `${baseUrl}/join/${project.slug}`;
  const textPrompt = `Build with us on ${project.title}:`;
  const fullMessage = `${textPrompt} ${joinUrl}`;

  return {
    joinUrl,
    linkedIn: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(joinUrl)}`,
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(textPrompt)}&url=${encodeURIComponent(joinUrl)}`,
    whatsApp: `https://api.whatsapp.com/send?text=${encodeURIComponent(fullMessage)}`
  };
}

export async function handleGetAdminRepos(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    return sendError(res, 401, 'Please sign in with GitHub to view your repositories.');
  }

  try {
    const client = getGitHubClient();
    const repos = await client.getUserAdminRepos(user.accessToken);
    return sendJson(res, 200, { repos });
  } catch (err) {
    console.error('Failed to fetch admin repos:', err.message);
    return sendError(res, 500, `Could not fetch repositories: ${err.message}`);
  }
}

export async function handleCreateProject(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    return sendError(res, 401, 'Please sign in with GitHub to create a project.');
  }

  const body = await parseBody(req);
  const validation = validateProjectInput(body);

  if (!validation.isValid) {
    return sendJson(res, 400, { errors: validation.errors });
  }

  const { repoFullName, joinMode, screeningUrl, title, description } = validation.data;
  const [owner, repo] = repoFullName.split('/');

  try {
    const client = getGitHubClient();
    // Enforce admin permission check
    const isAdmin = await client.checkAdminAccess(user.accessToken, owner, repo);
    if (!isAdmin) {
      return sendError(
        res,
        403,
        `You do not have administrative access to ${repoFullName}. Only repository administrators can connect a project.`
      );
    }

    // Determine visibility from user input or check
    const isPrivate = Boolean(body.isPrivate);

    const project = storage.createProject({
      ownerLogin: user.login,
      ownerId: user.id,
      ownerAvatar: user.avatarUrl,
      repoFullName,
      repoName: repo,
      repoOwner: owner,
      isPrivate,
      joinMode,
      screeningUrl,
      title: title || repo,
      description
    });

    const shareLinks = generateShareLinks(project);

    return sendJson(res, 201, {
      project: {
        ...project,
        shareLinks
      }
    });
  } catch (err) {
    console.error('Project creation failed:', err.message);
    return sendError(res, 500, `Failed to create project: ${err.message}`);
  }
}

export function handleGetOwnerProjects(req, res) {
  const user = getCurrentUser(req);
  if (!user) {
    return sendError(res, 401, 'Please sign in with GitHub.');
  }

  const projects = storage.getProjectsByOwner(user.login);

  const projectsWithDetails = projects.map((project) => {
    const applicants = storage.getApplicantsByProject(project.id).map((applicant) => ({
      id: applicant.id,
      userLogin: applicant.userLogin,
      userAvatar: applicant.userAvatar,
      accountAge: applicant.accountAge,
      publicRepoCount: applicant.publicRepoCount,
      message: applicant.message,
      status: applicant.status,
      invitationSent: applicant.invitationSent,
      createdAt: applicant.createdAt
    }));

    return {
      ...project,
      shareLinks: generateShareLinks(project),
      applicants,
      // Advisory warnings required by specifications
      warnings: {
        githubAccessLevel:
          'GitHub access levels: read-only invitations only apply on organisation repos. On personal repos every collaborator gets write access.',
        screeningHonourSystem:
          'Screening is on the honour system. Crewlink cannot check that someone finished a test.'
      }
    };
  });

  return sendJson(res, 200, { projects: projectsWithDetails });
}

export function handleGetProjectById(req, res, projectId) {
  const user = getCurrentUser(req);
  if (!user) {
    return sendError(res, 401, 'Please sign in with GitHub.');
  }

  const project = storage.getProjectById(projectId);
  if (!project) {
    return sendError(res, 404, 'Project not found.');
  }

  // Server-side owner enforcement
  if (project.ownerLogin.toLowerCase() !== user.login.toLowerCase()) {
    return sendError(res, 403, 'Access denied. You are not the owner of this project.');
  }

  const applicants = storage.getApplicantsByProject(project.id).map((applicant) => ({
    id: applicant.id,
    userLogin: applicant.userLogin,
    userAvatar: applicant.userAvatar,
    accountAge: applicant.accountAge,
    publicRepoCount: applicant.publicRepoCount,
    message: applicant.message,
    status: applicant.status,
    invitationSent: applicant.invitationSent,
    createdAt: applicant.createdAt
  }));

  return sendJson(res, 200, {
    project: {
      ...project,
      shareLinks: generateShareLinks(project),
      applicants
    }
  });
}
