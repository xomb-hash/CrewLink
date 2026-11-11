import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { config } from '../src/config/index';
import { storage } from '../src/lib/storage';
import { checkDraft } from '../src/posting/checks';
import {
  buildWhatsAppShareUrl,
  markWhatsAppOpened,
  markWhatsAppShared,
  prepareWhatsAppShare,
  WHATSAPP_SHARE_ORIGIN,
} from '../src/posting/whatsapp/share';
import { whatsAppShareUrl } from '../src/posting/whatsapp/url';
import { PublishError } from '../src/posting/publish';

const code = (err: unknown) => (err instanceof PublishError ? err.code : 'unexpected');

test('WhatsApp share URLs preserve the whole message', () => {
  assert.equal(WHATSAPP_SHARE_ORIGIN, 'https://wa.me/');

  const text = 'Line one\nLine two & more\nhttps://crewlink.test/join/crew?a=1&b=2';
  const url = whatsAppShareUrl(text);
  assert.ok(url?.startsWith('https://wa.me/?text='));
  const encoded = url!.slice('https://wa.me/?text='.length);
  assert.equal(decodeURIComponent(encoded), text);
  // No formatting is invented: only the message is encoded.
  assert.ok(!encoded.includes('\n'));
  assert.ok(encoded.includes('%0A'));

  assert.equal(whatsAppShareUrl('   '), null);
  assert.equal(whatsAppShareUrl(''), null);
  assert.throws(
    () => buildWhatsAppShareUrl('  '),
    (err) => err instanceof PublishError && err.code === 'invalid_post'
  );
});

