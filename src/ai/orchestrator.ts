import { config } from '../config/index';
import storage from '../lib/storage';
import type { Project, User } from '../types/index';
import { collectCampaignAnalytics } from './analytics';
import { getBrandProfile } from './brand';
import { getCampaignDetail } from './campaigns';
import {
  AiConflictError,
  AiForbiddenError,
  AiNotFoundError,
  AiUnavailableError,
} from './errors';
import { createAgentRuntime, type AgentRuntime } from './execution';
import { generateForIdea, type GenerationIssue } from './generation';
import { LlmError, type LlmProvider } from './llm';
import { getLlmProvider } from './provider';
import { evaluateDraft } from './quality';
import {
  researchFallback,
  runResearchAgent,
  type OwnerSourceInput,
} from './research';
import {
  buildSuggestedSchedule,
  evaluateScheduleStatuses,
  todayInZone,
} from './scheduling';
import {
  createResearchGateways,
  type ResearchGateway,
} from './search';
import { runStrategyAgent } from './strategy';
import type {
  Campaign,
  CampaignDetail,
  CampaignStatus,
  CampaignTask,
  CampaignTaskKind,
  ContentIdea,
  ResearchResult,
} from './types';

export interface RunCampaignOptions {
  campaignId: string;
  user: User;
  project: Project;
  // Tests inject gateways and a provider. Production uses the configured ones.
  gateways?: ResearchGateway[];
  provider?: LlmProvider;
  ownerSources?: OwnerSourceInput[];
  signal?: AbortSignal;
  now?: Date;
}

export interface RunCampaignResult {
  campaign: Campaign;
  detail: CampaignDetail;
  llm: {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latencyMs: number;
  };
}

const STAGE_KINDS: CampaignTaskKind[] = [
  'research',
  'strategy',
  'generation',
  'quality',
  'scheduling',
];

// One run per campaign in this process. The status check below also refuses a
// campaign another instance marked running recently.
const runningCampaigns = new Set<string>();

function isStopError(error: unknown): boolean {
  return (
    error instanceof LlmError &&
    (error.code === 'aborted' ||
      error.code === 'limit_reached' ||
      error.code === 'token_limit')
  );
}

// Only typed, already-sanitized messages reach the task and execution records.
function safeMessage(error: unknown): string {
  if (
    error instanceof LlmError ||
    error instanceof AiConflictError ||
    error instanceof AiNotFoundError ||
    error instanceof AiForbiddenError
  ) {
    return error.message;
  }
  if (error instanceof Error && error.name === 'AiValidationError') return error.message;
  return 'The stage failed unexpectedly. Check the server log.';
}

function errorCode(error: unknown): string {
  return error instanceof LlmError ? error.code : 'stage_error';
}

