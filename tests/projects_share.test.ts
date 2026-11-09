import test from 'node:test';
import assert from 'node:assert/strict';
import { generateShareLinks } from '../src/projects/share';

test('Share link generator (TypeScript)', async (t) => {
  const project = {
    slug: 'rocket-ship-1a2b',
    title: 'Rocket Ship',
  };

  const share = generateShareLinks(project, 'http://localhost:3000');

  await t.test('generates valid join URL', () => {
    assert.equal(share.joinUrl, 'http://localhost:3000/join/rocket-ship-1a2b');
  });

  await t.test('generates valid LinkedIn share link', () => {
    assert.ok(share.linkedIn.startsWith('https://www.linkedin.com/sharing/share-offsite/'));
    assert.ok(share.linkedIn.includes(encodeURIComponent('http://localhost:3000/join/rocket-ship-1a2b')));
  });

  await t.test('generates valid X (Twitter) share link', () => {
    assert.ok(share.x.startsWith('https://twitter.com/intent/tweet'));
    assert.ok(share.x.includes(encodeURIComponent('Rocket Ship')));
  });

  await t.test('generates valid WhatsApp share link', () => {
    assert.ok(share.whatsApp.startsWith('https://api.whatsapp.com/send?text='));
    assert.ok(share.whatsApp.includes('http%3A%2F%2Flocalhost%3A3000%2Fjoin%2Frocket-ship-1a2b'));
  });
});
