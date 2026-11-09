import { storage } from '../lib/storage.js';
import { getCurrentUser } from '../auth/index.js';
import { getGitHubClient } from '../github/index.js';
import { parseBody, sendJson, sendError } from '../lib/request.js';
import { formatAccountAge, validateApplicantInput } from '../lib/validation.js';

export function handleGetJoinData(req, res, slug) {
  const project = storage.getProjectBySlug(slug);
  if (!project) {
    return sendError(res, 404, 'Project not found.');
  }

  const currentUser = getCurrentUser(req);
  let existingApplication = null;
  let isOwner = false;

  if (currentUser) {
    isOwner = project.ownerLogin.toLowerCase() === currentUser.login.toLowerCase();
    const applicant = storage.findApplicant(project.id, currentUser.id);
    if (applicant) {
      existingApplication = {
        id: applicant.id,
        status: applicant.status,
        createdAt: applicant.createdAt,
        invitationSent: applicant.invitationSent
      };
    }
  }

  return sendJson(res, 200, {
    project: {
      id: project.id,
      slug: project.slug,
      title: project.title,
      description: project.description,
      repoFullName: project.repoFullName,
      repoName: project.repoName,
      repoOwner: project.repoOwner,
      isPrivate: project.isPrivate,
      joinMode: project.joinMode,
      screeningUrl: project.screeningUrl,
      ownerLogin: project.ownerLogin,
      ownerAvatar: project.ownerAvatar,
      githubUrl: project.isPrivate ? null : `https://github.com/${project.repoFullName}`
    },
    currentUser: currentUser
      ? {
          id: currentUser.id,
          login: currentUser.login,
          avatarUrl: currentUser.avatarUrl
        }
      : null,
    isOwner,
    existingApplication
  });
}

export async function handleApply(req, res, slug) {
  const currentUser = getCurrentUser(req);
  if (!currentUser) {
    return sendError(res, 401, 'Please sign in with GitHub to apply.');
  }

  const project = storage.getProjectBySlug(slug);
  if (!project) {
    return sendError(res, 404, 'Project not found.');
  }

  // Prevent project owners from applying to their own project
  if (project.ownerLogin.toLowerCase() === currentUser.login.toLowerCase()) {
    return sendError(res, 400, 'You are the owner of this project and cannot apply to it.');
  }

  // Check if applicant already exists
  const existing = storage.findApplicant(project.id, currentUser.id);
  if (existing) {
    return sendError(res, 400, 'You have already applied to this project.');
  }

  const body = await parseBody(req);
  const validation = validateApplicantInput(body);
  if (!validation.isValid) {
    return sendJson(res, 400, { errors: validation.errors });
  }

  const accountAge = formatAccountAge(currentUser.createdAt);

  const applicant = storage.createApplicant({
    projectId: project.id,
    userId: currentUser.id,
    userLogin: currentUser.login,
    userAvatar: currentUser.avatarUrl,
    accountAge,
    publicRepoCount: currentUser.publicRepos || 0,
    message: validation.data.message
  });

  return sendJson(res, 201, {
    applicant: {
      id: applicant.id,
      status: applicant.status,
      createdAt: applicant.createdAt
    }
  });
}

export async function handleApprove(req, res, projectId, applicantId) {
  const currentUser = getCurrentUser(req);
  if (!currentUser) {
    return sendError(res, 401, 'Please sign in with GitHub.');
  }

  const project = storage.getProjectById(projectId);
  if (!project) {
    return sendError(res, 404, 'Project not found.');
  }

  // Server-side owner enforcement
  if (project.ownerLogin.toLowerCase() !== currentUser.login.toLowerCase()) {
    return sendError(res, 403, 'Access denied. Only the project owner can approve applicants.');
  }

  const applicant = storage.getApplicantById(applicantId);
  if (!applicant || applicant.projectId !== projectId) {
    return sendError(res, 404, 'Applicant not found.');
  }

  if (applicant.status === 'approved') {
    return sendJson(res, 200, {
      message: 'Applicant is already approved.',
      applicant
    });
  }

  try {
    const client = getGitHubClient();
    const [owner, repo] = project.repoFullName.split('/');

    // Send real GitHub collaborator invitation
    const invitation = await client.inviteCollaborator({
      accessToken: currentUser.accessToken,
      owner,
      repo,
      username: applicant.userLogin
    });

    const updated = storage.updateApplicantStatus(applicant.id, 'approved', invitation);

    return sendJson(res, 200, {
      success: true,
      applicant: updated,
      invitation
    });
  } catch (err) {
    console.error('Failed to send collaborator invitation:', err.message);
    return sendError(
      res,
      502,
      `GitHub invitation could not be sent: ${err.message}. Please verify repository admin permissions.`
    );
  }
}

export async function handleReject(req, res, projectId, applicantId) {
  const currentUser = getCurrentUser(req);
  if (!currentUser) {
    return sendError(res, 401, 'Please sign in with GitHub.');
  }

  const project = storage.getProjectById(projectId);
  if (!project) {
    return sendError(res, 404, 'Project not found.');
  }

  // Server-side owner enforcement
  if (project.ownerLogin.toLowerCase() !== currentUser.login.toLowerCase()) {
    return sendError(res, 403, 'Access denied. Only the project owner can reject applicants.');
  }

  const applicant = storage.getApplicantById(applicantId);
  if (!applicant || applicant.projectId !== projectId) {
    return sendError(res, 404, 'Applicant not found.');
  }

  const updated = storage.updateApplicantStatus(applicant.id, 'rejected');

  return sendJson(res, 200, {
    success: true,
    applicant: updated
  });
}
