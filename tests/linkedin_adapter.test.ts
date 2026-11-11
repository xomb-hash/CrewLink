import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import {
  LinkedInClient,
  LINKEDIN_SCOPE_STRING,
  MockLinkedInClient,
  LinkedInConfigError,
} from '../src/posting/adapters';
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
): { client: LinkedInClient; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const client = new LinkedInClient({
    apiBaseUrl: 'https://api.linkedin.test',
    authorizeUrl: 'https://www.linkedin.test/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.test/oauth/v2/accessToken',
    apiVersion: '202610',
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

const account = (id: string, name = 'Ada Lovelace') => ({ sub: id, name });

const byUrl = (calls: CapturedRequest[], suffix: string) =>
  calls.find((call) => call.url.endsWith(suffix));

const adapterCode = (err: unknown) => (err instanceof AdapterError ? err.code : 'unexpected');

test('LinkedIn client uses only the documented official API contract', async (t) => {
  await t.test('the authorization URL carries no PKCE parameters', () => {
    const { client } = clientWith(() => jsonResponse({}));
    const url = new URL(
      client.authorizationUrl({
        clientId: 'client-id',
        redirectUri: 'http://localhost:3000/api/platforms/linkedin/callback',
        state: 'state-value',
      })
    );
    assert.equal(url.origin + url.pathname, 'https://www.linkedin.test/oauth/v2/authorization');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), 'client-id');
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'http://localhost:3000/api/platforms/linkedin/callback'
    );
    assert.equal(url.searchParams.get('state'), 'state-value');
    assert.equal(url.searchParams.get('scope'), LINKEDIN_SCOPE_STRING);
    assert.equal(url.searchParams.get('scope'), 'openid profile w_member_social');
    // LinkedIn does not document PKCE for this flow, so it is never invented.
    assert.equal(url.searchParams.has('code_challenge'), false);
    assert.equal(url.searchParams.has('code_challenge_method'), false);
  });

  await t.test('the code exchange posts a form and verifies identity through userinfo', async () => {
    const { client, calls } = clientWith((request) => {
      if (request.url.endsWith('/oauth/v2/accessToken')) {
        return jsonResponse({
          access_token: 'li-access',
          expires_in: 3600,
          scope: 'openid profile w_member_social',
        });
      }
      return jsonResponse(account('abc123'));
    });

    const session = await client.exchangeCode({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      code: 'auth-code',
      redirectUri: 'http://localhost:3000/api/platforms/linkedin/callback',
    });

    assert.equal(calls.length, 2);
    const tokenCall = calls[0];
    const headers = tokenCall.init.headers as Record<string, string>;
    assert.equal(tokenCall.init.method, 'POST');
    assert.equal(headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(headers['linkedin-version'], '202610');
    assert.equal(headers['x-restli-protocol-version'], '2.0.0');
    const form = new URLSearchParams(tokenCall.body);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(form.get('code'), 'auth-code');
    assert.equal(form.get('client_id'), 'client-id');
    assert.equal(form.get('client_secret'), 'client-secret');
    assert.equal(
      form.get('redirect_uri'),
      'http://localhost:3000/api/platforms/linkedin/callback'
    );

    const userinfoCall = byUrl(calls, '/v2/userinfo');
    assert.ok(userinfoCall);
    const userinfoHeaders = userinfoCall.init.headers as Record<string, string>;
    assert.equal(userinfoHeaders.authorization, 'Bearer li-access');
    assert.equal(userinfoHeaders['linkedin-version'], '202610');
    assert.equal(userinfoHeaders['x-restli-protocol-version'], '2.0.0');

    assert.equal(session.tokens.accessToken, 'li-access');
    // No refresh token is invented when LinkedIn does not issue one.
    assert.equal(session.tokens.refreshToken, undefined);
    assert.ok(session.tokens.tokenExpiresAt);
    assert.deepEqual(session.account, {
      externalAccountId: 'abc123',
      externalAccountName: 'Ada Lovelace',
    });
    assert.deepEqual(session.scopes, ['openid', 'profile', 'w_member_social']);
  });

  await t.test('refresh preserves the refresh token when none is rotated back', async () => {
    const { client, calls } = clientWith(() =>
      jsonResponse({ access_token: 'li-access-2', expires_in: 3600 })
    );

    const tokens = await client.refreshSession({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'refresh-1',
    });

    const form = new URLSearchParams(calls[0].body);
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('refresh_token'), 'refresh-1');
    assert.equal(form.get('client_id'), 'client-id');
    assert.equal(form.get('client_secret'), 'client-secret');
    assert.equal(tokens.accessToken, 'li-access-2');
    assert.equal(tokens.refreshToken, 'refresh-1');
  });

  await t.test('identity falls back to given/family name, then a safe label', async () => {
    const { client } = clientWith((request) => {
      if (request.body.includes('grant_type')) {
        return jsonResponse({ access_token: 'li-access', expires_in: 3600 });
      }
      return jsonResponse({ sub: 'member-1', given_name: 'Grace', family_name: 'Hopper' });
    });
    const session = await client.exchangeCode({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      code: 'code',
      redirectUri: 'http://localhost:3000/callback',
    });
    assert.equal(session.account.externalAccountName, 'Grace Hopper');

    const { client: unnamed } = clientWith(() => jsonResponse({ sub: 'member-2' }));
    assert.deepEqual(await unnamed.verifyAccount('token'), {
      externalAccountId: 'member-2',
      externalAccountName: 'LinkedIn member',
    });
  });

  await t.test('a userinfo response without a member id is rejected', async () => {
    const { client } = clientWith(() => jsonResponse({ name: 'No Id' }));
    await assert.rejects(
      () => client.verifyAccount('token'),
      (err) => adapterCode(err) === 'instance_error'
    );
  });

  await t.test('a post sends the documented payload and stores the returned URN', async () => {
    const { client, calls } = clientWith(() =>
      new Response('', {
        status: 201,
        headers: { 'x-restli-id': 'urn:li:share:7123456789012345678' },
      })
    );

    const result = await client.sendPost({
      tokens: { accessToken: 'li-access' },
      authorId: 'abc123',
      text: 'We are looking for collaborators.',
    });

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.url, 'https://api.linkedin.test/rest/posts');
    assert.equal(call.init.method, 'POST');
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer li-access');
    assert.equal(headers['linkedin-version'], '202610');
    assert.equal(headers['x-restli-protocol-version'], '2.0.0');
    assert.equal(headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(call.body), {
      author: 'urn:li:person:abc123',
      commentary: 'We are looking for collaborators.',
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    });

    assert.equal(result.externalId, 'urn:li:share:7123456789012345678');
    assert.equal(
      result.externalUrl,
      'https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678'
    );
  });

  await t.test('a 201 without a post id is uncertain, never a success', async () => {
    const { client } = clientWith(() => new Response('', { status: 201 }));
    await assert.rejects(
      () =>
        client.sendPost({
          tokens: { accessToken: 'li-access' },
          authorId: 'abc123',
          text: 'Body',
        }),
      (err) => adapterCode(err) === 'uncertain'
    );
  });

  await t.test('platform errors map to typed adapter failures', async () => {
    const sendFailure = async (status: number, body: unknown, headers: Record<string, string> = {}) => {
      const { client } = clientWith(() => jsonResponse(body, status, headers));
      return client
        .sendPost({ tokens: { accessToken: 'token' }, authorId: 'abc123', text: 'Body' })
        .then(() => null, (err: unknown) => err);
    };
    const verifyFailure = async (status: number, body: unknown) => {
      const { client } = clientWith(() => jsonResponse(body, status));
      return client.verifyAccount('token').then(() => null, (err: unknown) => err);
    };

    const unauthorised = await sendFailure(401, { message: 'Invalid token' });
    assert.ok(unauthorised instanceof AdapterError);
    assert.equal(unauthorised.code, 'token_expired');

    const verifyUnauthorised = await verifyFailure(401, { message: 'Invalid token' });
    assert.ok(verifyUnauthorised instanceof AdapterError);
    assert.equal(verifyUnauthorised.code, 'revoked');

    const forbidden = await sendFailure(403, { message: 'Not enough permissions' });
    assert.ok(forbidden instanceof AdapterError);
    assert.equal(forbidden.code, 'validation_error');
    assert.equal(forbidden.message, 'Not enough permissions');

    // Without a platform detail, the error names the likely missing scope.
    const forbiddenBare = await sendFailure(403, {});
    assert.ok(forbiddenBare instanceof AdapterError);
    assert.equal(forbiddenBare.code, 'validation_error');
    assert.ok(forbiddenBare.message.includes('w_member_social'));

    const verifyForbidden = await verifyFailure(403, { message: 'Forbidden' });
    assert.ok(verifyForbidden instanceof AdapterError);
    assert.equal(verifyForbidden.code, 'revoked');

    const limited = await sendFailure(429, { message: 'Too many requests' }, { 'retry-after': '12' });
    assert.ok(limited instanceof AdapterError);
    assert.equal(limited.code, 'rate_limited');
    assert.equal(limited.retryAfterSeconds, 12);

    const tooLong = await sendFailure(422, { serviceErrorCode: 123, code: 'FIELD_LENGTH_TOO_LONG' });
    assert.ok(tooLong instanceof AdapterError);
    assert.equal(tooLong.code, 'validation_error');
    assert.ok(tooLong.message.includes('too long'));

    const invalid = await sendFailure(400, { message: 'Invalid commentary' });
    assert.ok(invalid instanceof AdapterError);
    assert.equal(invalid.code, 'validation_error');
    assert.equal(invalid.message, 'Invalid commentary');

    const version = await sendFailure(426, { message: 'Upgrade Required' });
    assert.ok(version instanceof AdapterError);
    assert.equal(version.code, 'instance_error');
    assert.ok(version.message.includes('202610'));
    assert.ok(version.message.includes('LINKEDIN_API_VERSION'));

    const server = await sendFailure(500, { message: 'Boom' });
    assert.ok(server instanceof AdapterError);
    assert.equal(server.code, 'instance_error');
  });

  await t.test('a lost send response stays uncertain; a lost verify is transport', async () => {
    const failing = (): never => {
      throw new TypeError('network down');
    };
    const sendClient = clientWith(failing).client;
    const sendError = await sendClient
      .sendPost({ tokens: { accessToken: 'token' }, authorId: 'abc123', text: 'Body' })
      .then(() => null, (err: unknown) => err);
    assert.ok(sendError instanceof AdapterError);
    assert.equal(sendError.code, 'uncertain');

    const verifyClient = clientWith(failing).client;
    const verifyError = await verifyClient.verifyAccount('token').then(() => null, (err: unknown) => err);
    assert.ok(verifyError instanceof AdapterError);
    assert.equal(verifyError.code, 'transport_error');
  });

  await t.test('a malformed or sunset version refuses to construct a client', () => {
    assert.throws(
      () => new LinkedInClient({ apiVersion: '2026-10', fetchImpl: async () => jsonResponse({}) }),
      (err) => err instanceof LinkedInConfigError && err.code === 'invalid_version'
    );
    assert.throws(
      () => new LinkedInClient({ apiVersion: '202001', fetchImpl: async () => jsonResponse({}) }),
      (err) => err instanceof LinkedInConfigError && err.code === 'unsupported_version'
    );
  });
});

