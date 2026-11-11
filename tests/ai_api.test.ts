import './setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { storage } from '../src/lib/storage';
import { signValue } from '../src/lib/auth';
import { rateLimiter } from '../src/lib/rateLimit';
import { setLlmProvider, resetLlmProvider, UnconfiguredProvider } from '../src/ai/provider';
import { createMockLlmProvider } from '../src/ai/providers/mock';
import { createCampaign } from '../src/ai/campaigns';
import { GET as aiStatus } from '../src/app/api/ai/status/route';
import {
  GET as getBrand,
  PUT as putBrand,
} from '../src/app/api/ai/projects/[id]/brand/route';
import {
  GET as listCampaigns,
  POST as createCampaignRoute,
} from '../src/app/api/ai/projects/[id]/campaigns/route';
import { GET as getCampaign } from '../src/app/api/ai/campaigns/[id]/route';
import { POST as runCampaignRoute } from '../src/app/api/ai/campaigns/[id]/run/route';
import { PATCH as patchStrategy } from '../src/app/api/ai/campaigns/[id]/strategy/route';
import { POST as generateIdeaRoute } from '../src/app/api/ai/campaigns/[id]/ideas/[ideaId]/generate/route';
import { POST as qualityRoute } from '../src/app/api/ai/drafts/[id]/quality/route';
import { POST as scheduleRoute } from '../src/app/api/ai/campaigns/[id]/schedule/route';
import { PATCH as overrideScheduleRoute } from '../src/app/api/ai/campaigns/[id]/schedules/[scheduleId]/route';
import { POST as analyticsRoute } from '../src/app/api/ai/campaigns/[id]/analytics/route';
import { POST as approveDraftRoute } from '../src/app/api/drafts/[id]/approve/route';
import { POST as publishDraftRoute } from '../src/app/api/drafts/[id]/publish/route';

