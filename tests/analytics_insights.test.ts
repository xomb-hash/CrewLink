import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { storage } from '../src/lib/storage';
import { MockLlmProvider } from '../src/ai/providers/mock';
import { LlmError } from '../src/ai/llm';
import {
  buildAnalystFacts,
  runAnalyticsInsight,
} from '../src/analytics/insights';
import { resolveAnalyticsRange } from '../src/analytics/range';

const range = resolveAnalyticsRange({ from: '2026-11-01', to: '2026-11-10', timezone: 'UTC' });

async function seed(label: string) {
  const owner = await storage.saveUser({ id: 9901, login: `${label}-owner` });
  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: `${label}-owner/rocket`,
    repoName: 'rocket',
    repoOwner: `${label}-owner`,
    title: 'Rocket',
  });
  const campaign = await storage.createCampaign({
    projectId: project.id,
    ownerId: String(owner.id),
    brief: 'A campaign that explains the rocket build',
    name: 'Build in public',
    objective: 'Explain the build',
    audience: 'Developers',
    platforms: ['bluesky'],
    durationDays: 7,
    timezone: 'UTC',
    themes: ['build'],
    status: 'ready',
  });
  return { owner, project, campaign };
}

async function addPost(input: {
  userId: string;
  projectId: string;
  publishedAt: string;
  likes: number;
  comments?: number;
  campaignId?: string;
  contentType?: string;
  topic?: string;
  draftId?: string;
}): Promise<void> {
  await storage.upsertAnalyticsPost({
    userId: input.userId,
    projectId: input.projectId,
    publicationId: `pub_${Math.random().toString(36).slice(2, 12)}`,
    draftId: input.draftId || `drf_${Math.random().toString(36).slice(2, 12)}`,
    campaignId: input.campaignId,
    platformId: 'bluesky',
    publishedAt: input.publishedAt,
    contentType: (input.contentType || 'short') as never,
    topic: input.topic,
    metrics: { likes: input.likes, comments: input.comments ?? 1 },
    availableMetrics: ['likes', 'comments'],
    unavailableMetrics: [],
    engagement: input.likes + (input.comments ?? 1),
    engagementRate: null,
    status: 'active',
  });
}

test('analyst facts are bounded, grounded and contain no credentials or post bodies', async () => {
  storage.reset();
  const { owner, project, campaign } = await seed('insight-facts');
  const draft = await storage.createDraft({
    projectId: project.id,
    platformId: 'bluesky',
    text: 'This is the secret draft body that must never enter the fact sheet.',
    campaignId: campaign.id,
  });
  await addPost({
    userId: String(owner.id),
    projectId: project.id,
    publishedAt: '2026-11-05T10:00:00.000Z',
    likes: 10,
    campaignId: campaign.id,
    topic: 'build',
    draftId: draft.id,
  });
  await addPost({
    userId: String(owner.id),
    projectId: project.id,
    publishedAt: '2026-11-06T10:00:00.000Z',
    likes: 20,
    campaignId: campaign.id,
    topic: 'build',
    draftId: draft.id,
  });
  await addPost({
    userId: String(owner.id),
    projectId: project.id,
    publishedAt: '2026-11-07T10:00:00.000Z',
    likes: 5,
    topic: 'launch',
  });
  await addPost({
    userId: String(owner.id),
    projectId: project.id,
    publishedAt: '2026-10-25T10:00:00.000Z',
    likes: 30,
  });

  const facts = await buildAnalystFacts({ projectId: project.id, range });
  assert.equal(facts.sample.publishedPosts, 3);
  assert.equal(facts.sample.postsWithMetrics, 3);
  assert.equal(facts.totals.engagement, 38);
  assert.equal(facts.previous?.engagement, 31);
  assert.equal(facts.platforms.length, 1);
  assert.equal(facts.platforms[0].platformId, 'bluesky');
  assert.equal(facts.timing.sufficientData, false);
  assert.ok(facts.calculations.some((line) => line.includes('bluesky')));
  assert.ok(facts.dataQuality.length > 0);

  const serialized = JSON.stringify(facts);
  assert.equal(serialized.includes('secret draft body'), false);
  assert.equal(serialized.includes('accessToken'), false);
  assert.equal(serialized.includes('ciphertext'), false);
  assert.equal(serialized.includes('draftId'), false);

  const campaignFacts = await buildAnalystFacts({
    projectId: project.id,
    range,
    campaign,
  });
  assert.equal(campaignFacts.scope, 'campaign');
  assert.equal(campaignFacts.sample.publishedPosts, 2);
  assert.equal(campaignFacts.campaign?.id, campaign.id);
});

