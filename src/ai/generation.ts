import { byId } from '../platforms/registry';
import { checkDraft } from '../posting/checks';
import { normalizeSubreddit } from '../posting/reddit/validate';
import { threadText } from '../posting/x/text';
import storage from '../lib/storage';
import type { Draft, Project } from '../types/index';
import type { AgentRuntime } from './execution';
import { AiValidationError } from './errors';
import { asString, parseJsonObject, requireObjectArray } from './json';
import { LlmError } from './llm';
import { generationPrompt } from './prompts';
import type {
  BrandProfile,
  Campaign,
  ContentIdea,
  ContentIdeaStatus,
  GeneratedPost,
  ResearchResult,
} from './types';

export interface GenerationIssue {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  variationIndex?: number;
}

export interface GenerationResult {
  drafts: Draft[];
  generated: GeneratedPost[];
  status: ContentIdeaStatus;
  issues: GenerationIssue[];
}

function projectContext(project: Project, joinUrl: string, approvedDrafts: Draft[]) {
  return {
    ownerName: project.repoOwner,
    repoName: project.repoName,
    repoFullName: project.repoFullName,
    isPrivate: project.isPrivate,
    joinUrl,
    roles: project.roles,
    description: project.description,
    approvedDrafts: approvedDrafts
      .filter((draft) => draft.status === 'approved' && draft.approvedText && draft.approvedAt)
      .map((draft) => ({
        platformId: draft.platformId,
        approvedText: draft.approvedText!,
        approvedAt: draft.approvedAt!,
      })),
  };
}

// One idea, one bounded model call, then ordinary Crewlink drafts. Drafts are
// never approved here and publishing is never called.
export async function generateForIdea(options: {
  campaign: Campaign;
  idea: ContentIdea;
  brand: BrandProfile | null;
  research: ResearchResult | null;
  project: Project;
  runtime: AgentRuntime;
  joinUrl: string;
  variationCount?: number;
  // Regenerating an idea continues the variation numbering instead of reusing it.
  variationOffset?: number;
}): Promise<GenerationResult> {
  const platform = byId(options.idea.platformId);
  if (!platform) {
    throw new AiValidationError(`Unsupported platform: ${options.idea.platformId}`);
  }
  const variationCount = Math.max(1, Math.min(3, options.variationCount ?? 2));
  const variationOffset = Math.max(0, Math.floor(options.variationOffset ?? 0));
  const prompt = generationPrompt({
    campaign: options.campaign,
    brand: options.brand,
    research: options.research,
    platformName: platform.name,
    platformId: platform.id,
    limit: platform.characterLimit,
    titleLimit: platform.titleLimit,
    topic: options.idea.topic,
    angle: options.idea.angle,
    day: options.idea.day,
    variationCount,
    joinUrl: options.joinUrl,
    redditSubreddit: options.campaign.redditSubreddit,
    countRule:
      platform.id === 'x'
        ? 'At least one variation should demonstrate a thread when the idea suits it.'
        : '',
  });

  const response = await options.runtime.complete({
    task: 'generation',
    system: prompt.system,
    user: prompt.user,
    json: true,
    maxOutputTokens: 2200,
    meta: {
      platformId: platform.id,
      platformName: platform.name,
      limit: platform.characterLimit,
      topic: options.idea.topic,
      angle: options.idea.angle,
      day: options.idea.day,
      variationCount,
      joinUrl: options.joinUrl,
      brandName: options.brand?.brandName || options.project.title,
      projectName: options.project.title,
      ctas: options.brand?.ctas || [],
      redditSubreddit: options.campaign.redditSubreddit || '',
      sources: options.research?.findings.map((finding) => ({
        title: finding.statement,
        url: finding.sourceUrls[0] || '',
      })) || [],
    },
  });

  const parsed = parseJsonObject(response.text);
  const rows = requireObjectArray(parsed.posts, 'posts', { min: 1, max: 6 });
  const allDrafts = await storage.getDraftsByProject(options.project.id);
  const context = projectContext(options.project, options.joinUrl, allDrafts);
  const drafts: Draft[] = [];
  const generated: GeneratedPost[] = [];
  const issues: GenerationIssue[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < rows.length && drafts.length < variationCount; index += 1) {
    const row = rows[index];
    let text = asString(row.text);
    let threadParts: string[] | undefined;

    if (platform.id === 'x' && Array.isArray(row.threadParts)) {
      threadParts = row.threadParts
        .filter((part): part is string => typeof part === 'string')
        .map((part) => part.trim())
        .filter(Boolean)
        .slice(0, 25);
      if (!threadParts.length) threadParts = undefined;
      if (threadParts) text = threadText(threadParts);
    }

    if (!text.trim()) {
      issues.push({
        code: 'empty_post',
        severity: 'error',
        message: 'The model returned an empty post.',
        variationIndex: index,
      });
      continue;
    }

    const key = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (seen.has(key)) {
      issues.push({
        code: 'repetitive_variation',
        severity: 'warning',
        message: 'A duplicate variation was ignored.',
        variationIndex: index,
      });
      continue;
    }
    seen.add(key);

    let title: string | undefined;
    let subreddit: string | undefined;
    let submissionType: 'self' | 'link' | undefined;
    if (platform.id === 'reddit') {
      title = asString(row.title) || options.idea.topic;
      subreddit = normalizeSubreddit(row.subreddit || options.campaign.redditSubreddit);
      // Only text submissions are generated. Link submissions need a checked URL.
      submissionType = 'self';
    }

    const checks = checkDraft(
      context,
      platform.id,
      text,
      threadParts,
      platform.id === 'reddit'
        ? { title, subreddit, submissionType, linkUrl: undefined }
        : undefined
    );
    const errors = checks.filter((check) => check.level === 'error');
    if (errors.length) {
      for (const check of errors) {
        issues.push({
          code: check.code,
          severity: 'error',
          message: check.message,
          variationIndex: index,
        });
      }
      continue;
    }

    const draft = await storage.createDraft({
      projectId: options.project.id,
      platformId: platform.id,
      text,
      threadParts,
      title,
      subreddit,
      submissionType,
      campaignId: options.campaign.id,
      contentIdeaId: options.idea.id,
    });
    const post = await storage.createGeneratedPost({
      campaignId: options.campaign.id,
      ideaId: options.idea.id,
      draftId: draft.id,
      platformId: platform.id,
      variationIndex: variationOffset + index,
    });
    drafts.push(draft);
    generated.push(post);
  }

  const status: ContentIdeaStatus = drafts.length
    ? issues.some((issue) => issue.severity === 'error')
      ? 'partial'
      : 'generated'
    : 'failed';

  await storage.updateContentIdea(options.idea.id, {
    status,
    note: issues.length
      ? issues
          .slice(0, 3)
          .map((issue) => issue.message)
          .join(' ')
      : null,
  });

  if (!drafts.length) {
    throw new LlmError(
      'malformed_response',
      issues[0]?.message ||
        'The generated content did not pass the existing Crewlink draft checks.'
    );
  }

  return { drafts, generated, status, issues };
}
