import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { RateLimiter } from '../src/lib/rateLimit';

test('rate limiter: tracks requests within window and blocks exceeding quota', () => {
  const limiter = new RateLimiter(3, 1000); // 3 requests per second
  const fakeReq = new Request('http://localhost:3000/api/test', {
    headers: { 'x-forwarded-for': '203.0.113.195' },
  });

  const res1 = limiter.check(fakeReq, { limit: 3, windowMs: 1000, keyPrefix: 'test' });
  assert.equal(res1.success, true);
  assert.equal(res1.remaining, 2);

  const res2 = limiter.check(fakeReq, { limit: 3, windowMs: 1000, keyPrefix: 'test' });
  assert.equal(res2.success, true);
  assert.equal(res2.remaining, 1);

  const res3 = limiter.check(fakeReq, { limit: 3, windowMs: 1000, keyPrefix: 'test' });
  assert.equal(res3.success, true);
  assert.equal(res3.remaining, 0);

  // 4th request exceeds limit
  const res4 = limiter.check(fakeReq, { limit: 3, windowMs: 1000, keyPrefix: 'test' });
  assert.equal(res4.success, false);
  assert.equal(res4.remaining, 0);
  assert.ok(res4.retryAfterSeconds >= 1);

  // Check 429 response structure
  const response = limiter.createResponse(res4);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('X-RateLimit-Limit'), '3');
  assert.equal(response.headers.get('X-RateLimit-Remaining'), '0');
  assert.ok(response.headers.has('Retry-After'));
});

test('rate limiter: isolates limits by IP address and key prefix', () => {
  const limiter = new RateLimiter(2, 2000);
  const ip1Req = new Request('http://localhost:3000/api/test', {
    headers: { 'x-forwarded-for': '1.1.1.1' },
  });
  const ip2Req = new Request('http://localhost:3000/api/test', {
    headers: { 'x-forwarded-for': '2.2.2.2' },
  });

  assert.equal(limiter.check(ip1Req, { limit: 1 }).success, true);
  assert.equal(limiter.check(ip1Req, { limit: 1 }).success, false);

  // Different IP is unaffected
  assert.equal(limiter.check(ip2Req, { limit: 1 }).success, true);
});
