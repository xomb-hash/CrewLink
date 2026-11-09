import './setup';
import test from 'node:test';
import assert from 'node:assert/strict';
import { storage } from '../src/lib/storage';

test('Storage CRUD operations (TypeScript)', async (t) => {
  storage.reset();

  await t.test('saves and retrieves user', async () => {
    const user = await storage.saveUser({
      id: 101,
      login: 'alice',
      name: 'Alice',
      avatarUrl: 'https://example.com/alice.png',
      createdAt: '2022-01-01T00:00:00Z',
      publicRepos: 10,
    });

    assert.equal(user.id, '101');
    assert.equal(user.login, 'alice');

    const fetched = await storage.getUser('101');
    assert.ok(fetched);
    assert.equal(fetched?.login, 'alice');
  });

  await t.test('creates and verifies session', async () => {
    const sessionId = await storage.createSession('101');
    assert.ok(sessionId);

    const sessionData = await storage.getSession(sessionId);
    assert.ok(sessionData);
    assert.equal(sessionData.user.login, 'alice');

    await storage.deleteSession(sessionId);
    assert.equal(await storage.getSession(sessionId), null);
  });

  await t.test('creates and queries projects', async () => {
    const project = await storage.createProject({
      ownerLogin: 'alice',
      ownerId: '101',
      repoFullName: 'alice/space-rover',
      repoName: 'space-rover',
      repoOwner: 'alice',
      isPrivate: false,
      joinMode: 'referral',
      title: 'Space Rover',
      description: 'Exploring Mars',
      creatorNote: 'Mechanical engineer looking for a co-builder.',
      requireResume: true,
      requireGithubLink: true,
      requireLinkedinLink: true,
    });

    assert.ok(project.id.startsWith('prj_'));
    assert.ok(project.slug.startsWith('space-rover-'));
    assert.equal(project.isPrivate, false);
    assert.equal(project.creatorNote, 'Mechanical engineer looking for a co-builder.');
    assert.equal(project.requireResume, true);
    assert.equal(project.requireGithubLink, true);
    assert.equal(project.requireLinkedinLink, true);

    const byId = await storage.getProjectById(project.id);
    assert.equal(byId?.title, 'Space Rover');

    const bySlug = await storage.getProjectBySlug(project.slug);
    assert.equal(bySlug?.id, project.id);

    const ownerProjects = await storage.getProjectsByOwner('alice');
    assert.equal(ownerProjects.length, 1);
  });

  await t.test('creates, queries, and updates applicants', async () => {
    const projects = await storage.listProjects();
    const project = projects[0];

    const applicant = await storage.createApplicant({
      projectId: project.id,
      userId: '202',
      userLogin: 'bob',
      userAvatar: 'https://example.com/bob.png',
      accountAge: '1 year, 2 months',
      publicRepoCount: 7,
      message: 'Looking forward to building this!',
      githubUrl: 'https://github.com/bob',
      linkedinUrl: 'https://www.linkedin.com/in/bob',
      resumeFileName: 'bob-resume.pdf',
      resumePath: 'aaaa-bbbb.pdf',
    });

    assert.ok(applicant.id.startsWith('app_'));
    assert.equal(applicant.status, 'pending');
    assert.equal(applicant.accountAge, '1 year, 2 months');
    assert.equal(applicant.githubUrl, 'https://github.com/bob');
    assert.equal(applicant.linkedinUrl, 'https://www.linkedin.com/in/bob');
    assert.equal(applicant.resumeFileName, 'bob-resume.pdf');

    const found = await storage.findApplicant(project.id, '202');
    assert.ok(found);
    assert.equal(found.id, applicant.id);

    const updated = await storage.updateApplicantStatus(applicant.id, 'approved', { inviteId: 999 });
    assert.equal(updated?.status, 'approved');
    assert.equal(updated?.invitationSent, true);
  });
});
