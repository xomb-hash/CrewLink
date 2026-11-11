import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from '../llm';

// Deterministic, network-free provider. It exists for tests and for explicit
// local exploration (AI_PROVIDER=mock). It never claims to be a real model and
// never reads private data.

export interface MockProviderOptions {
  responses?: string[];
  delayMs?: number;
}

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const meta = (request: LlmRequest): Record<string, unknown> =>
  request.meta && typeof request.meta === 'object' ? request.meta : {};

interface MockSource {
  title: string;
  url: string;
  publisher?: string;
}

function mockSources(request: LlmRequest): MockSource[] {
  const raw = meta(request).sources;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      title: text(item.title, 'Untitled source'),
      url: text(item.url),
      publisher: typeof item.publisher === 'string' ? item.publisher : undefined,
    }))
    .filter((item) => /^https?:\/\//i.test(item.url));
}

function researchResponse(request: LlmRequest): string {
  const data = meta(request);
  const sources = mockSources(request);
  const brief = text(data.brief, text(data.objective, 'the project'));
  const findings = sources.slice(0, 4).map((source) => ({
    statement: `The supplied source "${source.title}" is relevant background for ${brief}.`,
    sourceUrls: [source.url],
    verified: true,
  }));
  const assumptions: string[] = [];
  if (!sources.length) {
    assumptions.push('No search provider was configured, so no external sources were retrieved.');
    assumptions.push('Trend, volume and engagement data are unavailable.');
  } else {
    assumptions.push('This summary covers only the listed sources, not live trend or engagement data.');
  }
  return JSON.stringify({
    summary: sources.length
      ? `Background for ${brief}, based on ${sources.length} retrieved source(s).`
      : `Planning background for ${brief}. No external sources were retrieved.`,
    findings,
    opportunities: [
      'Explain the problem the project solves for its audience.',
      'Share one concrete technical decision and why it was made.',
      'Invite questions from the people most likely to benefit.',
    ],
    assumptions,
  });
}

const THEMES = [
  'the problem being solved',
  'how the project works',
  'a technical decision',
  'the build journey',
  'what comes next',
];

const ANGLES: Record<string, string> = {
  linkedin: 'professional context and the decision behind it',
  x: 'a short, concrete observation',
  reddit: 'an honest question for the community',
  bluesky: 'a conversational note',
  telegram: 'a direct announcement',
  slack: 'a workspace update',
};

function strategyResponse(request: LlmRequest): string {
  const data = meta(request);
  const platforms = list(data.platforms);
  const duration = Math.max(1, Math.min(30, Number(data.durationDays) || 7));
  const suppliedThemes = list(data.themes);
  const themes = suppliedThemes.length ? suppliedThemes : THEMES;
  const calendar: Array<{ day: number; platformId: string; topic: string; angle: string }> = [];
  for (let day = 1; day <= duration; day += 1) {
    for (let index = 0; index < platforms.length; index += 1) {
      const platformId = platforms[index];
      const topic = themes[(day - 1 + index) % themes.length];
      calendar.push({
        day,
        platformId,
        topic,
        angle: ANGLES[platformId] || 'a clear explanation',
      });
      if (calendar.length >= 60) break;
    }
    if (calendar.length >= 60) break;
  }
  return JSON.stringify({
    name: text(data.name) || 'Campaign plan',
    objective: text(data.objective, text(data.brief, 'Share the project')),
    audience: text(data.audience, 'People interested in the project'),
    themes,
    postingFrequency: `${platforms.length || 1} platform(s), one idea per platform per day`,
    desiredOutcomes: [
      'A clear explanation of the project',
      'Consistent platform-appropriate posts',
      'An invitation for the audience to join',
    ],
    calendar,
  });
}

function generationText(
  platformId: string,
  topic: string,
  angle: string,
  day: number,
  variationIndex: number,
  joinUrl: string,
  projectName: string,
  cta: string
): { text: string; threadParts?: string[] } {
  const hook = `Day ${day}: ${topic}`;
  const ctaLine = cta || 'Follow along if this is useful.';
  if (platformId === 'x') {
    if (variationIndex % 2 === 1) {
      const parts = [
        hook,
        `A practical note on ${angle}.`,
        `${ctaLine} ${joinUrl}`,
      ];
      return { text: parts.join('\n\n'), threadParts: parts };
    }
    return { text: `${hook}. ${joinUrl}` };
  }
  if (platformId === 'reddit') {
    return {
      text: `${angle}\n\nWe are building ${projectName} in public. ${ctaLine}\n\n${joinUrl}`,
    };
  }
  if (platformId === 'bluesky') {
    return { text: `${hook}. ${joinUrl}` };
  }
  if (platformId === 'linkedin') {
    return {
      text: `${hook}\n\n${angle}\n\nWe are sharing progress on ${projectName}. ${ctaLine}\n\n${joinUrl}`,
    };
  }
  if (platformId === 'telegram' || platformId === 'slack') {
    return { text: `${hook}\n\n${angle}\n\n${ctaLine}\n${joinUrl}` };
  }
  return { text: `${hook}\n\n${angle}\n\n${ctaLine} ${joinUrl}` };
}

