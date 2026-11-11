import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { config } from '../src/config/index';
import {
  LINKEDIN_CALLBACK_PATH,
  LINKEDIN_DEFAULT_API_VERSION,
  LINKEDIN_LATEST_DOCUMENTED_VERSION,
  LINKEDIN_ORGANIZATION_SCOPE,
  LINKEDIN_POST_LIMIT,
  LINKEDIN_SCOPES,
  LINKEDIN_SCOPE_STRING,
  LinkedInConfigError,
  isLinkedInConfigured,
  linkedInApiHeaders,
  linkedInMemberUrn,
  linkedInPostUrlFromUrn,
  linkedInPostsUrl,
  linkedInRedirectUri,
  linkedInUserInfoUrl,
  resolveLinkedInApiVersion,
  resolveLinkedInCredentials,
  validateLinkedInApiVersion,
} from '../src/posting/linkedin/config';

const configCode = (err: unknown) =>
  err instanceof LinkedInConfigError ? err.code : 'unexpected';

// A fixed clock keeps the one-year support window deterministic.
const NOW = new Date('2026-11-11T00:00:00.000Z');

test('LinkedIn API version is managed in one place', async (t) => {
  await t.test('the documented version and protocol constants are stable', () => {
    assert.equal(LINKEDIN_DEFAULT_API_VERSION, '202610');
    assert.equal(LINKEDIN_LATEST_DOCUMENTED_VERSION, '202610');
    assert.equal(LINKEDIN_CALLBACK_PATH, '/api/platforms/linkedin/callback');
    assert.equal(LINKEDIN_POST_LIMIT, 3000);
    assert.equal(LINKEDIN_ORGANIZATION_SCOPE, 'w_organization_social');
    assert.deepEqual([...LINKEDIN_SCOPES], ['openid', 'profile', 'w_member_social']);
    assert.equal(LINKEDIN_SCOPE_STRING, 'openid profile w_member_social');
  });

  await t.test('a current version is accepted unchanged', () => {
    assert.equal(validateLinkedInApiVersion('202610', NOW), '202610');
    // 202511 is the oldest version still inside the 12-month window.
    assert.equal(validateLinkedInApiVersion('202511', NOW), '202511');
  });

  await t.test('a version outside the support window is rejected clearly', () => {
    assert.throws(
      () => validateLinkedInApiVersion('202510', NOW),
      (err) =>
        configCode(err) === 'unsupported_version' &&
        err instanceof Error &&
        err.message.includes('12-month') &&
        err.message.includes('202610')
    );
  });

  await t.test('malformed versions fail closed', () => {
    for (const value of ['', '2026-10', '20261', '2026', '202613', '202600', 'abcd12']) {
      assert.throws(
        () => validateLinkedInApiVersion(value, NOW),
        (err) => configCode(err) === 'invalid_version',
        `expected ${JSON.stringify(value)} to be rejected`
      );
    }
  });

  await t.test('an unset version resolves to the documented default', () => {
    assert.equal(resolveLinkedInApiVersion('', NOW), '202610');
    assert.equal(resolveLinkedInApiVersion('   ', NOW), '202610');
    assert.equal(resolveLinkedInApiVersion(undefined, NOW), '202610');
    assert.equal(resolveLinkedInApiVersion('202609', NOW), '202609');
  });

  await t.test('every request helper carries the same version and Rest.li headers', () => {
    assert.deepEqual(linkedInApiHeaders('202610'), {
      'linkedin-version': '202610',
      'x-restli-protocol-version': '2.0.0',
    });
  });

  await t.test('URLs are derived from configuration, never from request headers', () => {
    assert.equal(
      linkedInRedirectUri('https://crewlink.example/'),
      'https://crewlink.example/api/platforms/linkedin/callback'
    );
    assert.equal(
      linkedInPostsUrl('https://api.linkedin.com/'),
      'https://api.linkedin.com/rest/posts'
    );
    assert.equal(
      linkedInUserInfoUrl('https://api.linkedin.com//'),
      'https://api.linkedin.com/v2/userinfo'
    );
  });

  await t.test('member URNs come from the verified identifier only', () => {
    assert.equal(linkedInMemberUrn('abc_123-X'), 'urn:li:person:abc_123-X');
    for (const value of ['', 'urn:li:person:abc', 'abc 123', 'abc:123', 'a'.repeat(201)]) {
      assert.throws(
        () => linkedInMemberUrn(value),
        (err) => err instanceof LinkedInConfigError,
        `expected ${JSON.stringify(value)} to be rejected`
      );
    }
  });

  await t.test('feed links are derived only from documented post URNs', () => {
    assert.equal(
      linkedInPostUrlFromUrn('urn:li:share:7123456789012345678'),
      'https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678'
    );
    assert.equal(
      linkedInPostUrlFromUrn('urn:li:ugcPost:7123456789012345678'),
      'https://www.linkedin.com/feed/update/urn:li:ugcPost:7123456789012345678'
    );
    for (const value of [
      '',
      'urn:li:activity:7123456789012345678',
      'urn:li:share:not-a-number',
      'https://www.linkedin.com/feed/update/urn:li:share:1',
    ]) {
      assert.equal(linkedInPostUrlFromUrn(value), undefined);
    }
  });

  await t.test('missing credentials disable LinkedIn instead of half-working', () => {
    assert.equal(isLinkedInConfigured(), true);
    assert.deepEqual(resolveLinkedInCredentials(), {
      clientId: 'test-linkedin-client-id',
      clientSecret: 'test-linkedin-client-secret',
    });

    const savedId = config.linkedinClientId;
    const savedSecret = config.linkedinClientSecret;
    config.linkedinClientId = '';
    try {
      assert.equal(isLinkedInConfigured(), false);
      assert.throws(
        () => resolveLinkedInCredentials(),
        (err) =>
          configCode(err) === 'missing_credentials' &&
          err instanceof Error &&
          err.message.includes('LINKEDIN_CLIENT_ID')
      );
    } finally {
      config.linkedinClientId = savedId;
      config.linkedinClientSecret = savedSecret;
    }
  });
});
