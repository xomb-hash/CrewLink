import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import {
  LocalCredentialVault,
  GcpKmsVault,
  CredentialConfigError,
  CredentialDecryptionError,
  CredentialEncryptionError,
  getCredentialVault,
  resetCredentialVaultForTests,
  type EncryptedCredential,
  type KmsClientLike,
} from '../src/posting/credentials';

const context = { userId: 'u1', platformId: 'x', connectionId: 'c1' };
const secret = 'crewlink-test-encryption-secret-32-chars';

test('LocalCredentialVault', async (t) => {
  await t.test('round-trips a token without leaving plaintext in the ciphertext', async () => {
    const vault = new LocalCredentialVault({ ENCRYPTION_SECRET: secret });
    const credential = await vault.encrypt('gho_plain_access_token', context);

    assert.equal(credential.provider, 'local');
    assert.equal(credential.keyRef, 'local:v1');
    assert.ok(credential.ciphertext.startsWith('crewlink:v1:local:v1:'));
    assert.ok(!credential.ciphertext.includes('gho_plain_access_token'));
    assert.equal(await vault.decrypt(credential, context), 'gho_plain_access_token');
  });

  await t.test('uses a fresh IV for every encryption', async () => {
    const vault = new LocalCredentialVault({ ENCRYPTION_SECRET: secret });
    const first = await vault.encrypt('same-token', context);
    const second = await vault.encrypt('same-token', context);

    assert.notEqual(first.ciphertext, second.ciphertext);
    assert.equal(await vault.decrypt(second, context), 'same-token');
  });

  await t.test('binds ciphertext to user, platform and connection (AAD)', async () => {
    const vault = new LocalCredentialVault({ ENCRYPTION_SECRET: secret });
    const credential = await vault.encrypt('token', context);

    for (const other of [
      { ...context, userId: 'u2' },
      { ...context, platformId: 'linkedin' },
      { ...context, connectionId: 'c2' },
    ]) {
      await assert.rejects(() => vault.decrypt(credential, other), CredentialDecryptionError);
    }
  });

  await t.test('encrypts with the newest key version and decrypts older versions', async () => {
    const env = { ENCRYPTION_SECRET_V1: 'first-version-secret', ENCRYPTION_SECRET_V2: 'second-version-secret' };
    const oldVault = new LocalCredentialVault({ ENCRYPTION_SECRET_V1: env.ENCRYPTION_SECRET_V1 });
    const oldCredential = await oldVault.encrypt('old-token', context);

    const vault = new LocalCredentialVault(env);
    const newCredential = await vault.encrypt('new-token', context);

    assert.equal(oldCredential.keyRef, 'local:v1');
    assert.equal(newCredential.keyRef, 'local:v2');
    assert.equal(await vault.decrypt(oldCredential, context), 'old-token');
    assert.equal(await vault.decrypt(newCredential, context), 'new-token');
  });

  await t.test('rejects a key reference that does not match the ciphertext', async () => {
    const vault = new LocalCredentialVault({ ENCRYPTION_SECRET: secret });
    const credential = await vault.encrypt('token', context);
    await assert.rejects(
      () => vault.decrypt({ ...credential, keyRef: 'local:v2' }, context),
      CredentialDecryptionError
    );
  });

  await t.test('rejects malformed ciphertext and the wrong provider', async () => {
    const vault = new LocalCredentialVault({ ENCRYPTION_SECRET: secret });
    const malformed: EncryptedCredential = {
      ciphertext: 'not-a-valid-envelope',
      provider: 'local',
      keyRef: 'local:v1',
    };
    await assert.rejects(() => vault.decrypt(malformed, context), CredentialDecryptionError);
    await assert.rejects(
      () => vault.decrypt({ ...malformed, provider: 'gcp' }, context),
      CredentialDecryptionError
    );
  });

  await t.test('fails closed without a configured secret', async () => {
    const vault = new LocalCredentialVault({});
    await assert.rejects(() => vault.encrypt('token', context), CredentialConfigError);
  });

  await t.test('rejects an empty plaintext', async () => {
    const vault = new LocalCredentialVault({ ENCRYPTION_SECRET: secret });
    await assert.rejects(() => vault.encrypt('', context), CredentialEncryptionError);
  });
});

