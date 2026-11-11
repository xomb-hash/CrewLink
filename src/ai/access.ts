import { getCurrentUser } from '../lib/auth';
import storage from '../lib/storage';
import type { Project, User } from '../types/index';
import type { Campaign } from './types';
import { AiForbiddenError, AiNotFoundError } from './errors';

export class AiUnauthorizedError extends Error {
  readonly status = 401;

  constructor(message = 'Please sign in with GitHub.') {
    super(message);
    this.name = 'AiUnauthorizedError';
  }
}

export async function requireAiUser(request: Request): Promise<User> {
  const user = await getCurrentUser(request);
  if (!user) throw new AiUnauthorizedError();
  return user;
}

// Ownership is checked against the project's GitHub owner, the same rule every
// existing owner-only route uses. A campaign must also have been created by this
// user, so one owner cannot act on another owner's campaign.
export async function requireOwnedProject(
  request: Request,
  projectId: string
): Promise<{ user: User; project: Project }> {
  const user = await requireAiUser(request);
  const project = await storage.getProjectById(projectId);
  if (!project) throw new AiNotFoundError('Project not found.');
  if (project.ownerLogin.toLowerCase() !== user.login.toLowerCase()) {
    throw new AiForbiddenError();
  }
  return { user, project };
}

export async function requireOwnedCampaign(
  request: Request,
  campaignId: string
): Promise<{ user: User; project: Project; campaign: Campaign }> {
  const user = await requireAiUser(request);
  const campaign = await storage.getCampaignById(campaignId);
  if (!campaign) throw new AiNotFoundError('Campaign not found.');
  const project = await storage.getProjectById(campaign.projectId);
  if (!project) throw new AiNotFoundError('Project not found.');
  if (
    project.ownerLogin.toLowerCase() !== user.login.toLowerCase() ||
    campaign.ownerId !== String(user.id)
  ) {
    throw new AiForbiddenError('Only the project owner who created this campaign can use it.');
  }
  return { user, project, campaign };
}
