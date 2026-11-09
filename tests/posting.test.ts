import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './setup';
import { platforms } from '../src/platforms/registry';
import { draftPost, draftPersonalPost } from '../src/posting/drafts';
import { checkDraft, graphemes } from '../src/posting/checks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const project = {
  ownerName: 'alice',
  repoName: 'crewlink',
  description: 'A small project for people who want to collaborate.',
  roles: ['Node.js developer', 'Designer'],
  joinUrl: 'https://crewlink.test/join/abc123',
  mode: 'referral' as const,
  isPrivate: false,
};

test('posting: every platform draft includes the join link and is within its own limit', () => {
  for (const platform of platforms) {
    const text = draftPost(project, platform.id);
    assert.ok(text.includes(project.joinUrl), platform.id);
    const length = platform.count === 'graphemes' ? graphemes(text) : text.length;
    assert.ok(length <= platform.characterLimit, platform.id);
  }
});

test('posting: Bluesky counts emoji and accented characters as grapheme clusters', () => {
  assert.equal(graphemes('e\u0301😀'), 2);
  const checks = checkDraft(project, 'bluesky', '😀'.repeat(301) + project.joinUrl);
  assert.ok(checks.some((check) => check.code === 'over_limit'));
});

test('posting: each requested draft check fires', () => {
  assert.ok(checkDraft(project, 'discord', 'x'.repeat(2001) + project.joinUrl).some((check) => check.code === 'over_limit'));
  assert.ok(checkDraft(project, 'discord', 'no link').some((check) => check.code === 'join_link_missing'));
  assert.ok(checkDraft(project, 'discord', `${project.joinUrl} ghp_abcdefghijklmnopqrstuvwxyz123456`).some((check) => check.code === 'secret'));

  const privateProject = { ...project, isPrivate: true };
  assert.ok(checkDraft(privateProject, 'discord', `${project.joinUrl} https://github.com/alice/crewlink/issues`).some((check) => check.code === 'private_repo_link'));

  assert.ok(
    checkDraft(
      {
        ...project,
        approvedDrafts: [
          { platformId: 'discord', approvedText: `same ${project.joinUrl}`, approvedAt: new Date().toISOString() },
        ],
      },
      'discord',
      `same ${project.joinUrl}`
    ).some((check) => check.code === 'recent_duplicate')
  );

  const warnings = checkDraft({ ...project, roles: [], description: '' }, 'discord', project.joinUrl);
  assert.ok(warnings.some((check) => check.code === 'no_roles'));
  assert.ok(warnings.some((check) => check.code === 'no_description'));
});

test('posting: personal post includes link, changes screening wording, and does not expose private code', () => {
  const referral = draftPersonalPost(project, { tone: 'casual' });
  const screening = draftPersonalPost(
    { ...project, mode: 'screening', screeningUrl: 'https://screen.test/form' },
    { tone: 'professional' }
  );

  assert.ok(referral.includes(project.joinUrl));
  assert.match(screening, /finish the screening first/i);
  assert.ok(!screening.includes('https://screen.test/form'));
  assert.ok(!checkDraft({ ...project, isPrivate: true }, 'personal', referral).some((check) => check.code === 'private_repo_link'));
});

test('posting: posting modules make no network calls', () => {
  for (const file of ['../src/platforms/registry.ts', '../src/posting/drafts.ts', '../src/posting/checks.ts']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.doesNotMatch(source, /\b(fetch|https?\.request|net\.connect|axios)\s*\(/);
  }
});