test('GcpKmsVault', async (t) => {
  const keyName = 'projects/demo/locations/global/keyRings/crewlink/cryptoKeys/social-tokens';

  function fakeClient(overrides: Partial<KmsClientLike> = {}) {
    const encryptRequests: Array<Record<string, unknown>> = [];
    const decryptRequests: Array<Record<string, unknown>> = [];
    const client: KmsClientLike = {
      async encrypt(request) {
        encryptRequests.push(request as unknown as Record<string, unknown>);
        return [
          {
            ciphertext: Buffer.from('kms-ciphertext'),
            name: `${request.name}/cryptoKeyVersions/7`,
          },
        ];
      },
      async decrypt(request) {
        decryptRequests.push(request as unknown as Record<string, unknown>);
        return [{ plaintext: Buffer.from('kms-plaintext-token') }];
      },
      ...overrides,
    };
    return { client, encryptRequests, decryptRequests };
  }

  await t.test('sends the AAD to KMS and stores the returned key version', async () => {
    const { client, encryptRequests } = fakeClient();
    const vault = new GcpKmsVault({ keyName, client });
    const credential = await vault.encrypt('token', context);

    assert.equal(credential.provider, 'gcp');
    assert.equal(credential.keyRef, `${keyName}/cryptoKeyVersions/7`);
    assert.equal(credential.ciphertext, Buffer.from('kms-ciphertext').toString('base64'));
    assert.equal(encryptRequests[0].name, keyName);
    assert.equal(
      Buffer.from(encryptRequests[0].additionalAuthenticatedData as Buffer).toString('utf8'),
      'crewlink:v1:gcp:u1:x:c1'
    );
  });

  await t.test('decrypts with the stored key reference and AAD', async () => {
    const { client, decryptRequests } = fakeClient();
    const vault = new GcpKmsVault({ keyName, client });
    const credential: EncryptedCredential = {
      ciphertext: Buffer.from('kms-ciphertext').toString('base64'),
      provider: 'gcp',
      keyRef: `${keyName}/cryptoKeyVersions/7`,
    };

    assert.equal(await vault.decrypt(credential, context), 'kms-plaintext-token');
    assert.equal(decryptRequests[0].name, `${keyName}/cryptoKeyVersions/7`);
    assert.equal(
      Buffer.from(decryptRequests[0].additionalAuthenticatedData as Buffer).toString('utf8'),
      'crewlink:v1:gcp:u1:x:c1'
    );
  });

  await t.test('fails closed on KMS errors instead of falling back to local encryption', async () => {
    const encryptFails = fakeClient({
      async encrypt() {
        throw new Error('KMS unavailable');
      },
    });
    const decryptFails = fakeClient({
      async decrypt() {
        throw new Error('KMS unavailable');
      },
    });

    await assert.rejects(
      () => new GcpKmsVault({ keyName, client: encryptFails.client }).encrypt('token', context),
      CredentialEncryptionError
    );
    await assert.rejects(
      () =>
        new GcpKmsVault({ keyName, client: decryptFails.client }).decrypt(
          { ciphertext: 'abc', provider: 'gcp', keyRef: keyName },
          context
        ),
      CredentialDecryptionError
    );
  });

  await t.test('requires a KMS key resource', async () => {
    const { client } = fakeClient();
    const vault = new GcpKmsVault({ keyName: '', client });
    await assert.rejects(() => vault.encrypt('token', context), CredentialConfigError);
  });

  await t.test('rejects credentials from the other provider', async () => {
    const { client } = fakeClient();
    const vault = new GcpKmsVault({ keyName, client });
    await assert.rejects(
      () =>
        vault.decrypt(
          { ciphertext: 'abc', provider: 'local', keyRef: 'local:v1' },
          context
        ),
      CredentialDecryptionError
    );
  });
});

test('credential vault factory', async (t) => {
  await t.test('uses the local provider in tests', () => {
    resetCredentialVaultForTests();
    assert.equal(getCredentialVault().provider, 'local');
    resetCredentialVaultForTests();
  });
});
