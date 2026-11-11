import { LlmError } from '../ai/llm';
import { METRIC_LABELS, type MetricKey } from './metricsKeys';
import { percentChange } from './metrics';
import type {
  AnalyticsFact,
  AnalyticsPostRow,
  AnalyticsRange,
  CampaignPerformance,
  FactCompleteness,
  MetricAggregate,
  OverviewResult,
  TimingResult,
  TopContentResult,
} from './types';

// Deterministic facts are the only source of numbers an AI insight may show.
// The model refers to a fact by id; the backend renders the value. A model-authored
// digit or percent sign outside a placeholder is rejected.

const PLACEHOLDER = /\{\{fact:([a-zA-Z0-9_.:-]+)\}\}/g;
const RAW_NUMBER = /[0-9]/;
const CURRENCY_OR_PERCENT = /[%$€£]/;

export interface FactCatalogInput {
  range: AnalyticsRange;
  overview: OverviewResult;
  posts: AnalyticsPostRow[];
  campaigns: CampaignPerformance[];
  timing: TimingResult;
  top: TopContentResult;
  sample: {
    publishedPosts: number;
    postsWithMetrics: number;
    platforms: number;
    campaigns: number;
    days: number;
  };
}

function count(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function completenessOf(aggregate: MetricAggregate): FactCompleteness {
  if (aggregate.value === null) return 'unavailable';
  return aggregate.complete ? 'complete' : 'partial';
}

function makeFact(input: {
  id: string;
  label: string;
  value: number | null;
  unit: AnalyticsFact['unit'];
  definition: string;
  completeness?: FactCompleteness;
  metric?: MetricKey;
  platformId?: string;
  postId?: string;
  campaignId?: string;
  sampleSize?: number;
  text?: string;
}): AnalyticsFact {
  const formatted =
    input.unit === 'text'
      ? input.text ?? null
      : input.value === null
        ? null
        : input.unit === 'percent' || input.unit === 'rate'
          ? `${input.value}%`
          : count(input.value);
  return {
    id: input.id,
    label: input.label,
    value: input.value,
    text: input.text,
    formatted,
    unit: input.unit,
    completeness: input.completeness ?? (input.value !== null || input.text ? 'complete' : 'unavailable'),
    definition: input.definition,
    metric: input.metric,
    platformId: input.platformId,
    postId: input.postId,
    campaignId: input.campaignId,
    sampleSize: input.sampleSize,
  };
}

export function factIsAvailable(fact: AnalyticsFact | undefined): fact is AnalyticsFact {
  return Boolean(fact && (fact.value !== null || fact.text) && fact.formatted !== null);
}

export function buildFactCatalog(input: FactCatalogInput): AnalyticsFact[] {
  const facts: AnalyticsFact[] = [];
  const add = (fact: AnalyticsFact) => {
    if (factIsAvailable(fact)) facts.push(fact);
  };

  add(
    makeFact({
      id: 'range.start',
      label: 'Period start',
      value: null,
      text: input.range.from,
      unit: 'text',
      definition: 'Inclusive start date of the selected reporting period.',
    })
  );
  add(
    makeFact({
      id: 'range.end',
      label: 'Period end',
      value: null,
      text: input.range.to,
      unit: 'text',
      definition: 'Inclusive end date of the selected reporting period.',
    })
  );
  add(
    makeFact({
      id: 'range.days',
      label: 'Period days',
      value: input.range.days,
      unit: 'count',
      definition: 'Number of calendar days in the selected period.',
    })
  );

  add(
    makeFact({
      id: 'sample.publishedPosts',
      label: 'Published posts',
      value: input.sample.publishedPosts,
      unit: 'count',
      definition: 'Published Crewlink posts in the selected period, including posts whose platform exposes no metrics.',
      sampleSize: input.sample.publishedPosts,
    })
  );
  add(
    makeFact({
      id: 'sample.measuredPosts',
      label: 'Posts with metrics',
      value: input.sample.postsWithMetrics,
      unit: 'count',
      definition: 'Published posts for which at least one platform metric was stored.',
      sampleSize: input.sample.postsWithMetrics,
    })
  );
  add(
    makeFact({
      id: 'sample.platforms',
      label: 'Platforms with data',
      value: input.sample.platforms,
      unit: 'count',
      definition: 'Platforms with at least one measured post in the period.',
    })
  );
  add(
    makeFact({
      id: 'sample.campaigns',
      label: 'Campaigns with published posts',
      value: input.sample.campaigns,
      unit: 'count',
      definition: 'AI campaigns with at least one published post.',
    })
  );

  for (const key of Object.keys(input.overview.totals) as MetricKey[]) {
    const aggregate = input.overview.totals[key];
    if (!aggregate || aggregate.value === null) continue;
    add(
      makeFact({
        id: `total.${key}`,
        label: `Total ${METRIC_LABELS[key]}`,
        value: aggregate.value,
        unit: 'count',
        metric: key,
        completeness: completenessOf(aggregate),
        definition: `Sum of platform-reported ${METRIC_LABELS[key]} across measured posts. Incomplete when some posts did not return it.`,
        sampleSize: aggregate.withMetric,
      })
    );
  }
  if (input.overview.engagement.value !== null) {
    add(
      makeFact({
        id: 'total.engagement',
        label: 'Total engagement actions',
        value: input.overview.engagement.value,
        unit: 'count',
        completeness: completenessOf(input.overview.engagement),
        definition:
          'Crewlink-calculated sum of each platform’s available engagement actions. Partial when an action was not returned; never a platform-reported total.',
        sampleSize: input.overview.engagement.withMetric,
      })
    );
  }
  if (input.overview.engagementRate) {
    add(
      makeFact({
        id: 'total.engagementRate',
        label: 'Engagement rate',
        value: input.overview.engagementRate.value,
        unit: 'rate',
        definition: input.overview.engagementRate.label,
        sampleSize: input.sample.postsWithMetrics,
      })
    );
  }

  for (const platform of input.overview.platforms) {
    if (platform.posts === 0) continue;
    add(
      makeFact({
        id: `platform.${platform.platformId}.posts`,
        label: `${platform.name} posts`,
        value: platform.posts,
        unit: 'count',
        platformId: platform.platformId,
        definition: `Published posts measured on ${platform.name} in the period.`,
        sampleSize: platform.posts,
      })
    );
    add(
      makeFact({
        id: `platform.${platform.platformId}.engagement`,
        label: `${platform.name} engagement actions`,
        value: platform.engagement.value,
        unit: 'count',
        platformId: platform.platformId,
        completeness: completenessOf(platform.engagement),
        definition: `Crewlink-calculated sum of available engagement actions on ${platform.name}.`,
        sampleSize: platform.posts,
      })
    );
    for (const key of Object.keys(platform.metrics) as MetricKey[]) {
      const aggregate = platform.metrics[key];
      if (!aggregate || aggregate.value === null) continue;
      add(
        makeFact({
          id: `platform.${platform.platformId}.${key}`,
          label: `${platform.name} ${METRIC_LABELS[key]}`,
          value: aggregate.value,
          unit: 'count',
          metric: key,
          platformId: platform.platformId,
          completeness: completenessOf(aggregate),
          definition: `Platform-reported ${METRIC_LABELS[key]} on ${platform.name}.`,
          sampleSize: aggregate.withMetric,
        })
      );
    }
    if (platform.engagementRate !== null) {
      add(
        makeFact({
          id: `platform.${platform.platformId}.engagementRate`,
          label: `${platform.name} engagement rate`,
          value: platform.engagementRate,
          unit: 'rate',
          platformId: platform.platformId,
          definition: platform.engagementRateLabel || 'Crewlink-calculated engagement actions divided by impressions.',
          sampleSize: platform.posts,
        })
      );
    }
  }

  for (const post of input.posts) {
    if (post.engagement !== null) {
      add(
        makeFact({
          id: `post.${post.id}.engagement`,
          label: `${post.platformName} post engagement`,
          value: post.engagement,
          unit: 'count',
          platformId: post.platformId,
          postId: post.id,
          definition:
            'Crewlink-calculated engagement actions for one post. The post id links to the stored analytics record.',
          sampleSize: 1,
        })
      );
    }
    for (const key of Object.keys(post.metrics) as MetricKey[]) {
      const value = post.metrics[key];
      if (typeof value !== 'number') continue;
      add(
        makeFact({
          id: `post.${post.id}.${key}`,
          label: `Post ${METRIC_LABELS[key]}`,
          value,
          unit: 'count',
          metric: key,
          platformId: post.platformId,
          postId: post.id,
          definition: `Platform-reported ${METRIC_LABELS[key]} for one stored post.`,
          sampleSize: 1,
        })
      );
    }
  }

  for (const format of input.top.formats) {
    if (format.averageEngagement === null) continue;
    add(
      makeFact({
        id: `format.${format.contentType}.averageEngagement`,
        label: `${format.contentType} average engagement`,
        value: format.averageEngagement,
        unit: 'count',
        definition: `Crewlink-calculated average engagement actions per ${format.contentType} post.`,
        sampleSize: format.posts,
      })
    );
    add(
      makeFact({
        id: `format.${format.contentType}.posts`,
        label: `${format.contentType} posts`,
        value: format.posts,
        unit: 'count',
        definition: `Number of measured ${format.contentType} posts.`,
        sampleSize: format.posts,
      })
    );
  }

  input.top.topics.forEach((topic, index) => {
    if (topic.averageEngagement === null) return;
    add(
      makeFact({
        id: `topic.${index}.averageEngagement`,
        label: `Topic "${topic.topic}" average engagement`,
        value: topic.averageEngagement,
        unit: 'count',
        definition: `Crewlink-calculated average engagement actions for the topic "${topic.topic}".`,
        sampleSize: topic.posts,
      })
    );
    add(
      makeFact({
        id: `topic.${index}.posts`,
        label: `Topic "${topic.topic}" posts`,
        value: topic.posts,
        unit: 'count',
        definition: `Number of measured posts for the topic "${topic.topic}".`,
        sampleSize: topic.posts,
      })
    );
  });

  add(
    makeFact({
      id: 'timing.sample',
      label: 'Posting-time sample',
      value: input.timing.sampleSize,
      unit: 'count',
      definition: 'Measured posts used for the posting-time association.',
      sampleSize: input.timing.sampleSize,
    })
  );
  for (const bucket of input.timing.byWeekday) {
    if (bucket.averageEngagement === null) continue;
    add(
      makeFact({
        id: `timing.weekday.${bucket.key}.averageEngagement`,
        label: `${bucket.label} average engagement`,
        value: bucket.averageEngagement,
        unit: 'count',
        definition: `Average engagement actions for posts published on ${bucket.label} in the selected timezone.`,
        sampleSize: bucket.posts,
      })
    );
    add(
      makeFact({
        id: `timing.weekday.${bucket.key}.posts`,
        label: `${bucket.label} posts`,
        value: bucket.posts,
        unit: 'count',
        definition: `Measured posts published on ${bucket.label}.`,
        sampleSize: bucket.posts,
      })
    );
  }
  for (const bucket of input.timing.byHour) {
    if (bucket.averageEngagement === null) continue;
    add(
      makeFact({
        id: `timing.hour.${bucket.key}.averageEngagement`,
        label: `${bucket.label} average engagement`,
        value: bucket.averageEngagement,
        unit: 'count',
        definition: `Average engagement actions for posts published in the ${bucket.label} local window.`,
        sampleSize: bucket.posts,
      })
    );
  }

  for (const campaign of input.campaigns) {
    if (campaign.published === 0) continue;
    add(
      makeFact({
        id: `campaign.${campaign.campaignId}.published`,
        label: `${campaign.name} published posts`,
        value: campaign.published,
        unit: 'count',
        campaignId: campaign.campaignId,
        definition: `Published posts recorded for campaign "${campaign.name}".`,
        sampleSize: campaign.published,
      })
    );
    add(
      makeFact({
        id: `campaign.${campaign.campaignId}.engagement`,
        label: `${campaign.name} engagement actions`,
        value: campaign.engagement.value,
        unit: 'count',
        campaignId: campaign.campaignId,
        completeness: completenessOf(campaign.engagement),
        definition: `Crewlink-calculated engagement actions for campaign "${campaign.name}".`,
        sampleSize: campaign.published,
      })
    );
    if (campaign.metrics.impressions?.value !== null && campaign.metrics.impressions?.value !== undefined) {
      add(
        makeFact({
          id: `campaign.${campaign.campaignId}.impressions`,
          label: `${campaign.name} impressions`,
          value: campaign.metrics.impressions.value,
          unit: 'count',
          metric: 'impressions',
          campaignId: campaign.campaignId,
          completeness: completenessOf(campaign.metrics.impressions),
          definition: `Platform-reported impressions for campaign "${campaign.name}".`,
        })
      );
    }
    if (campaign.previous && campaign.previous.engagement !== null) {
      add(
        makeFact({
          id: `campaign.${campaign.campaignId}.previous.engagement`,
          label: `${campaign.name} previous campaign engagement`,
          value: campaign.previous.engagement,
          unit: 'count',
          campaignId: campaign.campaignId,
          definition: `Engagement actions of the previous campaign "${campaign.previous.name}".`,
          sampleSize: campaign.previous.posts,
        })
      );
    }
  }

  const comparisons: Array<{ metric: string; current: number | null; previous: number | null }> = [
    {
      metric: 'engagement',
      current: input.overview.engagement.value,
      previous: input.overview.previous?.engagement ?? null,
    },
    {
      metric: 'impressions',
      current: input.overview.totals.impressions?.value ?? null,
      previous: input.overview.previous?.impressions ?? null,
    },
    {
      metric: 'posts',
      current: input.overview.posts.published,
      previous: input.overview.previous?.posts ?? null,
    },
  ];
  for (const comparison of comparisons) {
    if (comparison.current === null || comparison.previous === null) continue;
    const change = percentChange(comparison.current, comparison.previous);
    if (change === null) continue;
    add(
      makeFact({
        id: `comparison.${comparison.metric}`,
        label: `${comparison.metric} change vs previous period`,
        value: change,
        unit: 'percent',
        metric: comparison.metric === 'posts' ? undefined : (comparison.metric as MetricKey),
        completeness: 'complete',
        definition: `Crewlink-calculated change from the previous equal-length period. Current ${comparison.current}; previous ${comparison.previous}.`,
        sampleSize: input.sample.postsWithMetrics,
      })
    );
    add(
      makeFact({
        id: `comparison.${comparison.metric}.current`,
        label: `Current ${comparison.metric}`,
        value: comparison.current,
        unit: 'count',
        definition: `Current-period ${comparison.metric}.`,
        sampleSize: input.sample.postsWithMetrics,
      })
    );
    add(
      makeFact({
        id: `comparison.${comparison.metric}.previous`,
        label: `Previous ${comparison.metric}`,
        value: comparison.previous,
        unit: 'count',
        definition: `Previous equal-length period ${comparison.metric}.`,
        sampleSize: input.sample.postsWithMetrics,
      })
    );
  }

  return facts;
}

export function resolveFactIds(
  ids: string[],
  catalog: AnalyticsFact[]
): AnalyticsFact[] {
  const out: AnalyticsFact[] = [];
  for (const id of ids) {
    const fact = catalog.find((item) => item.id === id);
    if (!fact) {
      throw new LlmError(
        'malformed_response',
        `The model cited an unknown analytics fact: ${id}. The insight was discarded.`
      );
    }
    if (!factIsAvailable(fact)) {
      throw new LlmError(
        'malformed_response',
        `The model cited an unavailable analytics fact: ${id}. The insight was discarded.`
      );
    }
    if (!out.some((item) => item.id === fact.id)) out.push(fact);
  }
  return out;
}

export interface GroundedText {
  text: string;
  rendered: string;
  facts: AnalyticsFact[];
}

// Numbers are only allowed inside {{fact:id}} placeholders. This makes an
// invented percentage or count a hard validation failure, not a prompt hope.
export function validateGroundedText(input: {
  value: unknown;
  field: string;
  maxLength: number;
  catalog: AnalyticsFact[];
  allowedFactIds: string[];
  allowEmpty?: boolean;
}): GroundedText {
  const text = typeof input.value === 'string' ? input.value.trim() : '';
  if (!text && input.allowEmpty) {
    return { text: '', rendered: '', facts: [] };
  }
  if (!text) {
    throw new LlmError('malformed_response', `The model response is missing "${input.field}".`);
  }
  if (text.length > input.maxLength) {
    throw new LlmError(
      'malformed_response',
      `The model response field "${input.field}" is too long.`
    );
  }

  const allowed = new Set(input.allowedFactIds);
  const referenced: AnalyticsFact[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(PLACEHOLDER.source, 'g');
  while ((match = pattern.exec(text)) !== null) {
    const id = match[1];
    if (!allowed.has(id)) {
      throw new LlmError(
        'malformed_response',
        `The model used a fact placeholder that it did not declare: ${id}.`
      );
    }
    const facts = resolveFactIds([id], input.catalog);
    if (!referenced.some((fact) => fact.id === id)) referenced.push(facts[0]);
  }

  const withoutPlaceholders = text.replace(PLACEHOLDER, ' ');
  if (RAW_NUMBER.test(withoutPlaceholders) || CURRENCY_OR_PERCENT.test(withoutPlaceholders)) {
    throw new LlmError(
      'unsupported_numeric_claim',
      'The model included a number or percentage that was not supplied as a validated fact. The insight was discarded.'
    );
  }

  let rendered = text;
  for (const fact of referenced) {
    rendered = rendered.split(`{{fact:${fact.id}}}`).join(fact.formatted || 'unavailable');
  }
  return { text, rendered, facts: referenced };
}

export function uniqueFacts(facts: AnalyticsFact[]): AnalyticsFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    if (seen.has(fact.id)) return false;
    seen.add(fact.id);
    return true;
  });
}
