import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import {
  notifyOwnerNewApplication,
  notifyApplicantApproved,
  notifyApplicantRejected,
} from '../src/lib/notifications';
import type { Project, Applicant } from '../src/types/index';

test('notifications: dispatches applicant applied event successfully', async () => {
  const fakeProject: Project = {
    id: 'prj_test_1',
    slug: 'rocket-ship-123',
    ownerLogin: 'alice',
    ownerId: '101',
    repoFullName: 'alice/rocket-ship',
    repoName: 'rocket-ship',
    repoOwner: 'alice',
    isPrivate: false,
    joinMode: 'referral',
    title: 'Rocket Ship',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const fakeApplicant: Applicant = {
    id: 'app_test_1',
    projectId: 'prj_test_1',
    userId: '202',
    userLogin: 'bob',
    accountAge: '1 year ago',
    publicRepoCount: 5,
    status: 'pending',
    invitationSent: false,
    invitationDetails: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const resultApplied = await notifyOwnerNewApplication(fakeProject, fakeApplicant);
  assert.equal(resultApplied, true);

  const resultApproved = await notifyApplicantApproved(fakeProject, fakeApplicant);
  assert.equal(resultApproved, true);

  const resultRejected = await notifyApplicantRejected(fakeProject, fakeApplicant);
  assert.equal(resultRejected, true);
});