test('Mock LinkedIn client models access and refresh tokens explicitly', async (t) => {
  await t.test('no refresh token by default, and none fabricated', async () => {
    const client = new MockLinkedInClient();
    const session = await client.exchangeCode();
    assert.equal(session.tokens.accessToken, 'mock-linkedin-access');
    assert.equal(session.tokens.refreshToken, undefined);
    assert.deepEqual(session.scopes, ['openid', 'profile', 'w_member_social']);
    assert.equal(session.account.externalAccountId, 'mock-member-id');
  });

  await t.test('opt-in refresh tokens rotate on refresh', async () => {
    const client = new MockLinkedInClient();
    client.issueRefreshToken = true;
    const session = await client.exchangeCode();
    assert.equal(session.tokens.refreshToken, 'mock-linkedin-refresh-0');

    const refreshed = await client.refreshSession();
    assert.equal(refreshed.accessToken, 'mock-linkedin-access-1');
    assert.equal(refreshed.refreshToken, 'mock-linkedin-refresh-1');
    assert.equal(client.refreshCalls, 1);
  });

  await t.test('a post returns a documented share URN and records the author', async () => {
    const client = new MockLinkedInClient();
    const result = await client.sendPost({
      tokens: { accessToken: 'token' },
      authorId: 'mock-member-id',
      text: 'Hello LinkedIn',
    });
    assert.equal(result.externalId, 'urn:li:share:7000000000000000001');
    assert.equal(
      result.externalUrl,
      'https://www.linkedin.com/feed/update/urn:li:share:7000000000000000001'
    );
    assert.deepEqual(client.posts, [{ authorId: 'mock-member-id', text: 'Hello LinkedIn' }]);
  });

  await t.test('reset clears posts, URLs and failure switches', async () => {
    const client = new MockLinkedInClient();
    client.issueRefreshToken = true;
    client.failAtSend = 1;
    client.failCode = 'rate_limited';
    await client.authorizationUrl({
      clientId: 'client-id',
      redirectUri: 'http://localhost:3000/callback',
      state: 'state',
    });
    client.reset();
    assert.deepEqual(client.posts, []);
    assert.deepEqual(client.authorizationUrls, []);
    assert.equal(client.issueRefreshToken, false);
    assert.equal(client.failAtSend, null);
    assert.equal(client.failCode, 'instance_error');
  });
});
