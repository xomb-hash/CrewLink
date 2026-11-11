import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import './setup';
import { storage } from '../src/lib/storage';
import { signValue } from '../src/lib/auth';
import {
  beginRedditAuthorization,
  completeRedditAuthorization,
} from '../src/posting/connections';
import {
  mockRedditClient,
  resetMockRedditState,
  setOAuthClientForTests,
} from '../src/posting/adapters';
import { GET as getDrafts, POST as createDrafts } from '../src/app/api/projects/[id]/drafts/route';
import { PUT as editDraft } from '../src/app/api/drafts/[id]/route';
import { POST as approveDraft } from '../src/app/api/drafts/[id]/approve/route';
import { POST as validateReddit } from '../src/app/api/drafts/[id]/reddit/check/route';
import { GET as searchSubreddits } from '../src/app/api/platforms/reddit/subreddits/route';
import { GET as subredditDetails } from '../src/app/api/platforms/reddit/subreddits/[name]/route';
import { POST as authorizeReddit } from '../src/app/api/platforms/reddit/authorize/route';
import { GET as listConnections } from '../src/app/api/platforms/connections/route';

test('Reddit APIs enforce ownership and server-side validation', async (t) => {
  storage.reset();
  resetMockRedditState();
  setOAuthClientForTests('reddit', mockRedditClient);
  mockRedditClient.setSubreddit('programming');

  const owner = await storage.saveUser({ id: 1301, login: 'reddit-api-owner' });
  const intruder = await storage.saveUser({ id: 1302, login: 'reddit-api-intruder' });
  const ownerId = owner.id as string;
  const ownerCookie = `crewlink_session=${encodeURIComponent(
    signValue(await storage.createSession(owner.id))
  )}`;
  const intruderCookie = `crewlink_session=${encodeURIComponent(
    signValue(await storage.createSession(intruder.id))
  )}`;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'reddit-api-owner/rocket',
    repoName: 'rocket',
    repoOwner: 'reddit-api-owner',
    title: 'Rocket',
    roles: ['Design'],
    description: 'A rocket project.',
  });

  let redditDraftId = '';

  await t.test('creating a Reddit draft starts with a title and a type but no subreddit', async () => {
    const req = new NextRequest(`http://localhost:3000/api/projects/${project.id}/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ platforms: ['reddit'] }),
    });
    const res = await createDrafts(req, { params: Promise.resolve({ id: project.id }) });
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.drafts.length, 1);
    const draft = data.drafts[0];
    assert.equal(draft.platformId, 'reddit');
    assert.ok(draft.title.length > 0 && draft.title.length <= 300);
    assert.equal(draft.submissionType, 'self');
    assert.ok(draft.checks.some((check: { code: string }) => check.code === 'subreddit_required'));
    redditDraftId = draft.id;
  });

  await t.test('the owner can set the title, subreddit and type', async () => {
    const req = new NextRequest(`http://localhost:3000/api/drafts/${redditDraftId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({
        text: `Join our crew and help us build the rocket: http://localhost:3000/join/${project.slug}`,
        title: 'Looking for collaborators',
        subreddit: 'r/programming',
        submissionType: 'self',
      }),
    });
    const res = await editDraft(req, { params: Promise.resolve({ id: redditDraftId }) });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.draft.title, 'Looking for collaborators');
    assert.equal(data.draft.subreddit, 'programming');
    assert.equal(data.draft.submissionType, 'self');
    assert.ok(
      !data.draft.checks.some((check: { level: string }) => check.level === 'error'),
      'a complete text submission should have no static errors'
    );
  });

  await t.test('an invalid subreddit and a non-Reddit field are rejected', async () => {
    const invalid = new NextRequest(`http://localhost:3000/api/drafts/${redditDraftId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ subreddit: 'bad name' }),
    });
    const invalidRes = await editDraft(invalid, {
      params: Promise.resolve({ id: redditDraftId }),
    });
    assert.equal(invalidRes.status, 400);

    const discord = await storage.createDraft({
      projectId: project.id,
      platformId: 'discord',
      text: 'Discord text',
    });
    const misplaced = new NextRequest(`http://localhost:3000/api/drafts/${discord.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ title: 'Not for Discord' }),
    });
    const misplacedRes = await editDraft(misplaced, {
      params: Promise.resolve({ id: discord.id }),
    });
    assert.equal(misplacedRes.status, 400);
  });

  await t.test('a title over the Reddit limit is rejected, not silently cut', async () => {
    const req = new NextRequest(`http://localhost:3000/api/drafts/${redditDraftId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ title: 'x'.repeat(400) }),
    });
    const res = await editDraft(req, { params: Promise.resolve({ id: redditDraftId }) });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('300'));
    const stored = await storage.getDraftById(redditDraftId);
    assert.equal(stored?.title, 'Looking for collaborators');

    const tooLongBody = new NextRequest(`http://localhost:3000/api/drafts/${redditDraftId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ text: 'y'.repeat(40_001) }),
    });
    const bodyRes = await editDraft(tooLongBody, {
      params: Promise.resolve({ id: redditDraftId }),
    });
    assert.equal(bodyRes.status, 400);
  });

  await t.test('approval is owner-only and an edit invalidates it', async () => {
    const intruderRes = await approveDraft(
      new NextRequest(`http://localhost:3000/api/drafts/${redditDraftId}/approve`, {
        method: 'POST',
        headers: { cookie: intruderCookie },
      }),
      { params: Promise.resolve({ id: redditDraftId }) }
    );
    assert.equal(intruderRes.status, 403);

    const ownerRes = await approveDraft(
      new NextRequest(`http://localhost:3000/api/drafts/${redditDraftId}/approve`, {
        method: 'POST',
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: redditDraftId }) }
    );
    assert.equal(ownerRes.status, 200);
    const approved = await ownerRes.json();
    assert.equal(approved.draft.status, 'approved');

    const edit = new NextRequest(`http://localhost:3000/api/drafts/${redditDraftId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ text: 'A changed body.' }),
    });
    const editRes = await editDraft(edit, { params: Promise.resolve({ id: redditDraftId }) });
    assert.equal(editRes.status, 200);
    const edited = await editRes.json();
    assert.equal(edited.draft.status, 'edited');
    assert.equal(edited.draft.approvedText, undefined);
  });

  await t.test('subreddit discovery requires an owner session and a connection', async () => {
    const noSession = await searchSubreddits(
      new NextRequest(
        `http://localhost:3000/api/platforms/reddit/subreddits?projectId=${project.id}&q=code`
      )
    );
    assert.equal(noSession.status, 401);

    const intruderRes = await searchSubreddits(
      new NextRequest(
        `http://localhost:3000/api/platforms/reddit/subreddits?projectId=${project.id}&q=code`,
        { headers: { cookie: intruderCookie } }
      )
    );
    assert.equal(intruderRes.status, 403);

    const noConnection = await searchSubreddits(
      new NextRequest(
        `http://localhost:3000/api/platforms/reddit/subreddits?projectId=${project.id}&q=code`,
        { headers: { cookie: ownerCookie } }
      )
    );
    assert.equal(noConnection.status, 404);
    const noConnectionBody = await noConnection.json();
    assert.equal(noConnectionBody.code, 'connection_not_found');
  });

  // Connect the owner's Reddit account before discovery and validation.
  const { authorizationUrl } = await beginRedditAuthorization({
    userId: ownerId,
    projectId: project.id,
    sessionId: 'api-session',
  });
  const connection = await completeRedditAuthorization({
    userId: ownerId,
    state: new URL(authorizationUrl).searchParams.get('state') || '',
    code: 'code',
    sessionId: 'api-session',
  });

  await t.test('connection summaries never expose credential material', async () => {
    const res = await listConnections(
      new NextRequest(
        `http://localhost:3000/api/platforms/connections?projectId=${project.id}`,
        { headers: { cookie: ownerCookie } }
      )
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.connections.length, 1);
    const summary = data.connections[0];
    assert.equal(summary.platformId, 'reddit');
    assert.equal(summary.externalAccountName, 'mock_reddit_user');
    const serialized = JSON.stringify(data);
    assert.ok(!serialized.includes('mock-reddit-access'));
    assert.ok(!serialized.includes('mock-reddit-refresh'));
    assert.equal(summary.accessTokenCiphertext, undefined);
    assert.equal(summary.refreshTokenCiphertext, undefined);
    assert.equal(connection.status, 'active');
  });

  await t.test('the owner can search and load a subreddit', async () => {
    const search = await searchSubreddits(
      new NextRequest(
        `http://localhost:3000/api/platforms/reddit/subreddits?projectId=${project.id}&q=program`,
        { headers: { cookie: ownerCookie } }
      )
    );
    assert.equal(search.status, 200);
    const searchData = await search.json();
    assert.equal(searchData.subreddits[0].name, 'programming');

    const detailsRes = await subredditDetails(
      new NextRequest(
        `http://localhost:3000/api/platforms/reddit/subreddits/programming?projectId=${project.id}`,
        { headers: { cookie: ownerCookie } }
      ),
      { params: Promise.resolve({ name: 'programming' }) }
    );
    assert.equal(detailsRes.status, 200);
    const details = await detailsRes.json();
    assert.equal(details.subreddit.name, 'programming');
    assert.ok(Array.isArray(details.rules));
    assert.ok(details.requirements);
  });

  await t.test('live validation is owner-only and reports unverifiable rules', async () => {
    const intruderRes = await validateReddit(
      new NextRequest(`http://localhost:3000/api/drafts/${redditDraftId}/reddit/check`, {
        method: 'POST',
        headers: { cookie: intruderCookie },
      }),
      { params: Promise.resolve({ id: redditDraftId }) }
    );
    assert.equal(intruderRes.status, 403);

    const discord = await storage.createDraft({
      projectId: project.id,
      platformId: 'discord',
      text: 'Discord text',
    });
    const wrongPlatform = await validateReddit(
      new NextRequest(`http://localhost:3000/api/drafts/${discord.id}/reddit/check`, {
        method: 'POST',
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: discord.id }) }
    );
    assert.equal(wrongPlatform.status, 400);

    const res = await validateReddit(
      new NextRequest(`http://localhost:3000/api/drafts/${redditDraftId}/reddit/check`, {
        method: 'POST',
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: redditDraftId }) }
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.checks));
    assert.ok(Array.isArray(data.unverifiable));
    assert.ok(
      data.unverifiable.some((item: string) => item.includes('Moderators may still remove'))
    );
    assert.equal(data.subreddit.name, 'programming');
  });

  await t.test('a second project cannot reuse another project’s connection', async () => {
    const second = await storage.createProject({
      ownerLogin: owner.login,
      ownerId: owner.id,
      repoFullName: 'reddit-api-owner/second',
      repoName: 'second',
      repoOwner: 'reddit-api-owner',
      title: 'Second',
    });
    const res = await searchSubreddits(
      new NextRequest(
        `http://localhost:3000/api/platforms/reddit/subreddits?projectId=${second.id}&q=program`,
        { headers: { cookie: ownerCookie } }
      )
    );
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.code, 'connection_not_found');
  });

  await t.test('the authorize route refuses unauthenticated and non-owner callers', async () => {
    const noSession = await authorizeReddit(
      new NextRequest('http://localhost:3000/api/platforms/reddit/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      })
    );
    assert.equal(noSession.status, 401);

    const intruderRes = await authorizeReddit(
      new NextRequest('http://localhost:3000/api/platforms/reddit/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: intruderCookie },
        body: JSON.stringify({ projectId: project.id }),
      })
    );
    assert.equal(intruderRes.status, 403);
  });

  await t.test('the drafts list includes the Reddit submission fields', async () => {
    const res = await getDrafts(
      new NextRequest(`http://localhost:3000/api/projects/${project.id}/drafts`, {
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: project.id }) }
    );
    assert.equal(res.status, 200);
    const data = await res.json();
    const reddit = data.drafts.find((draft: { platformId: string }) => draft.platformId === 'reddit');
    assert.ok(reddit);
    assert.equal(reddit.subreddit, 'programming');
    assert.equal(reddit.submissionType, 'self');
    assert.ok(Array.isArray(reddit.checks));
  });

  setOAuthClientForTests('reddit', null);
});
