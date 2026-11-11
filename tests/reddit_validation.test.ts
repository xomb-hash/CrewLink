import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import {
  normalizeSubreddit,
  redditApprovalHash,
  redditApprovalPayload,
  redditComposerChecks,
  redditLiveChecks,
  validLinkUrl,
  validSubreddit,
} from '../src/posting/reddit/validate';
import { renderMarkdownPreview } from '../src/posting/reddit/markdown';
import type { RedditSubreddit } from '../src/posting/adapters/types';

const errorCodes = (checks: { level: string; code: string }[]) =>
  checks.filter((check) => check.level === 'error').map((check) => check.code);

const subreddit = (value: Partial<RedditSubreddit> = {}): RedditSubreddit => ({
  name: 'programming',
  subredditType: 'public',
  submissionType: 'any',
  ...value,
});

const validDraft = {
  title: 'Looking for collaborators',
  subreddit: 'programming',
  submissionType: 'self' as const,
  text: 'Join the project and help us build it.',
  linkUrl: '',
};

test('Reddit composer validation follows the submission rules', async (t) => {
  await t.test('normalizes r/ prefixes and validates names', () => {
    assert.equal(normalizeSubreddit(' r/Programming/ '), 'Programming');
    assert.equal(normalizeSubreddit('/r/programming'), 'programming');
    assert.equal(validSubreddit('r/programming'), true);
    assert.equal(validSubreddit('a'), false);
    assert.equal(validSubreddit('bad name'), false);
    assert.equal(validSubreddit('a'.repeat(22)), false);
  });

  await t.test('requires a title, a type and a subreddit', () => {
    const codes = errorCodes(redditComposerChecks({}));
    assert.ok(codes.includes('title_required'));
    assert.ok(codes.includes('submission_type'));
    assert.ok(codes.includes('subreddit_required'));
  });

  await t.test('enforces the title and body limits', () => {
    assert.ok(
      errorCodes(
        redditComposerChecks({ ...validDraft, title: 'x'.repeat(301) })
      ).includes('title_limit')
    );
    assert.ok(
      errorCodes(
        redditComposerChecks({ ...validDraft, text: 'x'.repeat(40_001) })
      ).includes('body_limit')
    );
  });

  await t.test('a text submission needs a body', () => {
    assert.ok(
      errorCodes(redditComposerChecks({ ...validDraft, text: '   ' })).includes('body_required')
    );
  });

  await t.test('a link submission needs a public http(s) URL', () => {
    assert.equal(validLinkUrl('https://example.com/launch'), true);
    assert.equal(validLinkUrl('http://example.com'), true);
    assert.equal(validLinkUrl('javascript:alert(1)'), false);
    assert.equal(validLinkUrl('ftp://example.com/file'), false);

    assert.ok(
      errorCodes(
        redditComposerChecks({
          ...validDraft,
          submissionType: 'link',
          linkUrl: 'not-a-url',
        })
      ).includes('link_url')
    );
    assert.ok(
      errorCodes(
        redditComposerChecks({
          ...validDraft,
          submissionType: 'link',
          linkUrl: 'https://localhost:3100/join',
        })
      ).includes('link_host')
    );
  });

  await t.test('valid text and link drafts pass the static checks', () => {
    assert.deepEqual(errorCodes(redditComposerChecks(validDraft)), []);
    assert.deepEqual(
      errorCodes(
        redditComposerChecks({
          ...validDraft,
          submissionType: 'link',
          text: '',
          linkUrl: 'https://example.com/launch',
        })
      ),
      []
    );
  });

  await t.test('the approval hash covers every submission field', () => {
    const base = redditApprovalHash(validDraft);
    assert.equal(base.length, 64);
    // Reddit treats subreddit names case-insensitively.
    assert.equal(
      base,
      redditApprovalHash({ ...validDraft, subreddit: 'r/Programming' })
    );
    assert.notEqual(base, redditApprovalHash({ ...validDraft, title: 'Another title' }));
    assert.notEqual(base, redditApprovalHash({ ...validDraft, text: 'Another body' }));
    assert.notEqual(base, redditApprovalHash({ ...validDraft, subreddit: 'opensource' }));
    assert.notEqual(
      base,
      redditApprovalHash({ ...validDraft, submissionType: 'link', linkUrl: 'https://example.com' })
    );
    const payload = JSON.parse(redditApprovalPayload(validDraft)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload).sort(), ['body', 'kind', 'subreddit', 'title', 'url']);
  });
});

