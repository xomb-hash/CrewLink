import './setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { storage } from '../src/lib/storage';
import { createMockLlmProvider } from '../src/ai/providers/mock';
import { StaticSearchGateway } from '../src/ai/search';
import { runCampaign } from '../src/ai/orchestrator';
import type { User } from '../src/types/index';

const owner: User = { id: '9001', login: 'owner', name: 'Owner' };

async function seedProject() {
  storage.reset();
  await storage.saveUser(owner);
  return storage.createProject({
    ownerLogin: owner.login,
    ownerId: String(owner.id),
    repoFullName: 'owner/rocket-lab',
    repoName: 'rocket-lab',
    repoOwner: 'owner',
    isPrivate: false,
    joinMode: 'direct',
    title: 'Rocket Lab',
    description: 'An open-source model rocket telemetry kit.',
  });
}

async function createCampaign(projectId: string, overrides: Record<string, unknown> = {}) {
  return storage.createCampaign({
    projectId,
    ownerId: String(owner.id),
    brief: 'Find builders who want to help test a small rocket telemetry kit.',
    name: 'Telemetry launch',
    objective: 'Recruit three test pilots',
    audience: 'Amateur rocketry builders',
    platforms: ['linkedin', 'x'],
    durationDays: 3,
    timezone: 'Europe/London',
    startDate: '2026-12-01',
    themes: ['testing', 'build journey'],
    ...overrides,
  });
}

test('M8 campaign orchestration', async (t) => {
  await t.test('runs research, strategy, generation, quality and scheduling', async () => {
    const project = await seedProject();
    const campaign = await createCampaign(project.id);
    const provider = createMockLlmProvider();
    const gateways = [
      new StaticSearchGateway('brave', [
        {
          title: 'Rocket telemetry guide',
          url: 'https://example.com/telemetry-guide',
          publisher: 'example.com',
          publishedAt: '2026-10-01T00:00:00.000Z',
          summary: 'A guide to low-cost telemetry.',
        },
      ]),
    ];

    const result = await runCampaign({
      campaignId: campaign.id,
      user: owner,
      project,
      provider,
      gateways,
      now: new Date('2026-11-20T10:00:00.000Z'),
    });

    assert.equal(result.campaign.status, 'ready');
    assert.ok(result.detail.ideas.length > 0);
    assert.equal(result.detail.ideas.length, 6);
    assert.ok(result.detail.generated.length > 0);
    assert.equal(result.detail.sources.length, 1);
    assert.equal(result.detail.sources[0].verified, true);
    assert.ok(result.detail.schedules.length > 0);
    assert.ok(result.detail.analytics);
    assert.equal(result.detail.analytics?.metrics.publishedPosts, 0);
    assert.ok(result.detail.analytics?.unavailable.includes('impressions'));
    assert.ok(result.detail.executions.length >= 5);
    assert.ok(result.llm.calls >= 13);

    const drafts = await storage.getDraftsByCampaign(campaign.id);
    assert.ok(drafts.length > 0);
    for (const draft of drafts) {
      assert.equal(draft.status, 'drafted');
      assert.equal(draft.projectId, project.id);
      assert.equal(draft.campaignId, campaign.id);
      assert.ok(draft.text.includes(`/join/${project.slug}`));
    }
    const generated = result.detail.generated[0];
    assert.ok(generated.quality);
    assert.equal(generated.quality?.verificationStatus, 'unverified');
    assert.equal(generated.quality?.linkCheck, 'not_checked');
    assert.ok(generated.quality?.disclaimer);

    // A second run reuses ideas and existing drafts; it must not duplicate them.
    const draftCount = drafts.length;
    const sourceCount = result.detail.sources.length;
    const second = await runCampaign({
      campaignId: campaign.id,
      user: owner,
      project,
      provider,
      gateways,
      now: new Date('2026-11-20T11:00:00.000Z'),
    });
    assert.equal(second.detail.ideas.length, result.detail.ideas.length);
    assert.equal(second.detail.generated.length, draftCount);
    assert.equal(second.detail.sources.length, sourceCount);
    assert.equal(
      second.detail.tasks.filter((task) => task.kind === 'strategy').at(-1)?.status,
      'skipped'
    );
  });

  await t.test('refuses a campaign created by another owner', async () => {
    const project = await seedProject();
    const campaign = await createCampaign(project.id);
    await assert.rejects(
      runCampaign({
        campaignId: campaign.id,
        user: { id: '9002', login: 'owner' },
        project,
        provider: createMockLlmProvider(),
      }),
      /Only the owner who created this campaign/
    );
  });

  await t.test('keeps generated drafts pending and never publishes', async () => {
    const project = await seedProject();
    const campaign = await createCampaign(project.id);
    await runCampaign({
      campaignId: campaign.id,
      user: owner,
      project,
      provider: createMockLlmProvider(),
      gateways: [],
      now: new Date('2026-11-20T10:00:00.000Z'),
    });
    const drafts = await storage.getDraftsByCampaign(campaign.id);
    for (const draft of drafts) {
      assert.equal(draft.status, 'drafted');
      assert.equal(await storage.getPublication(draft.id, draft.platformId), null);
    }
  });

  await t.test('turns an invalid structured strategy into a failed campaign', async () => {
    const project = await seedProject();
    const campaign = await createCampaign(project.id);
    const provider = createMockLlmProvider({ responses: ['not json'] });
    // The first response is consumed by research, so make research succeed first.
    provider.enqueue('not json');
    await assert.rejects(
      runCampaign({
        campaignId: campaign.id,
        user: owner,
        project,
        provider,
        gateways: [],
      }),
      /JSON|strategy|Unexpected|parse/i
    );
    const detail = await storage.getCampaignById(campaign.id);
    assert.equal(detail?.status, 'failed');
    const tasks = await storage.getCampaignTasks(campaign.id);
    assert.equal(tasks.find((task) => task.kind === 'strategy')?.status, 'failed');
    assert.equal(tasks.find((task) => task.kind === 'generation')?.status, 'skipped');
  });
});