function generationResponse(request: LlmRequest): string {
  const data = meta(request);
  const platformId = text(data.platformId, 'linkedin');
  const topic = text(data.topic, 'the project');
  const angle = text(data.angle, 'the decision behind it');
  const day = Math.max(1, Number(data.day) || 1);
  const joinUrl = text(data.joinUrl);
  const projectName = text(data.brandName, text(data.projectName, 'the project'));
  const ctas = list(data.ctas);
  const count = Math.max(1, Math.min(3, Number(data.variationCount) || 1));
  const posts = [];
  for (let index = 0; index < count; index += 1) {
    const variation = generationText(
      platformId,
      topic,
      angle,
      day,
      index,
      joinUrl,
      projectName,
      ctas[index % Math.max(1, ctas.length)] || ''
    );
    if (platformId === 'reddit') {
      posts.push({
        text: variation.text,
        title: `${topic}: ${angle}`.slice(0, 300),
        subreddit: text(data.redditSubreddit),
        submissionType: 'self',
      });
    } else if (variation.threadParts) {
      posts.push({ text: variation.text, threadParts: variation.threadParts });
    } else {
      posts.push({ text: variation.text });
    }
  }
  return JSON.stringify({ posts });
}

function qualityResponse(request: LlmRequest): string {
  const data = meta(request);
  const staticIssues = Array.isArray(data.staticIssues)
    ? data.staticIssues.filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
      )
    : [];
  const body = text(data.text);
  const issues = staticIssues.map((issue) => ({
    code: text(issue.code, 'static_check'),
    severity:
      issue.severity === 'error' || issue.severity === 'warning' ? issue.severity : 'info',
    message: text(issue.message, 'A static check reported an issue.'),
  }));
  if (/\b(revolutionary|game[- ]changing|guaranteed|world[- ]class|best ever)\b/i.test(body)) {
    issues.push({
      code: 'promotional_language',
      severity: 'warning',
      message: 'Some wording is strongly promotional; make the claim concrete or remove it.',
    });
  }
  if (!mockSources(request).length) {
    issues.push({
      code: 'no_retrieved_sources',
      severity: 'info',
      message: 'No retrieved sources were available, so factual claims cannot be verified.',
    });
  }
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  return JSON.stringify({
    score: Math.max(0, 88 - errors * 20 - warnings * 5),
    issues,
    improvements: [
      'Lead with one concrete detail instead of a general claim.',
      'Keep the join link and any source references intact.',
    ],
    sourceUrls: mockSources(request).map((source) => source.url),
  });
}


