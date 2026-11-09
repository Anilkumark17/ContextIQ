// src/services/RagPipeline/chunk.js
//
// STAGE 2: recursive character chunking.
//
// HOW IT WORKS
// 1. Pages are joined into one string ("\n\n" between pages) so a sentence that runs across a page
//    break stays in one chunk. Every chunk remembers where it starts and ends in that string,
//    which maps back to pageStart/pageEnd for citations.
// 2. Split on the coarsest separator present (paragraph -> line -> sentence -> clause -> word).
// 3. Pieces that fit are merged greedily up to `chunkSize`. Pieces that are still too big are split
//    again with the next, finer separator. A piece with no separator at all (e.g. a long URL) is cut
//    into fixed windows.
// 4. Consecutive chunks share up to `chunkOverlap` characters of trailing pieces, so a fact cut at a
//    boundary still appears whole in one of the two chunks.
//
// Every piece is a slice of the original text, so chunk.content === text.slice(start, end):
// chunking is exact and deterministic (same input -> same chunks), which makes re-runs safe.

export const DEFAULT_CHUNK_OPTIONS = {
  // ~250 tokens at ~4 chars/token. Small enough for precise retrieval, big enough for context.
  chunkSize: 1000,
  chunkOverlap: 150,
  separators: ['\n\n', '\n', '. ', '? ', '! ', '; ', ', ', ' '],
};

const PAGE_JOINER = '\n\n';

// Split [start, end) of `text` on `separator`, keeping the separator at the end of each piece so
// the pieces stay contiguous (their concatenation is exactly the input range).
function splitKeepingSeparator(text, start, end, separator) {
  const pieces = [];
  let pieceStart = start;
  let index = text.indexOf(separator, start);
  while (index !== -1 && index + separator.length <= end) {
    const pieceEnd = index + separator.length;
    pieces.push({ start: pieceStart, end: pieceEnd });
    pieceStart = pieceEnd;
    index = text.indexOf(separator, pieceStart);
  }
  if (pieceStart < end) pieces.push({ start: pieceStart, end });
  return pieces;
}

function fixedWindows(start, end, size, overlap) {
  const windows = [];
  const step = Math.max(1, size - overlap);
  for (let s = start; s < end; s += step) {
    windows.push({ start: s, end: Math.min(s + size, end) });
    if (s + size >= end) break;
  }
  return windows;
}

// Greedily merge contiguous pieces into ranges of at most chunkSize, carrying overlap forward.
function mergePieces(pieces, chunkSize, chunkOverlap) {
  const ranges = [];
  let window = [];
  const windowLength = () => (window.length ? window.at(-1).end - window[0].start : 0);

  for (const piece of pieces) {
    const pieceLength = piece.end - piece.start;
    if (window.length && windowLength() + pieceLength > chunkSize) {
      ranges.push({ start: window[0].start, end: window.at(-1).end });
      // Keep trailing pieces as overlap, but never so much that the next piece cannot fit.
      while (window.length && (windowLength() > chunkOverlap || windowLength() + pieceLength > chunkSize)) {
        window.shift();
      }
    }
    window.push(piece);
  }
  if (window.length) ranges.push({ start: window[0].start, end: window.at(-1).end });
  return ranges;
}

function splitRange(text, start, end, separators, options) {
  const { chunkSize, chunkOverlap } = options;
  if (end - start <= chunkSize) return [{ start, end }];

  const sepIndex = separators.findIndex((sep) => {
    const at = text.indexOf(sep, start);
    return at !== -1 && at + sep.length <= end;
  });
  if (sepIndex === -1) return fixedWindows(start, end, chunkSize, chunkOverlap);

  const finer = separators.slice(sepIndex + 1);
  const result = [];
  let fitting = [];
  const flush = () => {
    if (fitting.length) result.push(...mergePieces(fitting, chunkSize, chunkOverlap));
    fitting = [];
  };

  for (const piece of splitKeepingSeparator(text, start, end, separators[sepIndex])) {
    if (piece.end - piece.start <= chunkSize) {
      fitting.push(piece);
    } else {
      flush();
      result.push(...splitRange(text, piece.start, piece.end, finer, options));
    }
  }
  flush();
  return result;
}

// Trim whitespace off a range without losing its link to the original text.
function trimRange(text, { start, end }) {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
}

// Page number containing character offset `pos` (pageStarts is ascending).
function pageAt(pageStarts, pos) {
  let lo = 0;
  let hi = pageStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pageStarts[mid].start <= pos) lo = mid;
    else hi = mid - 1;
  }
  return pageStarts[lo].pageNumber;
}

export const estimateTokens = (content) => Math.ceil(content.length / 4);

// pages: [{ pageNumber, text }] from extract-text.service.js
// Returns [{ chunkIndex, content, pageStart, pageEnd, tokenCount }]
export function chunkPages(pages, overrides = {}) {
  const options = { ...DEFAULT_CHUNK_OPTIONS, ...overrides };
  if (options.chunkOverlap >= options.chunkSize) {
    throw new Error('chunkOverlap must be smaller than chunkSize');
  }

  const pageStarts = [];
  let text = '';
  for (const page of pages) {
    if (!page.text) continue;
    if (text) text += PAGE_JOINER;
    pageStarts.push({ start: text.length, pageNumber: page.pageNumber });
    text += page.text;
  }
  if (!text) return [];

  return splitRange(text, 0, text.length, options.separators, options)
    .map((range) => trimRange(text, range))
    .filter(({ start, end }) => end > start)
    .map(({ start, end }, chunkIndex) => {
      const content = text.slice(start, end);
      return {
        chunkIndex,
        content,
        pageStart: pageAt(pageStarts, start),
        pageEnd: pageAt(pageStarts, end - 1),
        tokenCount: estimateTokens(content),
      };
    });
}
