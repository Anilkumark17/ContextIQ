import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256FromUrl } from '../utils/hash.js';

const PDF_URL = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

test('sha256FromUrl returns a 64-char hex digest', async () => {
  const hash = await sha256FromUrl(PDF_URL);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('sha256FromUrl is stable for the same file', async () => {
  assert.equal(await sha256FromUrl(PDF_URL), await sha256FromUrl(PDF_URL));
});

test('sha256FromUrl throws on a non-OK response', async () => {
  await assert.rejects(
    sha256FromUrl('https://www.w3.org/this-file-does-not-exist.pdf'),
    /Failed to fetch file for hashing: 404/,
  );
});