function analyticsResponse(request: LlmRequest): string {
  const data = meta(request);
  const facts = data.facts && typeof data.facts === 'object' ? (data.facts as Record<string, unknown>) : {};
  const catalogRaw = Array.isArray(facts.factCatalog) ? facts.factCatalog : [];
  const catalog = catalogRaw.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
  );
  const fact = (id: string): string | null =>
    catalog.some((item) => item.id === id) ? `{{fact:${id}}}` : null;
  const need = (...ids: string[]): string[] => ids.filter((id) => Boolean(fact(id)));
  const platformsRaw = Array.isArray(facts.platforms) ? facts.platforms : [];
  const platforms = platformsRaw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      platformId: text(item.platformId),
      posts: Number(item.posts) || 0,
      engagement: typeof item.engagement === 'number' ? item.engagement : null,
    }))
    .filter((item) => item.platformId && item.engagement !== null)
    .sort((left, right) => (right.engagement ?? 0) - (left.engagement ?? 0));
  const sample = facts.sample && typeof facts.sample === 'object' ? (facts.sample as Record<string, unknown>) : {};
  const measured = Number(sample.postsWithMetrics) || 0;

  const summaryParts: string[] = [];
  if (fact('sample.measuredPosts')) {
    summaryParts.push(`Across ${fact('sample.measuredPosts')} measured post(s)`);
  } else {
    summaryParts.push('Across the measured posts');
  }
  if (fact('range.start') && fact('range.end')) {
    summaryParts.push(`from ${fact('range.start')} to ${fact('range.end')}`);
  }
  summaryParts.push(
    'the stored platform metrics support only descriptive observations. This is an advisory summary, not a significance test.'
  );

  const findings = platforms.slice(0, 3).map((platform) => {
    const engagementId = `platform.${platform.platformId}.engagement`;
    const postsId = `platform.${platform.platformId}.posts`;
    const factIds = need(engagementId, postsId);
    return {
      statement: `${text(platform.platformId)} produced ${fact(engagementId) || 'measured engagement'} across ${
        fact(postsId) || 'measured posts'
      }.`,
      factIds,
      confidence: 'low',
      caveat: 'This is a descriptive count from stored facts, not evidence of causation.',
    };
  });

  const best = platforms[0];
  const recommendations = best
    ? [
        {
          action: 'Review the format that produced the most measured engagement and reuse it in the next campaign.',
          rationale: `The selected period has measurable engagement on ${text(best.platformId)}, so its best-performing format is the safest starting point.`,
          evidence: `${text(best.platformId)} contributed ${
            fact(`platform.${best.platformId}.engagement`) || 'measured engagement'
          }.`,
          factIds: need(`platform.${best.platformId}.engagement`, `platform.${best.platformId}.posts`),
          platforms: [best.platformId],
          priority: 'medium',
        },
      ]
    : [];

  const comparisons: Array<Record<string, unknown>> = [];
  if (fact('comparison.engagement') && fact('comparison.engagement.current') && fact('comparison.engagement.previous')) {
    const current = Number(
      (catalog.find((item) => item.id === 'comparison.engagement.current')?.value as number) || 0
    );
    const previous = Number(
      (catalog.find((item) => item.id === 'comparison.engagement.previous')?.value as number) || 0
    );
    const direction = current === previous ? 'flat' : current > previous ? 'up' : 'down';
    comparisons.push({
      metric: 'engagement',
      direction,
      note: 'Engagement changed by {{fact:comparison.engagement}} versus the previous period.',
      factId: 'comparison.engagement',
    });
  }

  const formatsRaw = Array.isArray(facts.formats) ? facts.formats : [];
  const topFormats = formatsRaw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => text(item.contentType))
    .filter(Boolean)
    .slice(0, 3);
  const topicsRaw = Array.isArray(facts.topics) ? facts.topics : [];
  const topTopics = topicsRaw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => text(item.topic))
    .filter(Boolean)
    .slice(0, 3);

  const timing =
    facts.timing && typeof facts.timing === 'object' ? (facts.timing as Record<string, unknown>) : {};
  let postingTime: Record<string, unknown> | null = null;
  if (timing.sufficientData === true) {
    const weekday = text(timing.bestWeekday);
    const id = `timing.weekday.${weekday}.averageEngagement`;
    if (weekday && fact(id)) {
      postingTime = {
        recommendation: `Consider testing more posts on ${weekday} and compare the result with a quiet weekday. This is a hypothesis, not a proven optimal time.`,
        factIds: [id],
      };
    }
  }

  return JSON.stringify({
    summary: summaryParts.join(' '),
    findings,
    recommendations,
    comparisons,
    topFormats,
    topTopics,
    postingTime,
    insufficientData: measured < 3,
  });
}

export function defaultMockResponse(request: LlmRequest): string {
  switch (request.task) {
    case 'research':
      return researchResponse(request);
    case 'strategy':
      return strategyResponse(request);
    case 'generation':
      return generationResponse(request);
    case 'quality':
      return qualityResponse(request);
    case 'analytics':
      return analyticsResponse(request);
    default:
      return JSON.stringify({});
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LlmError('aborted', 'The AI request was cancelled.'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LlmError('aborted', 'The AI request was cancelled.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class MockLlmProvider implements LlmProvider {
  readonly id = 'mock';
  readonly model = 'mock-deterministic';
  readonly configured = true;
  readonly calls: LlmRequest[] = [];
  private readonly queue: string[] = [];
  private readonly failures: LlmError[] = [];
  private readonly delayMs: number;

  constructor(options: MockProviderOptions = {}) {
    if (options.responses) this.queue.push(...options.responses);
    this.delayMs = options.delayMs ?? 0;
  }

  enqueue(...responses: string[]): void {
    this.queue.push(...responses);
  }

  failNext(error: LlmError): void {
    this.failures.push(error);
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    const started = Date.now();
    if (this.delayMs > 0) await sleep(this.delayMs, request.signal);
    const failure = this.failures.shift();
    if (failure) throw failure;
    const response = this.queue.shift() ?? defaultMockResponse(request);
    const promptChars = request.system.length + request.user.length;
    const promptTokens = Math.ceil(promptChars / 4);
    const completionTokens = Math.ceil(response.length / 4);
    return {
      text: response,
      provider: this.id,
      model: this.model,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      latencyMs: Date.now() - started,
    };
  }
}

export function createMockLlmProvider(options: MockProviderOptions = {}): MockLlmProvider {
  return new MockLlmProvider(options);
}
