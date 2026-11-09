import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkPages } from '../services/RagPipeline/chunk.js';

const sentence = (i) => `Sentence number ${i} explains one policy detail in plain words.`;
const paragraph = (from, count) => Array.from({ length: count }, (_, i) => sentence(from + i)).join(' ');
const words = (text) => text.split(/\s+/).filter(Boolean);

test('short text becomes a single chunk', () => {
  const chunks = chunkPages([{ pageNumber: 1, text: 'Annual leave is 20 days.' }]);
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0], {
    chunkIndex: 0,
    content: 'Annual leave is 20 days.',
    pageStart: 1,
    pageEnd: 1,
    tokenCount: 6,
  });
});

test('no chunk exceeds chunkSize and every word is kept', () => {
  const text = [paragraph(0, 30), paragraph(30, 30), paragraph(60, 30)].join('\n\n');
  const chunks = chunkPages([{ pageNumber: 1, text }], { chunkSize: 300, chunkOverlap: 50 });

  assert.ok(chunks.length > 3);
  for (const chunk of chunks) assert.ok(chunk.content.length <= 300, `chunk ${chunk.chunkIndex} too long`);

  const covered = new Set(chunks.flatMap((c) => words(c.content)));
  for (const word of words(text)) assert.ok(covered.has(word), `lost word: ${word}`);
  assert.deepEqual(chunks.map((c) => c.chunkIndex), chunks.map((_, i) => i));
});

test('prefers paragraph boundaries over cutting mid-paragraph', () => {
  const first = paragraph(0, 3);
  const second = paragraph(3, 3);
  const chunks = chunkPages([{ pageNumber: 1, text: `${first}\n\n${second}` }], {
    chunkSize: first.length + 10,
    chunkOverlap: 0,
  });
  assert.deepEqual(chunks.map((c) => c.content), [first, second]);
});

test('splits long paragraphs at sentence boundaries with overlap', () => {
  const chunks = chunkPages([{ pageNumber: 1, text: paragraph(0, 20) }], { chunkSize: 200, chunkOverlap: 70 });

  for (const chunk of chunks.slice(0, -1)) assert.match(chunk.content, /\.$/, 'should end at a sentence');
  for (let i = 1; i < chunks.length; i++) {
    const lastSentenceOfPrev = chunks[i - 1].content.split('. ').at(-1);
    assert.ok(chunks[i].content.includes(lastSentenceOfPrev), `chunk ${i} should overlap the previous one`);
  }
});

test('text without separators is cut into fixed windows', () => {
  const text = 'x'.repeat(2500);
  const chunks = chunkPages([{ pageNumber: 1, text }], { chunkSize: 1000, chunkOverlap: 100 });
  assert.deepEqual(chunks.map((c) => c.content.length), [1000, 1000, 700]);
});

test('tracks which pages each chunk spans', () => {
  const pages = [
    { pageNumber: 1, text: paragraph(0, 4) },
    { pageNumber: 2, text: '' },
    { pageNumber: 3, text: paragraph(4, 4) },
  ];
  const single = chunkPages(pages, { chunkSize: 5000, chunkOverlap: 0 });
  assert.equal(single.length, 1);
  assert.deepEqual([single[0].pageStart, single[0].pageEnd], [1, 3]);

  const split = chunkPages(pages, { chunkSize: pages[0].text.length + 5, chunkOverlap: 0 });
  assert.deepEqual(split.map((c) => [c.pageStart, c.pageEnd]), [[1, 1], [3, 3]]);
});

test('is deterministic', () => {
  const pages = [{ pageNumber: 1, text: [paragraph(0, 25), paragraph(25, 25)].join('\n\n') }];
  assert.deepEqual(chunkPages(pages), chunkPages(pages));
});

test('empty input gives no chunks; invalid options are rejected', () => {
  assert.deepEqual(chunkPages([{ pageNumber: 1, text: '' }]), []);
  assert.throws(() => chunkPages([{ pageNumber: 1, text: 'a' }], { chunkSize: 100, chunkOverlap: 100 }));
});
