import { config } from '../config/index';
import storage from '../lib/storage';
import type { Project } from '../types/index';
import { getBrandProfile } from './brand';
import { AiConflictError, AiValidationError } from './errors';
import { createAgentRuntime } from './execution';
import { generateForIdea, type GenerationResult } from './generation';
import type { LlmProvider } from './llm';
import { evaluateDraft } from './quality';
import {
  buildSuggestedSchedule,
  evaluateScheduleStatuses,
  normalizeManualScheduleTime,
} from './scheduling';
import type { Campaign, CampaignSchedule, ContentIdea, QualityResult } from './types';

export async function generateIdea(options: {
  campaign: Campaign;
  ideaId: string;
  project: Project;
  provider: LlmProvider;
  force?: boolean;
  signal?: AbortSignal;
}): Promise<{ idea: ContentIdea; result: GenerationResult }> {
  const idea = await storage.getContentIdeaById(options.ideaId);
  if (!idea || idea.campaignId !== options.campaign.id) {
    throw new AiValidationError('Calendar entry not found.');
  }
  if (!options.campaign.platforms.includes(idea.platformId)) {
    throw new AiValidationError('This calendar entry uses a platform that is not selected.');
  }
  const existing = (await storage.getGeneratedPosts(options.campaign.id)).filter(
    (post) => post.ideaId === idea.id
  );
  if (existing.length && !options.force) {
    throw new AiConflictError('This calendar entry already has generated drafts.');
  }

  const brand = await getBrandProfile(options.project.id);
  const runtime = createAgentRuntime(options.provider, {
    signal: options.signal,
    maxCalls: 2,
  });
  const startedAt = Date.now();
  try {
    const result = await generateForIdea({
      campaign: options.campaign,
      idea,
      brand,
      research: options.campaign.research || null,
      project: options.project,
      runtime,
      joinUrl: `${config.appUrl}/join/${options.project.slug}`,
      variationCount: config.aiVariationsPerIdea,
      variationOffset: existing.length,
    });
    const summary = runtime.summary();
    await storage.createAgentExecution({
      campaignId: options.campaign.id,
      projectId: options.project.id,
      userId: options.campaign.ownerId,
      stage: 'generation',
      provider: options.provider.id,
      model: options.provider.model,
      status: 'completed',
      promptTokens: summary.promptTokens,
      completionTokens: summary.completionTokens,
      totalTokens: summary.totalTokens,
      latencyMs: Date.now() - startedAt,
    });
    const updatedIdea = (await storage.getContentIdeaById(idea.id)) || idea;
    return { idea: updatedIdea, result };
  } catch (error) {
    const summary = runtime.summary();
    await storage.createAgentExecution({
      campaignId: options.campaign.id,
      projectId: options.project.id,
      userId: options.campaign.ownerId,
      stage: 'generation',
      provider: options.provider.id,
      model: options.provider.model,
      status: 'failed',
      promptTokens: summary.promptTokens,
      completionTokens: summary.completionTokens,
      totalTokens: summary.totalTokens,
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.name : 'generation_failed',
    });
    throw error;
  }
}

export async function reviewDraft(options: {
  campaign: Campaign;
  draftId: string;
  project: Project;
  provider: LlmProvider;
  signal?: AbortSignal;
}): Promise<QualityResult> {
  const generated = await storage.getGeneratedPostByDraftId(options.draftId);
  if (!generated || generated.campaignId !== options.campaign.id) {
    throw new AiValidationError('This draft does not belong to the campaign.');
  }
  const draft = await storage.getDraftById(options.draftId);
  if (!draft || draft.projectId !== options.project.id) {
    throw new AiValidationError('Draft not found.');
  }

  const [brand, sources] = await Promise.all([
    getBrandProfile(options.project.id),
    storage.getResearchSources(options.campaign.id),
  ]);
  const runtime = createAgentRuntime(options.provider, {
    signal: options.signal,
    maxCalls: 1,
  });
  const startedAt = Date.now();
  try {
    const result = await evaluateDraft({
      draft,
      campaign: options.campaign,
      brand,
      project: options.project,
      sources,
      runtime,
      joinUrl: `${config.appUrl}/join/${options.project.slug}`,
    });
    const summary = runtime.summary();
    await storage.createAgentExecution({
      campaignId: options.campaign.id,
      projectId: options.project.id,
      userId: options.campaign.ownerId,
      stage: 'quality',
      provider: options.provider.id,
      model: options.provider.model,
      status: 'completed',
      promptTokens: summary.promptTokens,
      completionTokens: summary.completionTokens,
      totalTokens: summary.totalTokens,
      latencyMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    const summary = runtime.summary();
    await storage.createAgentExecution({
      campaignId: options.campaign.id,
      projectId: options.project.id,
      userId: options.campaign.ownerId,
      stage: 'quality',
      provider: options.provider.id,
      model: options.provider.model,
      status: 'failed',
      promptTokens: summary.promptTokens,
      completionTokens: summary.completionTokens,
      totalTokens: summary.totalTokens,
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.name : 'quality_failed',
    });
    throw error;
  }
}

async function applyScheduleEvaluation(
  campaign: Campaign,
  now: Date
): Promise<CampaignSchedule[]> {
  const rows = await storage.getCampaignSchedules(campaign.id);
  const patches = evaluateScheduleStatuses(rows, config.aiMinScheduleGapMinutes, now);
  for (const patch of patches) {
    const current = rows.find((row) => row.id === patch.id);
    if (
      current &&
      (current.status !== patch.status || (current.reason || '') !== (patch.reason || ''))
    ) {
      await storage.updateCampaignSchedule(patch.id, {
        status: patch.status,
        reason: patch.reason ?? null,
      });
    }
  }
  return storage.getCampaignSchedules(campaign.id);
}

export async function recomputeSchedule(
  campaign: Campaign,
  now = new Date()
): Promise<CampaignSchedule[]> {
  const [ideas, generated] = await Promise.all([
    storage.getContentIdeas(campaign.id),
    storage.getGeneratedPosts(campaign.id),
  ]);
  const suggestions = buildSuggestedSchedule({
    campaign,
    ideas,
    generated,
    now,
    perPlatformGapMinutes: config.aiMinScheduleGapMinutes,
  });
  await storage.replaceSuggestedSchedules(campaign.id, suggestions);
  return applyScheduleEvaluation(campaign, now);
}

export async function overrideSchedule(options: {
  campaign: Campaign;
  scheduleId: string;
  scheduledFor: unknown;
  now?: Date;
}): Promise<CampaignSchedule[]> {
  const now = options.now ?? new Date();
  const rows = await storage.getCampaignSchedules(options.campaign.id);
  const schedule = rows.find((row) => row.id === options.scheduleId);
  if (!schedule) throw new AiValidationError('Scheduled post not found.');
  const scheduledFor = normalizeManualScheduleTime(options.scheduledFor, now);
  await storage.updateCampaignSchedule(schedule.id, {
    scheduledFor,
    source: 'manual',
    status: 'scheduled',
    reason: null,
  });
  return applyScheduleEvaluation(options.campaign, now);
}
