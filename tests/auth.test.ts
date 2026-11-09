import test from 'node:test';
import assert from 'node:assert/strict';
import { signValue, verifySignedValue } from '../src/lib/auth';
import { storage } from '../src/lib/storage';

test('Authentication and session signing (TypeScript)', async (t) => {
  storage.reset();

  await t.test('signs and verifies cookie values with tamper protection', () => {
    const rawId = 'session-token-12345';
    const signed = signValue(rawId);
    assert.ok(signed.startsWith(`${rawId}.`));

    const verified = verifySignedValue(signed);
    assert.equal(verified, rawId);

    const tampered = `${rawId}evil.${signed.split('.')[1]}`;
    assert.equal(verifySignedValue(tampered), null);

    assert.equal(verifySignedValue('no-dot-here'), null);
    assert.equal(verifySignedValue(null), null);
  });

  await t.test('retrieves user from session storage via valid session ID', () => {
    const user = storage.saveUser({
      id: 555,
      login: 'dana-dev',
      name: 'Dana',
      avatarUrl: 'https://example.com/dana.png',
      createdAt: '2023-01-01T00:00:00Z',
      publicRepos: 12,
    });

    const sessionId = storage.createSession(user.id);
    const sessionData = storage.getSession(sessionId);

    assert.ok(sessionData);
    assert.equal(sessionData.user.login, 'dana-dev');
  });
});
