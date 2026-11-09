import test from 'node:test';
import assert from 'node:assert/strict';
import { signValue, verifySignedValue } from '../src/lib/request.js';
import { storage } from '../src/lib/storage.js';
import { getCurrentUser } from '../src/auth/index.js';

test('Authentication and session signing', async (t) => {
  storage.reset();

  await t.test('signs and verifies cookie values with tamper protection', () => {
    const rawId = 'session-token-12345';
    const signed = signValue(rawId);
    assert.ok(signed.startsWith(`${rawId}.`));

    // Valid verification
    const verified = verifySignedValue(signed);
    assert.equal(verified, rawId);

    // Tampered verification fails
    const tampered = `${rawId}evil.${signed.split('.')[1]}`;
    assert.equal(verifySignedValue(tampered), null);

    // Invalid formats
    assert.equal(verifySignedValue('no-dot-here'), null);
    assert.equal(verifySignedValue(null), null);
  });

  await t.test('retrieves current user from signed cookie', () => {
    const user = storage.saveUser({
      id: 555,
      login: 'dana-dev',
      name: 'Dana',
      avatarUrl: 'https://example.com/dana.png',
      createdAt: '2023-01-01T00:00:00Z',
      publicRepos: 12
    });

    const sessionId = storage.createSession(user.id);
    const signedSession = signValue(sessionId);

    // Mock incoming request with cookie
    const req = {
      headers: {
        cookie: `crewlink_session=${encodeURIComponent(signedSession)}`
      }
    };

    const currentUser = getCurrentUser(req);
    assert.ok(currentUser);
    assert.equal(currentUser.login, 'dana-dev');
  });

  await t.test('returns null when session is missing or invalid', () => {
    assert.equal(getCurrentUser({ headers: {} }), null);
    assert.equal(getCurrentUser({ headers: { cookie: 'crewlink_session=bogus.signature' } }), null);
  });
});
