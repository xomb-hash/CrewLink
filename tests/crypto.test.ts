import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  EncryptionConfigError,
  DecryptionError,
} from '../src/lib/crypto';

test('crypto: encrypts plaintext with AES-256-GCM format', () => {
  const secret = 'gho_16characterfakegithubtoken12345';
  const encrypted = encryptSecret(secret);

  assert.notEqual(encrypted, secret);
  assert.ok(isEncrypted(encrypted));
  const parts = encrypted.split(':');
  assert.equal(parts.length, 3);
  assert.equal(parts[0].length, 24); // 12-byte IV in hex
  assert.equal(parts[1].length, 32); // 16-byte Auth Tag in hex
});

test('crypto: decrypts encrypted ciphertext back to plaintext', () => {
  const secret = 'gho_supersecrettoken_abc123';
  const encrypted = encryptSecret(secret);
  const decrypted = decryptSecret(encrypted);

  assert.equal(decrypted, secret);
});

test('crypto: always encrypts, even when handed ciphertext', () => {
  const secret = 'gho_token_value';
  const encrypted1 = encryptSecret(secret);
  const encrypted2 = encryptSecret(encrypted1);

  // encryptSecret is not idempotent; callers guard with isEncrypted (see saveUser).
  assert.notEqual(encrypted1, encrypted2);
  assert.equal(decryptSecret(encrypted1), secret);
  assert.equal(decryptSecret(encrypted2), encrypted1);
});

test('crypto: returns legacy/unencrypted strings as-is for backward compatibility', () => {
  const legacy = 'gho_legacy_plaintext_token';
  assert.equal(decryptSecret(legacy), legacy);
  assert.equal(decryptSecret(''), '');
  assert.equal(decryptSecret(null), '');
});

test('crypto: rejects tampered ciphertext instead of returning an empty string', () => {
  const secret = 'gho_tamper_test';
  const encrypted = encryptSecret(secret);
  const parts = encrypted.split(':');
  
  // Flip a character in the ciphertext
  const tamperedCipher = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'a' ? 'b' : 'a');
  const tampered = `${parts[0]}:${parts[1]}:${tamperedCipher}`;

  assert.throws(() => decryptSecret(tampered), DecryptionError);
});

test('crypto: fails closed when no encryption secret is configured', () => {
  const secret = process.env.ENCRYPTION_SECRET;
  const sessionSecret = process.env.SESSION_SECRET;
  delete process.env.ENCRYPTION_SECRET;
  delete process.env.SESSION_SECRET;

  try {
    assert.throws(() => encryptSecret('gho_value'), EncryptionConfigError);
  } finally {
    if (secret !== undefined) process.env.ENCRYPTION_SECRET = secret;
    if (sessionSecret !== undefined) process.env.SESSION_SECRET = sessionSecret;
  }
});