test('WhatsApp manual sharing records intent without claiming delivery', async (t) => {
  storage.reset();

  const owner = await storage.saveUser({ id: 2201, login: 'wa-owner' });
  const other = await storage.saveUser({ id: 2202, login: 'wa-other' });
  const ownerId = owner.id as string;

  const project = await storage.createProject({
    ownerLogin: owner.login,
    ownerId: owner.id,
    repoFullName: 'wa-owner/rocket',
    repoName: 'rocket',
    repoOwner: 'wa-owner',
    title: 'Rocket',
  });
  const joinUrl = `${config.appUrl.replace(/\/+$/, '')}/join/${project.slug}`;
  // Each approved draft keeps unique text so the duplicate-approval check does
  // not reject unrelated drafts in this test.
  let sequence = 0;
  const draftText = (label: string) =>
    `We are building Crewlink (${label} ${++sequence}).\nJoin here:\n${joinUrl}\nNo experience needed.`;

  let draftId = '';
  let shareUrl = '';

  await t.test('prepare needs an approved WhatsApp draft owned by the caller', async () => {
    const draft = await storage.createDraft({
      projectId: project.id,
      platformId: 'whatsapp',
      text: draftText('primary'),
    });
    draftId = draft.id;

    await assert.rejects(
      () => prepareWhatsAppShare({ userId: ownerId, draftId: 'drf_missing' }),
      (err) => code(err) === 'draft_not_found'
    );
    await assert.rejects(
      () => prepareWhatsAppShare({ userId: ownerId, draftId }),
      (err) => code(err) === 'draft_not_approved'
    );
    await assert.rejects(
      () => prepareWhatsAppShare({ userId: String(other.id), draftId }),
      (err) => code(err) === 'forbidden'
    );

    const discordDraft = await storage.createDraft({
      projectId: project.id,
      platformId: 'discord',
      text: draftText('discord'),
    });
    await storage.approveDraft(discordDraft.id, owner.login);
    await assert.rejects(
      () => prepareWhatsAppShare({ userId: ownerId, draftId: discordDraft.id }),
      (err) => code(err) === 'unsupported_platform'
    );
  });

  await t.test('prepare validates the composer checks', async () => {
    const noLink = await storage.createDraft({
      projectId: project.id,
      platformId: 'whatsapp',
      text: 'Join us soon.',
    });
    await storage.approveDraft(noLink.id, owner.login);
    assert.ok(
      checkDraft(
        {
          ownerName: project.repoOwner,
          repoName: project.repoName,
          repoFullName: project.repoFullName,
          isPrivate: project.isPrivate,
          joinUrl,
          roles: project.roles,
          description: project.description,
          approvedDrafts: [],
        },
        'whatsapp',
        noLink.text
      ).some((check) => check.level === 'error')
    );
    await assert.rejects(
      () => prepareWhatsAppShare({ userId: ownerId, draftId: noLink.id }),
      (err) => code(err) === 'invalid_post'
    );
  });

  await t.test('prepare returns an encoded link and records prepared once', async () => {
    await storage.approveDraft(draftId, owner.login);

    const first = await prepareWhatsAppShare({ userId: ownerId, draftId });
    assert.equal(first.verified, false);
    assert.equal(first.publication.status, 'prepared');
    assert.equal(first.publication.mode, 'manual');
    assert.equal(first.publication.platformId, 'whatsapp');
    assert.equal(first.publication.targetName, 'WhatsApp');
    assert.equal(first.publication.externalId, undefined);
    assert.ok(first.shareUrl.startsWith(WHATSAPP_SHARE_ORIGIN));
    shareUrl = first.shareUrl;

    const second = await prepareWhatsAppShare({ userId: ownerId, draftId });
    assert.equal(second.publication.id, first.publication.id);
    assert.equal(second.shareUrl, first.shareUrl);

    const stored = await storage.getPublication(draftId, 'whatsapp');
    assert.equal(stored?.status, 'prepared');
    assert.equal(stored?.externalIds.length, 0);
  });

  await t.test('opening WhatsApp does not mark the draft as sent', async () => {
    const opened = await markWhatsAppOpened({ userId: ownerId, draftId });
    assert.equal(opened.verified, false);
    assert.equal(opened.publication.status, 'opened');
    assert.equal(opened.publication.confirmedAt, undefined);

    const repeated = await markWhatsAppOpened({ userId: ownerId, draftId });
    assert.equal(repeated.publication.status, 'opened');
  });

  await t.test('marking shared is manual, unverified work and cannot repeat', async () => {
    const shared = await markWhatsAppShared({ userId: ownerId, draftId });
    assert.equal(shared.verified, false);
    assert.equal(shared.publication.status, 'published');
    assert.equal(shared.publication.mode, 'manual');
    assert.equal(shared.publication.externalId, undefined);
    assert.deepEqual(shared.publication.externalIds, []);
    assert.ok(shared.publication.confirmedAt);

    await assert.rejects(
      () => markWhatsAppShared({ userId: ownerId, draftId }),
      (err) => code(err) === 'already_published'
    );
    await assert.rejects(
      () => prepareWhatsAppShare({ userId: ownerId, draftId }),
      (err) => code(err) === 'already_published'
    );
    assert.equal(shareUrl.length > 0, true);
  });

  await t.test('another user cannot open or mark the record', async () => {
    const fresh = await storage.createDraft({
      projectId: project.id,
      platformId: 'whatsapp',
      text: draftText('fresh'),
    });
    await storage.approveDraft(fresh.id, owner.login);
    await prepareWhatsAppShare({ userId: ownerId, draftId: fresh.id });

    await assert.rejects(
      () => markWhatsAppOpened({ userId: String(other.id), draftId: fresh.id }),
      (err) => code(err) === 'forbidden'
    );
    await assert.rejects(
      () => markWhatsAppShared({ userId: String(other.id), draftId: fresh.id }),
      (err) => code(err) === 'forbidden'
    );
  });

  await t.test('a hand-marked share needs a prepared record', async () => {
    const unprepared = await storage.createDraft({
      projectId: project.id,
      platformId: 'whatsapp',
      text: draftText('unprepared'),
    });
    await storage.approveDraft(unprepared.id, owner.login);

    await assert.rejects(
      () => markWhatsAppOpened({ userId: ownerId, draftId: unprepared.id }),
      (err) => code(err) === 'invalid_input'
    );
    await assert.rejects(
      () => markWhatsAppShared({ userId: ownerId, draftId: unprepared.id }),
      (err) => code(err) === 'invalid_input'
    );
  });

  await t.test('editing after approval blocks every manual step', async () => {
    const editableText = draftText('editable');
    const editable = await storage.createDraft({
      projectId: project.id,
      platformId: 'whatsapp',
      text: editableText,
    });
    await storage.approveDraft(editable.id, owner.login);
    await prepareWhatsAppShare({ userId: ownerId, draftId: editable.id });

    const stored = await storage.getDraftById(editable.id);
    assert.ok(stored);
    stored.text = `${editableText}\nChanged without re-approval.`;

    await assert.rejects(
      () => markWhatsAppOpened({ userId: ownerId, draftId: editable.id }),
      (err) => code(err) === 'draft_changed'
    );
    await assert.rejects(
      () => markWhatsAppShared({ userId: ownerId, draftId: editable.id }),
      (err) => code(err) === 'draft_changed'
    );

    const record = await storage.getPublication(editable.id, 'whatsapp');
    assert.equal(record?.status, 'prepared');
  });

  await t.test('concurrent prepares reuse one record', async () => {
    const concurrent = await storage.createDraft({
      projectId: project.id,
      platformId: 'whatsapp',
      text: draftText('concurrent'),
    });
    await storage.approveDraft(concurrent.id, owner.login);

    const [first, second] = await Promise.all([
      prepareWhatsAppShare({ userId: ownerId, draftId: concurrent.id }),
      prepareWhatsAppShare({ userId: ownerId, draftId: concurrent.id }),
    ]);
    assert.equal(first.publication.id, second.publication.id);
    assert.equal(first.publication.status, 'prepared');
  });

  await t.test('preparing never contacts WhatsApp', async () => {
    const quiet = await storage.createDraft({
      projectId: project.id,
      platformId: 'whatsapp',
      text: draftText('quiet'),
    });
    await storage.approveDraft(quiet.id, owner.login);

    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error('no network call allowed');
    }) as typeof fetch;
    try {
      const result = await prepareWhatsAppShare({ userId: ownerId, draftId: quiet.id });
      assert.equal(calls, 0);
      assert.ok(result.shareUrl.startsWith(WHATSAPP_SHARE_ORIGIN));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