function request(
  url: string,
  options: { method?: string; cookie?: string; ip?: string; body?: unknown } = {}
): NextRequest {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.ip) headers['x-forwarded-for'] = options.ip;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  return new NextRequest(url, {
    method: options.method || 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

test('M8 AI workspace APIs', async (t) => {
  storage.reset();
  rateLimiter.reset();
  const owner = await storage.saveUser({ id: 7001, login: 'ai-owner', name: 'AI Owner' });
  const intruder = await storage.saveUser({ id: 7002, login: 'ai-intruder', name: 'Eve' });
  const ownerCookie = `crewlink_session=${encodeURIComponent(signValue(await storage.createSession(owner.id)))}`;
  const intruderCookie = `crewlink_session=${encodeURIComponent(signValue(await storage.createSession(intruder.id)))}`;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'ai-owner/rocket-lab',
    repoName: 'rocket-lab',
    repoOwner: 'ai-owner',
    isPrivate: false,
    joinMode: 'direct',
    title: 'Rocket Lab',
    description: 'An open-source model rocket telemetry kit.',
    roles: ['Test pilot'],
  });

  let campaignId = '';
  let generatedDraftId = '';
  let ideaId = '';
  let scheduleId = '';

  await t.test('requires a signed-in owner for the workspace status', async () => {
    const anonymous = await aiStatus(request('http://localhost:3100/api/ai/status'));
    assert.equal(anonymous.status, 401);

    const res = await aiStatus(request('http://localhost:3100/api/ai/status', { cookie: ownerCookie }));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status.provider, 'mock');
    assert.equal(data.status.configured, true);
    // Only status fields are returned; keys and prompts never leave the server.
    assert.deepEqual(Object.keys(data.status).sort(), [
      'configured',
      'model',
      'provider',
      'researchConfigured',
      'researchProvider',
    ]);
  });

  await t.test('enforces project ownership for the brand profile', async () => {
    const anonymous = await getBrand(
      request(`http://localhost:3100/api/ai/projects/${project.id}/brand`),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(anonymous.status, 401);

    const forbidden = await getBrand(
      request(`http://localhost:3100/api/ai/projects/${project.id}/brand`, {
        cookie: intruderCookie,
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(forbidden.status, 403);

    const invalid = await putBrand(
      request(`http://localhost:3100/api/ai/projects/${project.id}/brand`, {
        method: 'PUT',
        cookie: ownerCookie,
        ip: '10.0.0.1',
        body: {},
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(invalid.status, 400);

    const saved = await putBrand(
      request(`http://localhost:3100/api/ai/projects/${project.id}/brand`, {
        method: 'PUT',
        cookie: ownerCookie,
        ip: '10.0.0.2',
        body: {
          brandName: 'Rocket Lab',
          tone: 'Direct and factual',
          avoidWords: ['synergy'],
          ctas: ['Join the test crew'],
        },
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(saved.status, 200);
    const savedBody = await saved.json();
    assert.equal(savedBody.brand.brandName, 'Rocket Lab');

    const loaded = await getBrand(
      request(`http://localhost:3100/api/ai/projects/${project.id}/brand`, { cookie: ownerCookie }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal((await loaded.json()).brand.tone, 'Direct and factual');
  });

  await t.test('creates and lists campaigns only for the project owner', async () => {
    const denied = await createCampaignRoute(
      request(`http://localhost:3100/api/ai/projects/${project.id}/campaigns`, {
        method: 'POST',
        cookie: intruderCookie,
        ip: '10.0.0.3',
        body: { brief: 'A brief long enough to pass', platforms: ['linkedin'] },
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(denied.status, 403);

    const invalid = await createCampaignRoute(
      request(`http://localhost:3100/api/ai/projects/${project.id}/campaigns`, {
        method: 'POST',
        cookie: ownerCookie,
        ip: '10.0.0.4',
        body: { brief: 'short', platforms: ['linkedin'] },
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(invalid.status, 400);

    const created = await createCampaignRoute(
      request(`http://localhost:3100/api/ai/projects/${project.id}/campaigns`, {
        method: 'POST',
        cookie: ownerCookie,
        ip: '10.0.0.5',
        body: {
          brief: 'Find test pilots for the rocket telemetry kit launch.',
          name: 'Launch campaign',
          objective: 'Recruit three test pilots',
          audience: 'Amateur rocketry builders',
          platforms: ['linkedin'],
          durationDays: 2,
          timezone: 'Europe/London',
          startDate: '2026-12-01',
          themes: ['testing'],
        },
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(created.status, 201);
    const body = await created.json();
    campaignId = body.campaign.id;
    assert.equal(body.campaign.ownerId, String(owner.id));

    const listed = await listCampaigns(
      request(`http://localhost:3100/api/ai/projects/${project.id}/campaigns`, { cookie: ownerCookie }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).campaigns.length, 1);

    const other = await getCampaign(
      request(`http://localhost:3100/api/ai/campaigns/${campaignId}`, { cookie: intruderCookie }),
      { params: Promise.resolve({ id: campaignId }) }
    );
    assert.equal(other.status, 403);
  });

  await t.test('runs the pipeline through the API without approving or publishing', async () => {
    const denied = await runCampaignRoute(
      request(`http://localhost:3100/api/ai/campaigns/${campaignId}/run`, {
        method: 'POST',
        cookie: intruderCookie,
        ip: '10.0.1.1',
        body: {},
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );
    assert.equal(denied.status, 403);

    const run = await runCampaignRoute(
      request(`http://localhost:3100/api/ai/campaigns/${campaignId}/run`, {
        method: 'POST',
        cookie: ownerCookie,
        ip: '10.0.1.2',
        body: { sources: [{ title: 'Owner doc', url: 'https://owner.example/doc' }] },
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );
    assert.equal(run.status, 200);
    const result = await run.json();
    assert.equal(result.campaign.status, 'ready');
    assert.ok(result.detail.generated.length > 0);
    assert.equal(result.detail.sources[0].provider, 'owner');
    assert.equal(result.detail.sources[0].verified, false);
    assert.ok(result.detail.executions.length >= 5);
    assert.ok(result.llm.totalTokens > 0);

    generatedDraftId = result.detail.generated[0].draftId;
    ideaId = result.detail.ideas[0].id;
    scheduleId = result.detail.schedules[0].id;
    const draftCount = result.detail.generated.length;

    for (const draft of await storage.getDraftsByCampaign(campaignId)) {
      assert.equal(draft.status, 'drafted');
      assert.equal(await storage.getPublication(draft.id, draft.platformId), null);
    }

    const second = await runCampaignRoute(
      request(`http://localhost:3100/api/ai/campaigns/${campaignId}/run`, {
        method: 'POST',
        cookie: ownerCookie,
        ip: '10.0.1.3',
        body: {},
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );
    assert.equal(second.status, 200);
    const rerun = await second.json();
    assert.equal(rerun.detail.generated.length, draftCount);

    const detail = await getCampaign(
      request(`http://localhost:3100/api/ai/campaigns/${campaignId}`, { cookie: ownerCookie }),
      { params: Promise.resolve({ id: campaignId }) }
    );
    assert.equal(detail.status, 200);
    const detailBody = await detail.json();
    assert.equal(detailBody.detail.campaign.status, 'ready');
    assert.ok(detailBody.detail.tasks.every((task: { status: string }) => task.status !== 'pending'));
  });

  await t.test('reviews, regenerates, approves and never bypasses publish gates', async () => {
    const quality = await qualityRoute(
      request(`http://localhost:3100/api/ai/drafts/${generatedDraftId}/quality`, {
        method: 'POST',
        cookie: ownerCookie,
        ip: '10.0.2.1',
      }),
      { params: Promise.resolve({ id: generatedDraftId }) }
    );
    assert.equal(quality.status, 200);
    const qualityBody = await quality.json();
    assert.equal(qualityBody.quality.verificationStatus, 'unverified');
    assert.equal(qualityBody.quality.linkCheck, 'not_checked');

    const nonAiDraft = await storage.createDraft({
      projectId: project.id,
      platformId: 'linkedin',
      text: 'Hand written draft.',
    });
    const notGenerated = await qualityRoute(
      request(`http://localhost:3100/api/ai/drafts/${nonAiDraft.id}/quality`, {
        method: 'POST',
        cookie: ownerCookie,
        ip: '10.0.2.2',
      }),
      { params: Promise.resolve({ id: nonAiDraft.id }) }
    );
    assert.equal(notGenerated.status, 404);

    const conflict = await generateIdeaRoute(
      request(`http://localhost:3100/api/ai/campaigns/${campaignId}/ideas/${ideaId}/generate`, {
        method: 'POST',
        cookie: ownerCookie,
        ip: '10.0.2.3',
        body: { force: false },
      }),
      { params: Promise.resolve({ id: campaignId, ideaId }) }
    );
    assert.equal(conflict.status, 409);

    const regenerated = await generateIdeaRoute(
      request(`http://localhost:3100/api/ai/campaigns/${campaignId}/ideas/${ideaId}/generate`, {
        method: 'POST',
        cookie: ownerCookie,
        ip: '10.0.2.4',
        body: { force: true },
      }),
      { params: Promise.resolve({ id: campaignId, ideaId }) }
    );
    assert.equal(regenerated.status, 200);
    const regeneratedBody = await regenerated.json();
    assert.ok(regeneratedBody.drafts.length >= 1);
    assert.equal(regeneratedBody.drafts[0].status, 'drafted');

    // An unapproved AI draft cannot be published through the existing route.
    const blocked = await publishDraftRoute(
      request(`http://localhost:3100/api/drafts/${generatedDraftId}/publish`, {
        method: 'POST',
        cookie: ownerCookie,
        ip: '10.0.2.5',
        body: {},
      }),
      { params: Promise.resolve({ id: generatedDraftId }) }
    );
    assert.equal(blocked.status, 400);
    assert.equal((await blocked.json()).code, 'draft_not_approved');

    const approved = await approveDraftRoute(
      request(`http://localhost:3100/api/drafts/${generatedDraftId}/approve`, {
        method: 'POST',
        cookie: ownerCookie,
      }),
      { params: Promise.resolve({ id: generatedDraftId }) }
    );
    assert.equal(approved.status, 200);

    // Approval alone is not enough: the existing connection gate still applies.
    const noConnection = await publishDraftRoute(
      request(`http://localhost:3100/api/drafts/${generatedDraftId}/publish`, {
        method: 'POST',
        cookie: ownerCookie,
        ip: '10.0.2.6',
        body: {},
      }),
      { params: Promise.resolve({ id: generatedDraftId }) }
    );
    assert.equal(noConnection.status, 404);
    assert.equal((await noConnection.json()).code, 'connection_not_found');
    const afterAttempt = await storage.getDraftById(generatedDraftId);
    assert.equal(afterAttempt?.status, 'approved');
    assert.equal(await storage.getPublication(generatedDraftId, 'linkedin'), null);
  });

  await t.test('persists strategy edits and recomputes the schedule', async () => {
    const patched = await patchStrategy(
      request(`http://localhost:3100/api/ai/campaigns/${campaignId}/strategy`, {
        method: 'PATCH',
        cookie: ownerCookie,
        ip: '10.0.3.1',
        body: { audience: 'University rocket teams' },
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).detail.campaign.audience, 'University rocket teams');

    const recalculated = await scheduleRoute(
      request(`http://localhost:3100/api/ai/campaigns/${campaignId}/schedule`, {
        method: 'POST',
        cookie: ownerCookie,
        ip: '10.0.3.2',
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );
    assert.equal(recalculated.status, 200);
    const rows = (await recalculated.json()).schedules as Array<{ id: string }>;
    assert.ok(rows.length > 0);
    scheduleId = rows[0].id;

    const past = await overrideScheduleRoute(
      request(`http://localhost:3100/api/ai/campaigns/${campaignId}/schedules/${scheduleId}`, {
        method: 'PATCH',
        cookie: ownerCookie,
        ip: '10.0.3.3',
        body: { scheduledFor: '2020-01-01T00:00:00.000Z' },
      }),
      { params: Promise.resolve({ id: campaignId, scheduleId }) }
    );
    assert.equal(past.status, 400);

    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const overridden = await overrideScheduleRoute(
      request(`http://localhost:3100/api/ai/campaigns/${campaignId}/schedules/${scheduleId}`, {
        method: 'PATCH',
        cookie: ownerCookie,
        ip: '10.0.3.4',
        body: { scheduledFor: future },
      }),
      { params: Promise.resolve({ id: campaignId, scheduleId }) }
    );
    assert.equal(overridden.status, 200);
    const manual = (await overridden.json()).schedules.find(
      (row: { id: string }) => row.id === scheduleId
    );
    assert.equal(manual.source, 'manual');
    assert.equal(manual.scheduledFor, future);
  });

  await t.test('reports analytics from Crewlink records only', async () => {
    const res = await analyticsRoute(
      request(`http://localhost:3100/api/ai/campaigns/${campaignId}/analytics`, {
        method: 'POST',
        cookie: ownerCookie,
        ip: '10.0.4.1',
      }),
      { params: Promise.resolve({ id: campaignId }) }
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.analytics.metrics.publishedPosts, 0);
    assert.equal(data.analytics.metrics.scheduledPosts > 0, true);
    assert.ok(data.analytics.unavailable.includes('impressions'));
    assert.ok(data.analytics.note.length > 0);
  });

  await t.test('fails closed when no provider is configured', async () => {
    setLlmProvider(new UnconfiguredProvider('openai'));
    try {
      const res = await runCampaignRoute(
        request(`http://localhost:3100/api/ai/campaigns/${campaignId}/run`, {
          method: 'POST',
          cookie: ownerCookie,
          ip: '10.0.5.1',
          body: {},
        }),
        { params: Promise.resolve({ id: campaignId }) }
      );
      assert.equal(res.status, 503);
    } finally {
      resetLlmProvider();
    }
  });

  await t.test('surfaces malformed structured output as a failed campaign', async () => {
    const campaign = await createCampaign({
      userId: String(owner.id),
      projectId: project.id,
      body: {
        brief: 'A campaign that will receive malformed model output.',
        platforms: ['linkedin'],
        durationDays: 1,
        timezone: 'UTC',
      },
    });
    const provider = createMockLlmProvider({ responses: ['not json', 'not json'] });
    setLlmProvider(provider);
    try {
      const res = await runCampaignRoute(
        request(`http://localhost:3100/api/ai/campaigns/${campaign.id}/run`, {
          method: 'POST',
          cookie: ownerCookie,
          ip: '10.0.5.2',
          body: {},
        }),
        { params: Promise.resolve({ id: campaign.id }) }
      );
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.ok(body.error.length > 0);
      assert.equal(body.code, 'malformed_response');
    } finally {
      resetLlmProvider();
    }

    const detail = await storage.getCampaignById(campaign.id);
    assert.equal(detail?.status, 'failed');
    const tasks = await storage.getCampaignTasks(campaign.id);
    assert.equal(tasks.find((task) => task.kind === 'strategy')?.status, 'failed');
    assert.equal(tasks.find((task) => task.kind === 'generation')?.status, 'skipped');
  });

  await t.test('rate limits campaign creation per client', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      const res = await createCampaignRoute(
        request(`http://localhost:3100/api/ai/projects/${project.id}/campaigns`, {
          method: 'POST',
          cookie: ownerCookie,
          ip: '10.9.9.9',
          body: { brief: 'too short', platforms: ['linkedin'] },
        }),
        { params: Promise.resolve({ id: project.id }) }
      );
      statuses.push(res.status);
    }
    assert.equal(statuses.filter((status) => status === 400).length, 10);
    assert.equal(statuses[10], 429);
  });
});
