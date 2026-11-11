import { config } from '../config/index';
import storage from '../lib/storage';
import { byId } from '../platforms/registry';
import { normalizeSubreddit, validSubreddit } from '../posting/reddit/validate';
import { AiNotFoundError, AiValidationError } from './errors';
import { isValidDateString, isValidTimeZone } from './scheduling';
import type { Campaign, CampaignDetail, ContentIdea } from './types';

// Substack-style long-form and Discord server chatter are not part of M8. The
// generation prompt and platform checks still enforce each platform's limits.
export const AI_PLATFORMS = [
  'linkedin',
  'x',
  'reddit',
  'bluesky',
  'telegram',
  'slack',
] as const;

export type AiPlatformId = (typeof AI_PLATFORMS)[number];

const clean = (value: unknown, max: number): string =>
  String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, max);

function cleanList(value: unknown, maxItems: number, maxItem: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = clean(item, maxItem);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizePlatforms(value: unknown): AiPlatformId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: AiPlatformId[] = [];
  for (const item of value) {
    const id = String(item || '').trim().toLowerCase();
    if (!AI_PLATFORMS.includes(id as AiPlatformId) || seen.has(id)) continue;
    seen.add(id);
    out.push(id as AiPlatformId);
  }
  return out;
}

function normalizeDuration(value: unknown): number {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > config.aiMaxDurationDays) {
    throw new AiValidationError(
      `Choose a duration between 1 and ${config.aiMaxDurationDays} days.`
    );
  }
  return days;
}

function normalizeTimezone(value: unknown): string {
  const timezone = clean(value, 80) || 'UTC';
  if (!isValidTimeZone(timezone)) {
    throw new AiValidationError('Choose a valid IANA timezone, such as Europe/London.');
  }
  return timezone;
}

function normalizeStartDate(value: unknown): string {
  const date = clean(value, 10);
  if (!date) return '';
  if (!isValidDateString(date)) {
    throw new AiValidationError('Choose a valid start date (YYYY-MM-DD).');
  }
  return date;
}

function normalizeRedditSubreddit(value: unknown, platforms: string[]): string | undefined {
  const normalized = normalizeSubreddit(value);
  if (!platforms.includes('reddit')) {
    return normalized || undefined;
  }
  if (!normalized) {
    throw new AiValidationError('Choose a subreddit for the Reddit posts.');
  }
  if (!validSubreddit(normalized)) {
    throw new AiValidationError('Enter a valid subreddit name (2-21 letters, numbers or underscores).');
  }
  return normalized;
}

export interface CampaignCreateInput {
  brief: string;
  name?: string;
  objective?: string;
  audience?: string;
  platforms: AiPlatformId[];
  durationDays: number;
  timezone: string;
  startDate?: string;
  redditSubreddit?: string;
  themes?: string[];
  postingFrequency?: string;
  desiredOutcomes?: string[];
}

export function parseCampaignCreate(body: unknown): CampaignCreateInput {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const brief = clean(raw.brief, 3000);
  if (brief.length < 10) {
    throw new AiValidationError('Describe the campaign objective in at least 10 characters.');
  }
  const platforms = normalizePlatforms(raw.platforms);
  if (!platforms.length) {
    throw new AiValidationError('Choose at least one supported platform.');
  }
  for (const platformId of platforms) {
    if (!byId(platformId)) throw new AiValidationError(`Unsupported platform: ${platformId}`);
  }
  return {
    brief,
    name: clean(raw.name, 160) || undefined,
    objective: clean(raw.objective, 600) || undefined,
    audience: clean(raw.audience, 600) || undefined,
    platforms,
    durationDays: normalizeDuration(raw.durationDays ?? 7),
    timezone: normalizeTimezone(raw.timezone),
    startDate: normalizeStartDate(raw.startDate),
    redditSubreddit: normalizeRedditSubreddit(raw.redditSubreddit, platforms),
    themes: cleanList(raw.themes, 10, 120),
    postingFrequency: clean(raw.postingFrequency, 300) || undefined,
    desiredOutcomes: cleanList(raw.desiredOutcomes, 10, 200),
  };
}

export async function createCampaign(options: {
  userId: string;
  projectId: string;
  body: unknown;
}): Promise<Campaign> {
  const input = parseCampaignCreate(options.body);
  return storage.createCampaign({
    projectId: options.projectId,
    ownerId: options.userId,
    brief: input.brief,
    name: input.name,
    objective: input.objective,
    audience: input.audience,
    platforms: input.platforms,
    durationDays: input.durationDays,
    timezone: input.timezone,
    startDate: input.startDate,
    redditSubreddit: input.redditSubreddit,
    themes: input.themes,
    postingFrequency: input.postingFrequency,
    desiredOutcomes: input.desiredOutcomes,
  });
}

export interface StrategyPatch {
  name?: string;
  objective?: string;
  audience?: string;
  platforms?: AiPlatformId[];
  durationDays?: number;
  timezone?: string;
  startDate?: string;
  redditSubreddit?: string | null;
  themes?: string[];
  postingFrequency?: string;
  desiredOutcomes?: string[];
  ideas?: Array<{
    id: string;
    day?: number;
    platformId?: string;
    topic?: string;
    angle?: string;
  }>;
}