test('insufficient data is reported without calling the model', async () => {
  storage.reset();
  const { owner, project } = await seed('insight-small');
  await addPost({
    userId: String(owner.id),
    projectId: project.id,
    publishedAt: '2026-11-05T10:00:00.000Z',
    likes: 4,
  });
  const provider = new MockLlmProvider();
  const result = await runAnalyticsInsight({
    user: owner,
    project,
    range,
    provider,
  });
  assert.equal(provider.calls.length, 0);
  assert.equal(result.insight.payload.insufficientData, true);
  assert.equal(result.insight.payload.findings.length, 0);
  assert.equal(result.insight.payload.recommendations.length, 0);
  assert.equal(result.insight.sampleSize, 1);
  assert.ok(result.insight.payload.dataQuality.some((line) => line.includes('too small')));
  assert.equal(result.insight.provider, 'mock');
});

test('a valid insight uses stored metrics, server-calculated comparisons and a bounded sample', async () => {
  storage.reset();
  const { owner, project } = await seed('insight-valid');
  for (let index = 1; index <= 4; index += 1) {
    await addPost({
      userId: String(owner.id),
      projectId: project.id,
      publishedAt: `2026-11-0${index + 1}T10:00:00.000Z`,
      likes: index * 10,
      comments: index,
      topic: index % 2 === 0 ? 'build' : 'launch',
      contentType: index === 1 ? 'thread' : 'short',
    });
  }
  await addPost({
    userId: String(owner.id),
    projectId: project.id,
    publishedAt: '2026-10-25T10:00:00.000Z',
    likes: 5,
  });

  const provider = new MockLlmProvider();
  const result = await runAnalyticsInsight({ user: owner, project, range, provider });
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].task, 'analytics');
  assert.equal(result.insight.payload.insufficientData, false);
  assert.equal(result.insight.sampleSize, 4);

  for (const finding of result.insight.payload.findings) {
    assert.ok(finding.sampleSize <= result.insight.sampleSize);
    assert.ok(finding.basis.length > 0);
  }
  for (const recommendation of result.insight.payload.recommendations) {
    assert.ok(['low', 'medium', 'high'].includes(recommendation.priority));
  }
  assert.ok(result.insight.payload.comparisons.length >= 1);
  for (const comparison of result.insight.payload.comparisons) {
    assert.equal(typeof comparison.current, 'number');
    assert.equal(typeof comparison.previous, 'number');
    if (comparison.metric === 'engagement') {
      assert.equal(comparison.current, 110);
      assert.equal(comparison.previous, 6);
      assert.equal(comparison.changePercent, 1733.3);
    }
  }
  assert.equal(result.insight.payload.verificationStatus, 'unverified');
  assert.ok(result.insight.payload.limitations.length >= 3);
  assert.equal(result.insight.payload.facts.sample.postsWithMetrics, 4);
  assert.ok(result.insight.payload.factCatalog.length > 0);
  assert.equal(
    (result.insight.payload.renderedSummary || '').includes('{{fact:'),
    false
  );
  for (const finding of result.insight.payload.findings) {
    assert.equal((finding.renderedStatement || '').includes('{{fact:'), false);
    assert.ok((finding.facts || []).length > 0);
    for (const fact of finding.facts) {
      assert.ok(fact.id);
      assert.ok(fact.formatted);
    }
  }
  for (const recommendation of result.insight.payload.recommendations) {
    assert.equal((recommendation.renderedAction || '').includes('{{fact:'), false);
    assert.ok((recommendation.facts || []).length > 0);
  }
  const serialized = JSON.stringify(result.insight);
  assert.equal(serialized.includes('secret draft body'), false);
  assert.equal(serialized.includes('accessToken'), false);
});

function modelResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: 'A qualitative observation based on the supplied facts.',
    findings: [],
    recommendations: [],
    comparisons: [],
    topFormats: [],
    topTopics: [],
    postingTime: null,
    ...overrides,
  });
}

