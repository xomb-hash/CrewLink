import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAccountAge,
  validateProjectInput,
  validateApplicantInput,
  escapeHtml,
} from '../src/lib/validation';

test('Validation functions (TypeScript)', async (t) => {
  await t.test('formats account age accurately', () => {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    twoYearsAgo.setMonth(twoYearsAgo.getMonth() - 3);

    const formatted = formatAccountAge(twoYearsAgo.toISOString());
    assert.match(formatted, /2 years/);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    assert.match(formatAccountAge(sixMonthsAgo.toISOString()), /6 months/);

    assert.equal(formatAccountAge(null), 'Unknown');
    assert.equal(formatAccountAge('invalid-date'), 'Unknown');
  });

  await t.test('validates project input with referral mode', () => {
    const valid = validateProjectInput({
      repoFullName: 'owner/project.git',
      joinMode: 'referral',
      title: 'Valid Project',
      description: 'Cool description',
    });

    assert.equal(valid.isValid, true);
    assert.equal(valid.data.joinMode, 'referral');
    assert.equal(valid.data.repoFullName, 'owner/project');

    // Strips full github URL if provided
    const urlValid = validateProjectInput({
      repoFullName: 'https://github.com/alice/rocket-ship.git',
      joinMode: 'referral',
    });
    assert.equal(urlValid.isValid, true);
    assert.equal(urlValid.data.repoFullName, 'alice/rocket-ship');
  });


  await t.test('validates project input with screening mode and URL requirement', () => {
    const invalid = validateProjectInput({
      repoFullName: 'owner/project',
      joinMode: 'screening',
      screeningUrl: '',
    });
    assert.equal(invalid.isValid, false);
    assert.ok(invalid.errors.some((e) => e.includes('Screening link is required')));

    const badUrl = validateProjectInput({
      repoFullName: 'owner/project',
      joinMode: 'screening',
      screeningUrl: 'ftp://bad-url.com',
    });
    assert.equal(badUrl.isValid, false);

    const valid = validateProjectInput({
      repoFullName: 'owner/project',
      joinMode: 'screening',
      screeningUrl: 'https://forms.gle/sample123',
    });
    assert.equal(valid.isValid, true);
    assert.equal(valid.data.screeningUrl, 'https://forms.gle/sample123');
  });

  await t.test('validates applicant input length and proof urls', () => {
    const valid = validateApplicantInput({
      message: 'Hello, I want to contribute!',
      proofUrl: 'portfolio.dev/cv.pdf',
      linkedinUrl: 'https://linkedin.com/in/builder',
    });
    assert.equal(valid.isValid, true);
    assert.equal(valid.data.message, 'Hello, I want to contribute!');
    assert.equal(valid.data.proofUrl, 'https://portfolio.dev/cv.pdf');
    assert.equal(valid.data.linkedinUrl, 'https://www.linkedin.com/in/builder');

    const longMsg = 'A'.repeat(500);
    const result = validateApplicantInput({ message: longMsg });
    assert.equal(result.data.message.length, 300);

    const invalidProof = validateApplicantInput({
      proofUrl: 'javascript:alert(1)',
    });
    assert.equal(invalidProof.isValid, false);
    assert.ok(invalidProof.errors.length > 0);
  });

  await t.test('normalizes GitHub and LinkedIn profile links', () => {
    const valid = validateApplicantInput({
      githubUrl: 'github.com/bob-builder',
      linkedinUrl: 'https://www.linkedin.com/in/bob-builder/?trk=profile',
    });
    assert.equal(valid.isValid, true);
    assert.equal(valid.data.githubUrl, 'https://github.com/bob-builder');
    assert.equal(valid.data.linkedinUrl, 'https://www.linkedin.com/in/bob-builder');

    const wrongGithub = validateApplicantInput({ githubUrl: 'https://gitlab.com/bob' });
    assert.equal(wrongGithub.isValid, false);
    assert.ok(wrongGithub.errors.some((e) => e.includes('github.com')));

    const wrongLinkedin = validateApplicantInput({ linkedinUrl: 'https://linkedin.com/company/acme' });
    assert.equal(wrongLinkedin.isValid, false);
    assert.ok(wrongLinkedin.errors.some((e) => e.includes('linkedin.com/in')));
  });

  await t.test('carries creator note and required credential flags', () => {
    const result = validateProjectInput({
      repoFullName: 'owner/project',
      creatorNote: '  I build small tools and need a designer.  ',
      requireResume: true,
      requireGithubLink: true,
      requireLinkedinLink: false,
    });
    assert.equal(result.isValid, true);
    assert.equal(result.data.creatorNote, 'I build small tools and need a designer.');
    assert.equal(result.data.requireResume, true);
    assert.equal(result.data.requireGithubLink, true);
    assert.equal(result.data.requireLinkedinLink, false);
  });

  await t.test('escapes HTML entities safely', () => {
    const dangerous = '<script>alert("xss")</script>&"\'';
    const escaped = escapeHtml(dangerous);
    assert.equal(escaped, '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&amp;&quot;&#039;');
  });

  await t.test('merges tailwind class names properly with cn utility', async () => {
    const { cn } = await import('../src/lib/utils');
    const result = cn('px-2 py-1', false && 'hidden', 'px-4', undefined);
    assert.equal(result, 'py-1 px-4');
  });
});