interface RuntimeSnapshot {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function snapshot(runtime: AgentRuntime): RuntimeSnapshot {
  return {
    promptTokens: runtime.promptTokens,
    completionTokens: runtime.completionTokens,
    totalTokens: runtime.totalTokens,
  };
}

// The orchestrator owns sequencing and limits only. Every model call goes
// through the runtime, and every product of the run is an ordinary Crewlink
// draft that still needs the existing approval and publishing gates.
export async function runCampaign(
  options: RunCampaignOptions
): Promise<RunCampaignResult> {
  const campaign = await storage.getCampaignById(options.campaignId);
  if (!campaign) throw new AiNotFoundError('Campaign not found.');
  if (campaign.projectId !== options.project.id) {
    throw new AiForbiddenError('This campaign does not belong to that project.');
  }
  if (campaign.ownerId !== String(options.user.id)) {
    throw new AiForbiddenError('Only the owner who created this campaign can run it.');
  }
  if (
    runningCampaigns.has(campaign.id) ||
    (campaign.status === 'running' &&
      Date.now() - Date.parse(campaign.updatedAt) < config.aiExecutionBudgetMs * 2)
  ) {
    throw new AiConflictError('This campaign is already running.');
  }

  const provider = options.provider ?? getLlmProvider();
  if (!provider.configured) {
    throw new AiUnavailableError(
      `The AI provider "${provider.id}" is not configured. Add its server-side API key or choose another provider.`
    );
  }

  runningCampaigns.add(campaign.id);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), config.aiExecutionBudgetMs);
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();

  const runtime = createAgentRuntime(provider, {
    signal: controller.signal,
    maxCalls: config.aiMaxLlmCallsPerCampaign,
  });
  const now = options.now ?? new Date();
  const tasks = new Map<CampaignTaskKind, CampaignTask>();

  try {
    await storage.updateCampaign(campaign.id, { status: 'running' });
    for (const kind of STAGE_KINDS) {
      tasks.set(
        kind,
        await storage.createCampaignTask({
          campaignId: campaign.id,
          kind,
          status: 'pending',
          detail: 'Waiting to start.',
        })
      );
    }

    const project = (await storage.getProjectById(campaign.projectId)) || options.project;
    const brand = await getBrandProfile(project.id);
    const joinUrl = `${config.appUrl}/join/${project.slug}`;

    const runStage = async <T>(
      kind: CampaignTaskKind,
      llm: boolean,
      fn: () => Promise<{ value: T; detail: string }>
    ): Promise<T> => {
      const task = tasks.get(kind)!;
      const startedAt = new Date();
      const before = snapshot(runtime);
      await storage.updateCampaignTask(task.id, {
        status: 'running',
        startedAt: startedAt.toISOString(),
        detail: 'Running.',
      });
      try {
        const { value, detail } = await fn();
        const after = snapshot(runtime);
        await storage.updateCampaignTask(task.id, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          detail,
        });
        await storage.createAgentExecution({
          campaignId: campaign.id,
          projectId: project.id,
          userId: String(options.user.id),
          stage: kind,
          provider: llm ? provider.id : 'crewlink',
          model: llm ? provider.model : 'deterministic',
          status: 'completed',
          promptTokens: after.promptTokens - before.promptTokens,
          completionTokens: after.completionTokens - before.completionTokens,
          totalTokens: after.totalTokens - before.totalTokens,
          latencyMs: Date.now() - startedAt.getTime(),
        });
        return value;
      } catch (error) {
        const after = snapshot(runtime);
        await storage.updateCampaignTask(task.id, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          errorCode: errorCode(error),
          errorMessage: safeMessage(error),
        });
        await storage.createAgentExecution({
          campaignId: campaign.id,
          projectId: project.id,
          userId: String(options.user.id),
          stage: kind,
          provider: llm ? provider.id : 'crewlink',
          model: llm ? provider.model : 'deterministic',
          status: 'failed',
          promptTokens: after.promptTokens - before.promptTokens,
          completionTokens: after.completionTokens - before.completionTokens,
          totalTokens: after.totalTokens - before.totalTokens,
          latencyMs: Date.now() - startedAt.getTime(),
          errorCode: errorCode(error),
        });
        throw error;
      }
    };

    // 1. Research. A model or search failure keeps the campaign moving with an
    // explicit fallback that says no summary was generated.
    let research: ResearchResult | null = null;
    let sources: Awaited<ReturnType<typeof storage.getResearchSources>> = [];
    try {
      const outcome = await runStage('research', true, async () => {
        const gateways = options.gateways ?? createResearchGateways();
        const result = await runResearchAgent({
          campaign,
          brand,
          runtime,
          gateways,
          ownerSources: options.ownerSources,
          signal: controller.signal,
        });
        return {
          value: result,
          detail: result.result.summary.slice(0, 400),
        };
      });
      research = outcome.result;
      sources = await storage.replaceResearchSources(campaign.id, outcome.sources);
      await storage.updateCampaign(campaign.id, { research });
    } catch (error) {
      if (isStopError(error)) throw error;
      research = researchFallback([], `Research failed: ${safeMessage(error)}`);
      sources = [];
      await storage.replaceResearchSources(campaign.id, []);
      await storage.updateCampaign(campaign.id, { research });
      const task = tasks.get('research')!;
      await storage.updateCampaignTask(task.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        detail: 'Research failed; the campaign continued with planning notes only.',
      });
    }

    // 2. Strategy. Existing ideas are reused so a retry never duplicates a plan.
    let ideas = await storage.getContentIdeas(campaign.id);
    if (ideas.length) {
      const task = tasks.get('strategy')!;
      await storage.updateCampaignTask(task.id, {
        status: 'skipped',
        completedAt: new Date().toISOString(),
        detail: 'Existing calendar and strategy reused.',
      });
    } else {
      const plan = await runStage('strategy', true, async () => {
        const value = await runStrategyAgent({
          campaign,
          brand,
          research,
          runtime,
        });
        return { value, detail: `Planned ${value.calendar.length} content idea(s).` };
      });
      const startDate =
        campaign.startDate || todayInZone(campaign.timezone || 'UTC', now);
      const updated = await storage.updateCampaign(campaign.id, {
        name: plan.name,
        objective: plan.objective,
        audience: plan.audience,
        themes: plan.themes,
        postingFrequency: plan.postingFrequency,
        desiredOutcomes: plan.desiredOutcomes.length
          ? plan.desiredOutcomes
          : campaign.desiredOutcomes,
        startDate,
        strategyNotes: plan.notes ?? null,
      });
      if (updated) Object.assign(campaign, updated);
      for (const idea of plan.calendar.slice(0, config.aiMaxIdeasPerCampaign)) {
        await storage.createContentIdea({
          campaignId: campaign.id,
          day: idea.day,
          platformId: idea.platformId,
          topic: idea.topic,
          angle: idea.angle,
        });
      }
      ideas = await storage.getContentIdeas(campaign.id);
    }

    // 3. Generation. One bounded call per idea; one invalid idea never stops the
    // rest, but a limit or timeout stops the loop deliberately.
    let generationFailures = 0;
    const generationIssues: GenerationIssue[] = [];
    const existingGenerated = await storage.getGeneratedPosts(campaign.id);
    const generatedIdeaIds = new Set(existingGenerated.map((post) => post.ideaId));
    let newDraftCount = 0;
    try {
      await runStage('generation', true, async () => {
        const targets = ideas.slice(0, config.aiMaxIdeasPerCampaign);
        for (const idea of targets) {
          if (generatedIdeaIds.has(idea.id)) continue;
          try {
            const result = await generateForIdea({
              campaign,
              idea,
              brand,
              research,
              project,
              runtime,
              joinUrl,
              variationCount: config.aiVariationsPerIdea,
            });
            newDraftCount += result.drafts.length;
            generationIssues.push(...result.issues);
          } catch (error) {
            if (isStopError(error)) throw error;
            generationFailures += 1;
            await storage.updateContentIdea(idea.id, {
              status: 'failed',
              note: safeMessage(error).slice(0, 300),
            });
          }
        }
        return {
          value: undefined,
          detail: `Generated ${newDraftCount} draft(s) from ${targets.length} idea(s).${
            generationFailures ? ` ${generationFailures} idea(s) failed.` : ''
          }`,
        };
      });
    } catch (error) {
      if (!isStopError(error)) throw error;
      generationFailures += 1;
    }

    let generated = await storage.getGeneratedPosts(campaign.id);
    ideas = await storage.getContentIdeas(campaign.id);
    const unresolvedIdeas = ideas.filter((idea) => idea.status !== 'generated').length;

    // 4. Quality. Static checks always run; the model review is advisory and its
    // failure never blocks the draft from reaching normal review.
    if (generated.length) {
      let checked = 0;
      let qualityFailures = 0;
      try {
        await runStage('quality', true, async () => {
          for (const post of generated) {
            if (post.quality) continue;
            const draft = await storage.getDraftById(post.draftId);
            if (!draft) continue;
            try {
              const result = await evaluateDraft({
                draft,
                campaign,
                brand,
                project,
                sources,
                runtime,
                joinUrl,
              });
              if (result) checked += 1;
            } catch (error) {
              if (isStopError(error)) throw error;
              qualityFailures += 1;
            }
          }
          return {
            value: undefined,
            detail: `Reviewed ${checked} draft(s).${
              qualityFailures ? ` ${qualityFailures} review(s) failed.` : ''
            }`,
          };
        });
      } catch (error) {
        if (!isStopError(error)) throw error;
      }
    } else {
      const task = tasks.get('quality')!;
      await storage.updateCampaignTask(task.id, {
        status: 'skipped',
        completedAt: new Date().toISOString(),
        detail: 'No drafts were generated.',
      });
    }

    // 5. Scheduling suggestions. Heuristic spacing only; existing manual times
    // are preserved by the storage layer and are never overwritten here.
    let schedulingFailed = false;
    try {
      await runStage('scheduling', false, async () => {
        generated = await storage.getGeneratedPosts(campaign.id);
        const suggestions = buildSuggestedSchedule({
          campaign,
          ideas,
          generated,
          now,
          perPlatformGapMinutes: config.aiMinScheduleGapMinutes,
        });
        const rows = await storage.replaceSuggestedSchedules(campaign.id, suggestions);
        const patches = evaluateScheduleStatuses(
          rows,
          config.aiMinScheduleGapMinutes,
          now
        );
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
        return {
          value: undefined,
          detail: `${suggestions.length} schedule suggestion(s) prepared. These are heuristic, not optimal times.`,
        };
      });
    } catch (error) {
      if (isStopError(error)) throw error;
      schedulingFailed = true;
    }

    // 6. Analytics from existing Crewlink records only.
    try {
      await collectCampaignAnalytics(
        (await storage.getCampaignById(campaign.id)) || campaign
      );
    } catch {
      // Analytics is derived and must never fail a campaign.
    }

    const status: CampaignStatus =
      generated.length === 0
        ? 'failed'
        : unresolvedIdeas > 0 ||
            generationFailures > 0 ||
            generationIssues.some((issue) => issue.severity === 'error') ||
            schedulingFailed ||
            controller.signal.aborted
          ? 'partial'
          : 'ready';

    const finalCampaign =
      (await storage.updateCampaign(campaign.id, { status })) ||
      (await storage.getCampaignById(campaign.id));
    if (!finalCampaign) throw new AiNotFoundError('Campaign not found.');

    return {
      campaign: finalCampaign,
      detail: await getCampaignDetail(campaign.id),
      llm: runtime.summary(),
    };
  } catch (error) {
    // Fatal stage. Keep any drafts that were already created, and never leave a
    // task in `pending` or the campaign in `running`.
    const generated = await storage.getGeneratedPosts(campaign.id).catch(() => []);
    await storage
      .updateCampaign(campaign.id, { status: generated.length ? 'partial' : 'failed' })
      .catch(() => null);
    const currentTasks = await storage.getCampaignTasks(campaign.id).catch(() => []);
    for (const task of currentTasks) {
      if (task.status !== 'pending' && task.status !== 'running') continue;
      await storage
        .updateCampaignTask(task.id, {
          status: 'skipped',
          completedAt: new Date().toISOString(),
          detail: 'Stopped because an earlier stage failed.',
        })
        .catch(() => null);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    runningCampaigns.delete(campaign.id);
  }
}

// Used by the API layer after a single-idea retry so the task list shows the
// real reason rather than a stale pending row.
export async function markIdeaGenerationFailed(
  campaignId: string,
  idea: ContentIdea,
  message: string
): Promise<void> {
  await storage.updateContentIdea(idea.id, {
    status: 'failed',
    note: message.slice(0, 300),
  });
  await storage.createCampaignTask({
    campaignId,
    kind: 'generation',
    status: 'failed',
    detail: message.slice(0, 500),
  });
}