test('Reddit live validation uses only rules the subreddit reports', async (t) => {
  await t.test('private, archived, banned and muted states block publishing', () => {
    assert.ok(
      errorCodes(
        redditLiveChecks({ draft: validDraft, subreddit: subreddit({ subredditType: 'private' }) })
          .checks
      ).includes('subreddit_private')
    );
    assert.ok(
      errorCodes(
        redditLiveChecks({ draft: validDraft, subreddit: subreddit({ subredditType: 'archived' }) })
          .checks
      ).includes('subreddit_archived')
    );
    assert.ok(
      errorCodes(
        redditLiveChecks({ draft: validDraft, subreddit: subreddit({ userIsBanned: true }) }).checks
      ).includes('account_banned')
    );
    assert.ok(
      errorCodes(
        redditLiveChecks({ draft: validDraft, subreddit: subreddit({ userIsMuted: true }) }).checks
      ).includes('account_muted')
    );
  });

  await t.test('restricted communities are reported as unverifiable, not guessed', () => {
    const result = redditLiveChecks({
      draft: validDraft,
      subreddit: subreddit({ subredditType: 'restricted' }),
    });
    assert.deepEqual(errorCodes(result.checks), []);
    assert.ok(result.unverifiable.some((item) => item.includes('restricted')));
    assert.ok(result.unverifiable.some((item) => item.includes('Moderators may still remove')));
  });

  await t.test('the subreddit submission type must allow the chosen post', () => {
    assert.ok(
      errorCodes(
        redditLiveChecks({
          draft: validDraft,
          subreddit: subreddit({ submissionType: 'link' }),
        }).checks
      ).includes('submission_type_not_allowed')
    );
    assert.deepEqual(
      errorCodes(
        redditLiveChecks({
          draft: { ...validDraft, submissionType: 'link', text: '', linkUrl: 'https://example.com' },
          subreddit: subreddit({ submissionType: 'link' }),
        }).checks
      ),
      []
    );
  });

  await t.test('API-reported title and body limits are enforced', () => {
    const minimums = errorCodes(
      redditLiveChecks({
        draft: validDraft,
        subreddit: subreddit(),
        requirements: { titleMinLength: 40, bodyMinLength: 100 },
      }).checks
    );
    assert.ok(minimums.includes('title_min'));
    assert.ok(minimums.includes('body_min'));

    const maximums = errorCodes(
      redditLiveChecks({
        draft: validDraft,
        subreddit: subreddit(),
        requirements: { titleMaxLength: 10, bodyMaxLength: 10 },
      }).checks
    );
    assert.ok(maximums.includes('title_max'));
    assert.ok(maximums.includes('body_max'));
  });

  await t.test('required body text and links are enforced', () => {
    const bodyResult = redditLiveChecks({
      draft: { ...validDraft, text: '' },
      subreddit: subreddit(),
      requirements: { bodyRequired: true },
    });
    assert.ok(errorCodes(bodyResult.checks).includes('body_required'));

    const linkResult = redditLiveChecks({
      draft: validDraft,
      subreddit: subreddit(),
      requirements: { linkRequired: true },
    });
    assert.ok(errorCodes(linkResult.checks).includes('link_url'));
  });

  await t.test('domain blacklists and whitelists use the reported policy', () => {
    const draft = {
      ...validDraft,
      submissionType: 'link' as const,
      text: '',
      linkUrl: 'https://spam.test/launch',
    };
    assert.ok(
      errorCodes(
        redditLiveChecks({
          draft,
          subreddit: subreddit(),
          requirements: { domainBlacklist: ['spam.test'] },
        }).checks
      ).includes('domain_not_allowed')
    );
    assert.ok(
      errorCodes(
        redditLiveChecks({
          draft,
          subreddit: subreddit(),
          requirements: {
            linkRestrictionPolicy: 'whitelist',
            domainWhitelist: ['trusted.test'],
          },
        }).checks
      ).includes('domain_not_allowed')
    );
    assert.deepEqual(
      errorCodes(
        redditLiveChecks({
          draft: { ...draft, linkUrl: 'https://docs.trusted.test/launch' },
          subreddit: subreddit(),
          requirements: {
            linkRestrictionPolicy: 'whitelist',
            domainWhitelist: ['trusted.test'],
          },
        }).checks
      ),
      []
    );
  });

  await t.test('required and blacklisted strings are enforced case-insensitively', () => {
    const blacklisted = errorCodes(
      redditLiveChecks({
        draft: { ...validDraft, title: 'Crypto collaborators', text: 'spam contact' },
        subreddit: subreddit(),
        requirements: {
          titleBlacklistedStrings: ['crypto'],
          bodyBlacklistedStrings: ['spam'],
        },
      }).checks
    );
    assert.ok(blacklisted.includes('title_filtered'));
    assert.ok(blacklisted.includes('body_filtered'));

    const missing = errorCodes(
      redditLiveChecks({
        draft: validDraft,
        subreddit: subreddit(),
        requirements: {
          titleRequiredStrings: ['[Hiring]'],
          bodyRequiredStrings: ['contact'],
        },
      }).checks
    );
    assert.ok(missing.includes('title_required_text'));
    assert.ok(missing.includes('body_required_text'));

    const satisfied = errorCodes(
      redditLiveChecks({
        draft: { ...validDraft, title: '[Hiring] collaborators', text: 'Contact me to join.' },
        subreddit: subreddit(),
        requirements: {
          titleRequiredStrings: ['[hiring]'],
          bodyRequiredStrings: ['contact'],
        },
      }).checks
    );
    assert.ok(!satisfied.includes('title_required_text'));
    assert.ok(!satisfied.includes('body_required_text'));
  });

  await t.test('flair and gallery requirements block automatic publishing explicitly', () => {
    const result = redditLiveChecks({
      draft: validDraft,
      subreddit: subreddit(),
      requirements: { flairRequired: true, galleryRequired: true },
    });
    const codes = errorCodes(result.checks);
    assert.ok(codes.includes('flair_required'));
    assert.ok(codes.includes('gallery_required'));
  });

  await t.test('community rule names are surfaced as unverifiable', () => {
    const result = redditLiveChecks({
      draft: validDraft,
      subreddit: subreddit(),
      rules: [
        { name: 'Be respectful' },
        { name: 'No self-promotion' },
      ],
    });
    assert.ok(
      result.unverifiable.some(
        (item) => item.includes('Be respectful') && item.includes('No self-promotion')
      )
    );
  });

  await t.test('static draft errors are repeated by the live check', () => {
    const result = redditLiveChecks({
      draft: { ...validDraft, title: '' },
      subreddit: subreddit(),
    });
    assert.ok(errorCodes(result.checks).includes('title_required'));
  });
});

