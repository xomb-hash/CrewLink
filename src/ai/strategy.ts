import { config } from '../config/index';
import type { AgentRuntime } from './execution';
import { AiValidationError } from './errors';
import { asObjectArray, asString, asStringArray, parseJsonObject } from './json';
import { LlmError } from './llm';
import { strategyPrompt } from './prompts';
import type { BrandProfile, Campaign, ResearchResult } from './types';

export interface StrategyIdea {
  day: number;
  platformId: string;
  topic: string;
  angle: string;
}

export interface StrategyPlan {
  name: string;
  objective: string;
  audience: string;
  themes: string[];
  postingFrequency: string;
  desiredOutcomes: string[];
  calendar: StrategyIdea[];
  notes?: string;
}

const clean = (value: unknown, max: number): string =>
  String(value || '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, max);

export async function runStrategyAgent(options: {
  campaign: Campaign;
  brand: BrandProfile | null;
  research: ResearchResult | null;
  runtime: AgentRuntime;
}): Promise<StrategyPlan> {
  const prompt = strategyPrompt(options.campaign, options.brand, options.research);
  const response = await options.runtime.complete({
    task: 'strategy',
    system: prompt.system,
    user: prompt.user,
    json: true,
    maxOutputTokens: 3000,
    meta: {
      name: options.campaign.name,
      brief: options.campaign.brief,
      objective: options.campaign.objective,
      audience: options.campaign.audience,
      platforms: options.campaign.platforms,
      durationDays: options.campaign.durationDays,
      themes: options.campaign.themes,
    },
  });

  const parsed = parseJsonObject(response.text);
  const allowedPlatforms = new Set(options.campaign.platforms);
  const maxIdeas = Math.min(
    config.aiMaxIdeasPerCampaign,
    options.campaign.durationDays * Math.max(1, options.campaign.platforms.length)
  );
  const seen = new Set<string>();
  const calendar: StrategyIdea[] = [];
  let skipped = 0;

  for (const row of asObjectArray(parsed.calendar, maxIdeas * 2)) {
    const day = Number(row.day);
    const platformId = asString(row.platformId);
    const topic = clean(row.topic, 300);
    const angle = clean(row.angle, 500);
    if (
      !Number.isInteger(day) ||
      day < 1 ||
      day > options.campaign.durationDays ||
      !allowedPlatforms.has(platformId) ||
      !topic
    ) {
      skipped += 1;
      continue;
    }
    const key = `${day}|${platformId}|${topic.toLowerCase()}`;
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    calendar.push({ day, platformId, topic, angle });
    if (calendar.length >= maxIdeas) break;
  }

  if (!calendar.length) {
    throw new LlmError(
      'malformed_response',
      'The strategy did not contain any valid calendar entries for the selected platforms.'
    );
  }

  const notes: string[] = [];
  if (skipped > 0) {
    notes.push(`${skipped} invalid or duplicate calendar entr${skipped === 1 ? 'y was' : 'ies were'} ignored.`);
  }

  // Every selected platform must appear once so the content step has nothing to
  // guess. This adds planning structure only; it does not invent facts.
  for (let index = 0; index < options.campaign.platforms.length; index += 1) {
    const platformId = options.campaign.platforms[index];
    if (calendar.some((idea) => idea.platformId === platformId)) continue;
    calendar.push({
      day: Math.min(options.campaign.durationDays, 1 + (index % options.campaign.durationDays)),
      platformId,
      topic: options.campaign.themes[0] || 'Project introduction',
      angle: 'An overview for this platform.',
    });
    notes.push(`Added a starter idea for ${platformId} because the model omitted it.`);
  }

  const themes = asStringArray(parsed.themes, 10);
  const outcomes = asStringArray(parsed.desiredOutcomes, 10);
  const name = clean(parsed.name, 160) || options.campaign.name || 'Campaign plan';
  const objective =
    clean(parsed.objective, 600) || options.campaign.objective || options.campaign.brief;
  const audience = clean(parsed.audience, 600) || options.campaign.audience;

  if (!name) throw new AiValidationError('The strategy needs a campaign name.');

  calendar.sort(
    (a, b) =>
      a.day - b.day ||
      options.campaign.platforms.indexOf(a.platformId) -
        options.campaign.platforms.indexOf(b.platformId)
  );

  return {
    name,
    objective,
    audience,
    themes: themes.length ? themes : options.campaign.themes,
    postingFrequency:
      clean(parsed.postingFrequency, 300) ||
      `${options.campaign.platforms.length} platform(s), distributed across ${options.campaign.durationDays} day(s)`,
    desiredOutcomes: outcomes,
    calendar,
    notes: notes.length ? notes.join(' ') : undefined,
  };
}
