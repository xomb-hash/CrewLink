import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RESUME_BYTES, resumeDownloadName, validateResumeFile } from '../src/lib/uploads';

test('Resume upload rules', async (t) => {
  await t.test('accepts PDF files within the size limit', () => {
    assert.equal(validateResumeFile({ size: 1024, type: 'application/pdf', name: 'cv.pdf' }), null);
    assert.equal(
      validateResumeFile({ size: MAX_RESUME_BYTES, type: 'application/octet-stream', name: 'cv.PDF' }),
      null
    );
  });

  await t.test('rejects empty, oversized, and non-PDF files', () => {
    assert.match(validateResumeFile({ size: 0, type: 'application/pdf', name: 'cv.pdf' }) || '', /empty/);
    assert.match(
      validateResumeFile({ size: MAX_RESUME_BYTES + 1, type: 'application/pdf', name: 'cv.pdf' }) || '',
      /5 MB/
    );
    assert.match(
      validateResumeFile({ size: 1024, type: 'text/plain', name: 'cv.txt' }) || '',
      /PDF/
    );
  });

  await t.test('sanitizes download file names', () => {
    assert.equal(resumeDownloadName('../../etc/passwd'), 'passwd');
    assert.equal(resumeDownloadName('my "cv"\r\n.pdf'), 'my cv.pdf');
  });
});