test('the Reddit Markdown preview escapes input and supports common formatting', async (t) => {
  await t.test('HTML is escaped before any tags are added', () => {
    const html = renderMarkdownPreview('<script>alert("x")</script>');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('&quot;x&quot;'));
  });

  await t.test('links are limited to http and https', () => {
    assert.ok(
      renderMarkdownPreview('[site](https://example.com)').includes(
        'href="https://example.com/"'
      )
    );
    const unsafe = renderMarkdownPreview('[click](javascript:alert(1))');
    assert.ok(!unsafe.includes('<a '));
    assert.ok(unsafe.includes('javascript:alert(1)'));
  });

  await t.test('headings, lists, quotes, emphasis and code are rendered', () => {
    const html = renderMarkdownPreview(
      [
        '## Heading',
        '',
        '- one',
        '- two',
        '',
        '1. first',
        '2. second',
        '',
        '> quoted',
        '',
        '**bold** and *italic* and ~~gone~~ and `code`',
        '',
        '```',
        'const x = 1;',
        '```',
      ].join('\n')
    );
    assert.ok(html.includes('<h2>Heading</h2>'));
    assert.ok(html.includes('<ul><li>one</li><li>two</li></ul>'));
    assert.ok(html.includes('<ol><li>first</li><li>second</li></ol>'));
    assert.ok(html.includes('<blockquote>quoted</blockquote>'));
    assert.ok(html.includes('<strong>bold</strong>'));
    assert.ok(html.includes('<em>italic</em>'));
    assert.ok(html.includes('<del>gone</del>'));
    assert.ok(html.includes('<code>code</code>'));
    assert.ok(html.includes('<pre><code>const x = 1;</code></pre>'));
  });

  await t.test('code span contents stay escaped and are not re-parsed', () => {
    const html = renderMarkdownPreview('`<b>**not bold**</b>`');
    assert.ok(html.includes('<code>&lt;b&gt;**not bold**&lt;/b&gt;</code>'));
    assert.ok(!html.includes('<b>'));
    assert.ok(!html.includes('<strong>'));
  });
});
