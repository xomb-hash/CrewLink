import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeGitHubApi } from '../src/github/fake.js';

test('Fake GitHub API client', async (t) => {
  const fake = new FakeGitHubApi();

  await t.test('authenticates mock user', async () => {
    const user = await fake.getAuthenticatedUser('fake-token-alice');
    assert.equal(user.login, 'alice-owner');
    assert.equal(user.publicRepos, 14);
  });

  await t.test('exchanges code for access token', async () => {
    const token = await fake.exchangeCodeForToken({ code: 'code-alice-owner' });
    assert.equal(token, 'fake-token-alice-owner');
  });

  await t.test('lists only repositories where user has admin access', async () => {
    const repos = await fake.getUserAdminRepos('fake-token-alice');
    assert.ok(repos.length >= 2);
    assert.ok(repos.some((r) => r.fullName === 'alice-owner/rocket-ship'));

    const bobRepos = await fake.getUserAdminRepos('fake-token-bob');
    assert.equal(bobRepos.length, 0); // Bob has no admin repos initially
  });

  await t.test('checks admin permission accurately', async () => {
    const isAliceAdmin = await fake.checkAdminAccess('fake-token-alice', 'alice-owner', 'rocket-ship');
    assert.equal(isAliceAdmin, true);

    const isBobAdmin = await fake.checkAdminAccess('fake-token-bob', 'alice-owner', 'rocket-ship');
    assert.equal(isBobAdmin, false);
  });

  await t.test('sends collaborator invitation and records it', async () => {
    const result = await fake.inviteCollaborator({
      accessToken: 'fake-token-alice',
      owner: 'alice-owner',
      repo: 'rocket-ship',
      username: 'bob-builder'
    });

    assert.equal(result.status, 'invited');
    assert.ok(result.invitationId);
    assert.equal(fake.invitations.length, 1);
    assert.equal(fake.invitations[0].username, 'bob-builder');
  });

  await t.test('rejects invitation if inviter is not admin', async () => {
    await assert.rejects(
      async () => {
        await fake.inviteCollaborator({
          accessToken: 'fake-token-bob',
          owner: 'alice-owner',
          repo: 'rocket-ship',
          username: 'charlie'
        });
      },
      /does not have admin permissions/
    );
  });
});
