import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { RedditClient, REDDIT_SCOPE_STRING } from '../src/posting/adapters/reddit';
import { AdapterError } from '../src/posting/adapters/types';

interface CapturedRequest {
  url: string;
  init: RequestInit;
  body: string;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function clientWith(
  respond: (request: CapturedRequest) => Response | Promise<Response>
): { client: RedditClient; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const client = new RedditClient({
    apiBaseUrl: 'https://oauth.reddit.test',
    authorizeUrl: 'https://www.reddit.test/api/v1/authorize',
    tokenUrl: 'https://www.reddit.test/api/v1/access_token',
    revokeUrl: 'https://www.reddit.test/api/v1/revoke_token',
    userAgent: 'crewlink-test/1.0',
    fetchImpl: async (input, init) => {
      const captured: CapturedRequest = {
        url: String(input),
        init: init || {},
        body: typeof init?.body === 'string' ? init.body : '',
      };
      calls.push(captured);
      return respond(captured);
    },
  });
  return { client, calls };
}

const adapterCode = (err: unknown) => (err instanceof AdapterError ? err.code : 'unexpected');

test('Reddit client uses only the official API contract', async (t) => {
  await t.test('the authorization URL requests permanent access with minimum scopes', () => {
    const { client } = clientWith(() => jsonResponse({}));
    const url = new URL(
      client.authorizationUrl({
        clientId: 'client-id',
        redirectUri: 'http://localhost:3100/api/platforms/reddit/callback',
        state: 'state-value',
      })
    );
    assert.equal(url.origin + url.pathname, 'https://www.reddit.test/api/v1/authorize');
    assert.equal(url.searchParams.get('client_id'), 'client-id');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('state'), 'state-value');
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'http://localhost:3100/api/platforms/reddit/callback'
    );
    assert.equal(url.searchParams.get('duration'), 'permanent');
    assert.equal(url.searchParams.get('scope'), REDDIT_SCOPE_STRING);
    assert.equal(url.searchParams.get('scope'), 'identity read submit');
  });