test('the analyst rejects fabricated numbers, unknown facts and invalid comparisons', async (t) => {
  storage.reset();
  const { owner, project } = await seed('insight-grounded');
  for (let index = 1; index <= 4; index += 1) {
    await addPost({
      userId: String(owner.id),
      projectId: project.id,
      publishedAt: `2026-11-0${index + 1}T10:00:00.000Z`,
      likes: index * 10,
    });
  }
  await addPost({
    userId: String(owner.id),
    projectId: project.id,
    publishedAt: '2026-10-25T10:00:00.000Z',
    likes: 5,
  });

  await t.test('rejects a literal percentage in AI text', async () => {
    const provider = new MockLlmProvider({
      responses: [
        modelResponse({
          summary: 'Engagement grew 42% this period.',
        }),
      ],
    });
    await assert.rejects(
      () => runAnalyticsInsight({ user: owner, project, range, provider }),
      (error) => error instanceof LlmError && error.code === 'unsupported_numeric_claim'
    );
  });

  await t.test('rejects an unknown fact id', async () => {
    const provider = new MockLlmProvider({
      responses: [
        modelResponse({
          findings: [
            {
              statement: 'A finding with no valid evidence.',
              factIds: ['total.fabricatedMetric'],
              confidence: 'high',
              caveat: '',
            },
          ],
        }),
      ],
    });
    await assert.rejects(
      () => runAnalyticsInsight({ user: owner, project, range, provider }),
      (error) => error instanceof LlmError && error.code === 'malformed_response'
    );
  });

  await t.test('rejects a placeholder the model did not declare', async () => {
    const provider = new MockLlmProvider({
      responses: [
        modelResponse({
          findings: [
            {
              statement: 'Total engagement was {{fact:total.engagement}}.',
              factIds: ['total.likes'],
              confidence: 'low',
              caveat: '',
            },
          ],
        }),
      ],
    });
    await assert.rejects(
      () => runAnalyticsInsight({ user: owner, project, range, provider }),
      (error) => error instanceof LlmError && error.code === 'malformed_response'
    );
  });

  await t.test('rejects a comparison whose direction contradicts the facts', async () => {
    const provider = new MockLlmProvider({
      responses: [
        modelResponse({
          comparisons: [
            {
              metric: 'engagement',
              direction: 'down',
              note: 'The comparison says the opposite of the data.',
              factId: 'comparison.engagement',
            },
          ],
        }),
      ],
    });
    await assert.rejects(
      () => runAnalyticsInsight({ user: owner, project, range, provider }),
      (error) => error instanceof LlmError && error.code === 'unsupported_numeric_claim'
    );
  });

  await t.test('valid placeholders are rendered only from backend facts', async () => {
    const provider = new MockLlmProvider({
      responses: [
        modelResponse({
          summary: 'Engagement was {{fact:total.engagement}} across the period.',
          findings: [
            {
              statement: 'The measured sample contained {{fact:sample.measuredPosts}} posts.',
              factIds: ['sample.measuredPosts'],
              confidence: 'low',
              caveat: 'This is descriptive.',
            },
          ],
        }),
      ],
    });
    const result = await runAnalyticsInsight({ user: owner, project, range, provider });
    assert.equal(result.insight.payload.renderedSummary, 'Engagement was 104 across the period.');
    assert.equal(
      result.insight.payload.findings[0].renderedStatement,
      'The measured sample contained 4 posts.'
    );
    assert.equal(result.insight.payload.factCatalog.length > 0, true);
    assert.equal(result.insight.payload.findings[0].facts[0].id, 'sample.measuredPosts');
  });
});

test('the analyst rejects a comparison when no previous-period data exists', async () => {
  storage.reset();
  const { owner, project } = await seed('insight-nocompare');
  for (let index = 1; index <= 4; index += 1) {
    await addPost({
      userId: String(owner.id),
      projectId: project.id,
      publishedAt: `2026-11-0${index + 1}T10:00:00.000Z`,
      likes: index,
    });
  }
  const provider = new MockLlmProvider({
    responses: [
      modelResponse({
        comparisons: [
          {
            metric: 'engagement',
            direction: 'up',
            note: 'An invented comparison.',
            factId: 'comparison.engagement',
          },
        ],
      }),
    ],
  });
  await assert.rejects(
    () => runAnalyticsInsight({ user: owner, project, range, provider }),
    (error) => error instanceof LlmError && error.code === 'malformed_response'
  );
});

test('the analyst rejects a posting-time claim built from a non-timing fact', async () => {
  storage.reset();
  const { owner, project } = await seed('insight-timing');
  for (let index = 0; index < 9; index += 1) {
    await addPost({
      userId: String(owner.id),
      projectId: project.id,
      publishedAt: `2026-11-0${(index % 7) + 1}T10:00:00.000Z`,
      likes: index + 1,
    });
  }
  const provider = new MockLlmProvider({
    responses: [
      modelResponse({
        postingTime: {
          recommendation: 'Post on Tuesday.',
          factIds: ['total.engagement'],
        },
      }),
    ],
  });
  await assert.rejects(
    () => runAnalyticsInsight({ user: owner, project, range, provider }),
    (error) => error instanceof LlmError && error.code === 'malformed_response'
  );
});

test('a malformed model response is rejected instead of being stored', async () => {
  storage.reset();
  const { owner, project } = await seed('insight-malformed');
  for (let index = 1; index <= 4; index += 1) {
    await addPost({
      userId: String(owner.id),
      projectId: project.id,
      publishedAt: `2026-11-0${index + 1}T10:00:00.000Z`,
      likes: index,
    });
  }
  const provider = new MockLlmProvider({ responses: ['not json at all'] });
  await assert.rejects(
    () => runAnalyticsInsight({ user: owner, project, range, provider }),
    (error) => error instanceof LlmError && error.code === 'malformed_response'
  );
  assert.equal((await storage.listAnalyticsInsights({ projectId: project.id })).length, 0);
});