// Owners can change every proposed strategy field. Calendar edits are applied to
// the same idea rows the generator and scheduler use, so there is only one plan.
export async function applyStrategyPatch(
  campaign: Campaign,
  body: unknown
): Promise<{ campaign: Campaign; ideas: ContentIdea[] }> {
  const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const existingIdeas = await storage.getContentIdeas(campaign.id);
  const patch: Parameters<typeof storage.updateCampaign>[1] = {};

  if (raw.name !== undefined) patch.name = clean(raw.name, 160);
  if (raw.objective !== undefined) patch.objective = clean(raw.objective, 600);
  if (raw.audience !== undefined) patch.audience = clean(raw.audience, 600);

  let platforms = campaign.platforms;
  if (raw.platforms !== undefined) {
    platforms = normalizePlatforms(raw.platforms);
    if (!platforms.length) throw new AiValidationError('Keep at least one platform.');
    patch.platforms = platforms;
  }

  let durationDays = campaign.durationDays;
  if (raw.durationDays !== undefined) {
    durationDays = normalizeDuration(raw.durationDays);
    patch.durationDays = durationDays;
  }
  const longestIdea = existingIdeas.reduce((max, idea) => Math.max(max, idea.day), 0);
  if (longestIdea > durationDays) {
    throw new AiValidationError(
      `The calendar has content on day ${longestIdea}, so the duration cannot be shorter.`
    );
  }

  if (raw.timezone !== undefined) patch.timezone = normalizeTimezone(raw.timezone);
  if (raw.startDate !== undefined) patch.startDate = normalizeStartDate(raw.startDate);
  if (raw.themes !== undefined) patch.themes = cleanList(raw.themes, 10, 120);
  if (raw.postingFrequency !== undefined) {
    patch.postingFrequency = clean(raw.postingFrequency, 300);
  }
  if (raw.desiredOutcomes !== undefined) {
    patch.desiredOutcomes = cleanList(raw.desiredOutcomes, 10, 200);
  }
  if (raw.redditSubreddit !== undefined) {
    patch.redditSubreddit =
      normalizeRedditSubreddit(raw.redditSubreddit, platforms) || null;
  } else if (raw.platforms !== undefined && !platforms.includes('reddit')) {
    patch.redditSubreddit = null;
  }

  const ideaPatches = Array.isArray(raw.ideas) ? raw.ideas : [];
  if (ideaPatches.length > 100) {
    throw new AiValidationError('Too many calendar edits in one request.');
  }
  const byIdeaId = new Map(existingIdeas.map((idea) => [idea.id, idea]));
  const validated: Array<{
    id: string;
    day?: number;
    platformId?: string;
    topic?: string;
    angle?: string;
  }> = [];
  for (const entry of ideaPatches) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const idea = byIdeaId.get(String(row.id || ''));
    if (!idea) throw new AiValidationError('A calendar entry no longer exists.');
    const next: (typeof validated)[number] = { id: idea.id };
    if (row.day !== undefined) {
      const day = Number(row.day);
      if (!Number.isInteger(day) || day < 1 || day > durationDays) {
        throw new AiValidationError('A calendar day is outside the campaign duration.');
      }
      next.day = day;
    }
    if (row.platformId !== undefined) {
      const platformId = String(row.platformId || '').trim().toLowerCase();
      if (!platforms.includes(platformId as AiPlatformId)) {
        throw new AiValidationError('A calendar entry uses a platform that is not selected.');
      }
      next.platformId = platformId;
    }
    if (row.topic !== undefined) {
      const topic = clean(row.topic, 300);
      if (!topic) throw new AiValidationError('Every calendar entry needs a topic.');
      next.topic = topic;
    }
    if (row.angle !== undefined) next.angle = clean(row.angle, 500);
    validated.push(next);
  }

  // Platform removals must not leave calendar entries pointing at them.
  for (const idea of existingIdeas) {
    const nextPlatform =
      validated.find((row) => row.id === idea.id)?.platformId ?? idea.platformId;
    if (!platforms.includes(nextPlatform as AiPlatformId)) {
      throw new AiValidationError(
        `Day ${idea.day} is assigned to ${nextPlatform}, which is no longer selected.`
      );
    }
  }

  const updated = Object.keys(patch).length
    ? await storage.updateCampaign(campaign.id, patch)
    : campaign;
  if (!updated) throw new AiNotFoundError('Campaign not found.');

  const nextSubreddit =
    patch.redditSubreddit !== undefined ? patch.redditSubreddit : campaign.redditSubreddit;
  if (platforms.includes('reddit') && !nextSubreddit) {
    throw new AiValidationError('Choose a subreddit for the Reddit posts.');
  }

  for (const row of validated) {
    await storage.updateContentIdea(row.id, {
      ...(row.day !== undefined ? { day: row.day } : {}),
      ...(row.platformId !== undefined ? { platformId: row.platformId } : {}),
      ...(row.topic !== undefined ? { topic: row.topic } : {}),
      ...(row.angle !== undefined ? { angle: row.angle } : {}),
    });
  }

  return {
    campaign: (await storage.getCampaignById(campaign.id)) || updated,
    ideas: await storage.getContentIdeas(campaign.id),
  };
}

export async function getCampaignDetail(campaignId: string): Promise<CampaignDetail> {
  const campaign = await storage.getCampaignById(campaignId);
  if (!campaign) throw new AiNotFoundError('Campaign not found.');
  const [tasks, sources, ideas, generated, schedules, executions, analytics] =
    await Promise.all([
      storage.getCampaignTasks(campaignId),
      storage.getResearchSources(campaignId),
      storage.getContentIdeas(campaignId),
      storage.getGeneratedPosts(campaignId),
      storage.getCampaignSchedules(campaignId),
      storage.getAgentExecutions(campaignId),
      storage.getCampaignAnalytics(campaignId),
    ]);
  return { campaign, tasks, sources, ideas, generated, schedules, executions, analytics };
}