  await t.test('the code exchange uses HTTP Basic auth and verifies identity', async () => {
    const { client, calls } = clientWith((request) => {
      if (request.url.endsWith('/api/v1/access_token')) {
        return jsonResponse({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          token_type: 'bearer',
          scope: 'identity read submit',
        });
      }
      return jsonResponse({ id: 'user-1', name: 'reddit_user' });
    });

    const session = await client.exchangeCode({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      code: 'auth-code',
      redirectUri: 'http://localhost:3100/api/platforms/reddit/callback',
    });

    assert.equal(calls.length, 2);
    const tokenCall = calls[0];
    const headers = tokenCall.init.headers as Record<string, string>;
    assert.equal(
      headers.authorization,
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`
    );
    assert.equal(headers['content-type'], 'application/x-www-form-urlencoded');
    const form = new URLSearchParams(tokenCall.body);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(form.get('code'), 'auth-code');
    assert.equal(
      form.get('redirect_uri'),
      'http://localhost:3100/api/platforms/reddit/callback'
    );
    assert.ok(!tokenCall.body.includes('client-secret'));

    assert.equal(calls[1].url, 'https://oauth.reddit.test/api/v1/me');
    assert.equal(
      (calls[1].init.headers as Record<string, string>).authorization,
      'Bearer access-1'
    );
    assert.deepEqual(session.account, {
      externalAccountId: 'user-1',
      externalAccountName: 'reddit_user',
    });
    assert.equal(session.tokens.accessToken, 'access-1');
    assert.equal(session.tokens.refreshToken, 'refresh-1');
    assert.ok(session.tokens.tokenExpiresAt);
  });

  await t.test('refresh keeps the old refresh token when Reddit does not rotate it', async () => {
    const { client, calls } = clientWith(() =>
      jsonResponse({ access_token: 'access-2', expires_in: 3600 })
    );
    const tokens = await client.refreshSession({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-old',
    });
    assert.equal(tokens.accessToken, 'access-2');
    assert.equal(tokens.refreshToken, 'refresh-old');
    const form = new URLSearchParams(calls[0].body);
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('refresh_token'), 'refresh-old');
  });

  await t.test('subreddit search uses the search endpoint and drops malformed rows', async () => {
    const { client, calls } = clientWith(() =>
      jsonResponse({
        data: {
          children: [
            { data: { display_name: 'programming', title: 'Programming', subscribers: 5 } },
            { data: { display_name: 'opensource', public_description: 'Open source' } },
            { data: {} },
          ],
        },
      })
    );
    const results = await client.searchSubreddits('access', ' open source ', 5);
    assert.equal(calls[0].url.startsWith('https://oauth.reddit.test/subreddits/search?'), true);
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('q'), 'open source');
    assert.equal(url.searchParams.get('limit'), '5');
    assert.equal(url.searchParams.get('include_over_18'), 'false');
    assert.deepEqual(
      results.map((result) => result.name),
      ['programming', 'opensource']
    );
    assert.equal(results[1].description, 'Open source');

    assert.deepEqual(await client.searchSubreddits('access', '   '), []);
    assert.equal(calls.length, 1);
  });

  await t.test('about, rules and requirements are read from the documented endpoints', async () => {
    const { client, calls } = clientWith((request) => {
      if (request.url.endsWith('/about')) {
        return jsonResponse({
          data: {
            display_name: 'programming',
            public_description: 'All about code',
            subscribers: 100,
            subreddit_type: 'public',
            submission_type: 'any',
            over18: false,
          },
        });
      }
      if (request.url.endsWith('/about/rules')) {
        return jsonResponse({
          rules: [{ short_name: 'Be kind', description: 'No abuse', kind: 'all' }],
        });
      }
      return jsonResponse({
        title_text_min_length: 10,
        title_text_max_length: 300,
        body_text_min_length: 5,
        body_text_max_length: 40000,
        body_required: true,
        is_flair_required: true,
        domain_blacklist: ['spam.test'],
      });
    });

    const about = await client.getSubreddit('access', 'programming');
    assert.equal(about.name, 'programming');
    assert.equal(about.subscribers, 100);
    assert.equal(about.submissionType, 'any');
    const rules = await client.getRules('access', 'programming');
    assert.deepEqual(rules, [
      { name: 'Be kind', description: 'No abuse', kind: 'all' },
    ]);
    const requirements = await client.getPostRequirements('access', 'programming');
    assert.equal(requirements.titleMinLength, 10);
    assert.equal(requirements.bodyRequired, true);
    assert.equal(requirements.flairRequired, true);
    assert.deepEqual(requirements.domainBlacklist, ['spam.test']);

    assert.deepEqual(
      calls.map((call) => new URL(call.url).pathname),
      [
        '/r/programming/about',
        '/r/programming/about/rules',
        '/api/v1/programming/post_requirements',
      ]
    );
  });

  await t.test('an invalid subreddit name is rejected before any request', async () => {
    const { client, calls } = clientWith(() => jsonResponse({}));
    await assert.rejects(
      () => client.getSubreddit('access', '../admin'),
      (err) => adapterCode(err) === 'invalid_input'
    );
    await assert.rejects(
      () => client.getRules('access', 'bad name'),
      (err) => adapterCode(err) === 'invalid_input'
    );
    assert.equal(calls.length, 0);
  });

  await t.test('a text submission sends the documented form fields', async () => {
    const { client, calls } = clientWith(() =>
      jsonResponse({
        json: {
          errors: [],
          data: {
            id: 'abc123',
            name: 't3_abc123',
            url: 'https://www.reddit.com/r/programming/comments/abc123/title/',
          },
        },
      })
    );
    const result = await client.submit({
      tokens: { accessToken: 'access-1' },
      subreddit: 'programming',
      kind: 'self',
      title: 'A title',
      body: 'A body',
    });

    const call = calls[0];
    assert.equal(call.url, 'https://oauth.reddit.test/api/submit');
    assert.equal((call.init.headers as Record<string, string>).authorization, 'Bearer access-1');
    const form = new URLSearchParams(call.body);
    assert.equal(form.get('api_type'), 'json');
    assert.equal(form.get('sr'), 'programming');
    assert.equal(form.get('kind'), 'self');
    assert.equal(form.get('title'), 'A title');
    assert.equal(form.get('text'), 'A body');
    assert.equal(form.get('resubmit'), 'false');
    assert.equal(form.get('sendreplies'), 'false');
    assert.equal(form.get('url'), null);
    assert.equal(result.externalId, 't3_abc123');
    assert.equal(
      result.externalUrl,
      'https://www.reddit.com/r/programming/comments/abc123/title/'
    );
  });

  await t.test('a link submission sends url instead of text', async () => {
    const { client, calls } = clientWith(() =>
      jsonResponse({ json: { errors: [], data: { id: 'xyz', name: 't3_xyz' } } })
    );
    const result = await client.submit({
      tokens: { accessToken: 'access-1' },
      subreddit: 'programming',
      kind: 'link',
      title: 'A title',
      url: 'https://example.com/launch',
    });
    const form = new URLSearchParams(calls[0].body);
    assert.equal(form.get('kind'), 'link');
    assert.equal(form.get('url'), 'https://example.com/launch');
    assert.equal(form.get('text'), null);
    // A submission without a reddit.com URL still gets a canonical comments URL.
    assert.equal(result.externalUrl, 'https://www.reddit.com/comments/xyz');
  });

  await t.test('HTTP 200 bodies with json.errors become typed failures', async () => {
    const { client: rateLimited } = clientWith(() =>
      jsonResponse(
        { json: { errors: [['RATELIMIT', 'Looks like you have been doing that too much.']] } },
        200,
        { 'retry-after': '60' }
      )
    );
    await assert.rejects(
      () =>
        rateLimited.submit({
          tokens: { accessToken: 'access' },
          subreddit: 'programming',
          kind: 'self',
          title: 'Title',
          body: 'Body',
        }),
      (err) =>
        err instanceof AdapterError &&
        err.code === 'rate_limited' &&
        err.retryAfterSeconds === 60
    );

    const { client: rejected } = clientWith(() =>
      jsonResponse({ json: { errors: [['SUBREDDIT_NOTALLOWED', 'You may not post there.']] } })
    );
    await assert.rejects(
      () =>
        rejected.submit({
          tokens: { accessToken: 'access' },
          subreddit: 'programming',
          kind: 'self',
          title: 'Title',
          body: 'Body',
        }),
      (err) =>
        err instanceof AdapterError &&
        err.code === 'validation_error' &&
        err.message.includes('may not post')
    );
  });

  await t.test('a response without an id is uncertain, never a success', async () => {
    const { client } = clientWith(() => jsonResponse({ json: { errors: [], data: {} } }));
    await assert.rejects(
      () =>
        client.submit({
          tokens: { accessToken: 'access' },
          subreddit: 'programming',
          kind: 'self',
          title: 'Title',
          body: 'Body',
        }),
      (err) => adapterCode(err) === 'uncertain'
    );
  });

  await t.test('a failed transport is uncertain so a duplicate is never sent', async () => {
    const client = new RedditClient({
      apiBaseUrl: 'https://oauth.reddit.test',
      userAgent: 'crewlink-test/1.0',
      fetchImpl: async () => {
        throw new Error('socket closed');
      },
    });
    await assert.rejects(
      () =>
        client.submit({
          tokens: { accessToken: 'access' },
          subreddit: 'programming',
          kind: 'self',
          title: 'Title',
          body: 'Body',
        }),
      (err) => adapterCode(err) === 'uncertain'
    );
  });

  await t.test('401 and 429 responses map to the shared error codes', async () => {
    const { client: unauthorized } = clientWith(() => jsonResponse({}, 401));
    await assert.rejects(
      () => unauthorized.verifyAccount('access'),
      (err) => adapterCode(err) === 'revoked'
    );
    await assert.rejects(
      () =>
        unauthorized.submit({
          tokens: { accessToken: 'access' },
          subreddit: 'programming',
          kind: 'self',
          title: 'Title',
          body: 'Body',
        }),
      (err) => adapterCode(err) === 'token_expired'
    );

    const { client: throttled } = clientWith(() =>
      jsonResponse({}, 429, { 'x-ratelimit-reset': '90' })
    );
    await assert.rejects(
      () => throttled.searchSubreddits('access', 'code'),
      (err) =>
        err instanceof AdapterError &&
        err.code === 'rate_limited' &&
        err.retryAfterSeconds === 90
    );
  });

  await t.test('revoke uses Basic auth and the documented token hint', async () => {
    const { client, calls } = clientWith(() => new Response(null, { status: 204 }));
    await client.revoke({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      accessToken: 'access-1',
    });
    assert.equal(calls[0].url, 'https://www.reddit.test/api/v1/revoke_token');
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(
      headers.authorization,
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`
    );
    const form = new URLSearchParams(calls[0].body);
    assert.equal(form.get('token'), 'access-1');
    assert.equal(form.get('token_type_hint'), 'access_token');
  });
});
