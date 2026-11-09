import test from 'node:test';
import assert from 'node:assert/strict';
import { appRouter } from '../src/app.js';
import { storage } from '../src/lib/storage.js';

test('Application HTTP router', async (t) => {
  storage.reset();

  function makeRequest(pathname, method = 'GET', headers = {}) {
    const req = {
      method,
      url: pathname,
      headers: {
        host: 'localhost:3000',
        ...headers
      },
      on(event, handler) {
        if (event === 'end') handler();
        return this;
      }
    };

    let statusCode = 200;
    let headersSet = {};
    let responseBody = '';

    const res = {
      writeHead(code, h) {
        statusCode = code;
        if (h) headersSet = { ...headersSet, ...h };
      },
      setHeader(k, v) { headersSet[k] = v; },
      getHeader(k) { return headersSet[k]; },
      end(chunk) {
        if (chunk) responseBody += chunk.toString();
      }
    };

    return { req, res, get: () => ({ statusCode, headersSet, responseBody }) };
  }

  await t.test('serves homepage HTML at /', async () => {
    const { req, res, get } = makeRequest('/');
    await appRouter(req, res);
    const { statusCode, responseBody } = get();

    assert.equal(statusCode, 200);
    assert.ok(responseBody.includes('Crewlink'));
    assert.ok(responseBody.includes('Where builders find each other'));
  });

  await t.test('redirects unauthenticated user from /dashboard to /auth/github', async () => {
    const { req, res, get } = makeRequest('/dashboard');
    await appRouter(req, res);
    const { statusCode, headersSet } = get();

    assert.equal(statusCode, 302);
    assert.equal(headersSet.Location, '/auth/github?redirect_to=/dashboard');
  });

  await t.test('serves join page at /join/:slug', async () => {
    const project = storage.createProject({
      ownerLogin: 'alice',
      ownerId: '101',
      repoFullName: 'alice/rover',
      repoName: 'rover',
      repoOwner: 'alice',
      title: 'Mars Rover'
    });

    const { req, res, get } = makeRequest(`/join/${project.slug}`);
    await appRouter(req, res);
    const { statusCode, responseBody } = get();

    assert.equal(statusCode, 200);
    assert.ok(responseBody.includes('Join Project'));
  });

  await t.test('serves static CSS files correctly', async () => {
    const { req, res, get } = makeRequest('/styles/main.css');
    await appRouter(req, res);
    const { statusCode, headersSet, responseBody } = get();

    assert.equal(statusCode, 200);
    assert.ok(headersSet['Content-Type'].includes('text/css'));
    assert.ok(responseBody.includes('--bg-primary'));
  });

  await t.test('returns 404 for unknown routes', async () => {
    const { req, res, get } = makeRequest('/non-existent-route');
    await appRouter(req, res);
    const { statusCode, responseBody } = get();

    assert.equal(statusCode, 404);
    assert.ok(responseBody.includes('404 - Page Not Found'));
  });
});
