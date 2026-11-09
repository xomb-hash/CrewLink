import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { encryptSecret, decryptSecret, isEncrypted } from '../src/lib/crypto';

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

test('crypto: avoids double encryption if string is already encrypted', () => {
  const secret = 'gho_token_value';
  const encrypted1 = encryptSecret(secret);
  const encrypted2 = encryptSecret(encrypted1);

  assert.equal(encrypted1, encrypted2);
  assert.equal(decryptSecret(encrypted2), secret);
});

test('crypto: returns legacy/unencrypted strings as-is for backward compatibility', () => {
  const legacy = 'gho_legacy_plaintext_token';
  assert.equal(decryptSecret(legacy), legacy);
  assert.equal(decryptSecret(''), '');
  assert.equal(decryptSecret(null), '');
});

test('crypto: rejects tampered ciphertext', () => {
  const secret = 'gho_tamper_test';
  const encrypted = encryptSecret(secret);
  const parts = encrypted.split(':');
  
  // Flip a character in the ciphertext
  const tamperedCipher = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'a' ? 'b' : 'a');
  const tampered = `${parts[0]}:${parts[1]}:${tamperedCipher}`;

  // Decryption should fail integrity check and return empty string
  const result = decryptSecret(tampered);
  assert.equal(result, '');
});
