import test from 'node:test';
import assert from 'node:assert/strict';
import { storage } from '../src/lib/storage';

test('Storage CRUD operations (TypeScript)', async (t) => {
  storage.reset();

  await t.test('saves and retrieves user', () => {
    const user = storage.saveUser({
      id: 101,
      login: 'alice',
      name: 'Alice',
      avatarUrl: 'https://example.com/alice.png',
      createdAt: '2022-01-01T00:00:00Z',
      publicRepos: 10,
    });

    assert.equal(user.id, '101');
    assert.equal(user.login, 'alice');

    const fetched = storage.getUser('101');
    assert.ok(fetched);
    assert.equal(fetched.login, 'alice');
  });

  await t.test('creates and verifies session', () => {
    const sessionId = storage.createSession('101');
    assert.ok(sessionId);

    const sessionData = storage.getSession(sessionId);
    assert.ok(sessionData);
    assert.equal(sessionData.user.login, 'alice');

    storage.deleteSession(sessionId);
    assert.equal(storage.getSession(sessionId), null);
  });

  await t.test('creates and queries projects', () => {
    const project = storage.createProject({
      ownerLogin: 'alice',
      ownerId: '101',
      repoFullName: 'alice/space-rover',
      repoName: 'space-rover',
      repoOwner: 'alice',
      isPrivate: false,
      joinMode: 'referral',
      title: 'Space Rover',
      description: 'Exploring Mars',
    });

    assert.ok(project.id.startsWith('prj_'));
    assert.ok(project.slug.startsWith('space-rover-'));
    assert.equal(project.isPrivate, false);

    const byId = storage.getProjectById(project.id);
    assert.equal(byId?.title, 'Space Rover');

    const bySlug = storage.getProjectBySlug(project.slug);
    assert.equal(bySlug?.id, project.id);

    const ownerProjects = storage.getProjectsByOwner('alice');
    assert.equal(ownerProjects.length, 1);
  });

  await t.test('creates, queries, and updates applicants', () => {
    const project = storage.listProjects()[0];

    const applicant = storage.createApplicant({
      projectId: project.id,
      userId: '202',
      userLogin: 'bob',
      userAvatar: 'https://example.com/bob.png',
      accountAge: '1 year, 2 months',
      publicRepoCount: 7,
      message: 'Looking forward to building this!',
    });

    assert.ok(applicant.id.startsWith('app_'));
    assert.equal(applicant.status, 'pending');
    assert.equal(applicant.accountAge, '1 year, 2 months');

    const found = storage.findApplicant(project.id, '202');
    assert.ok(found);
    assert.equal(found.id, applicant.id);

    const updated = storage.updateApplicantStatus(applicant.id, 'approved', { inviteId: 999 });
    assert.equal(updated?.status, 'approved');
    assert.equal(updated?.invitationSent, true);
  });
});
