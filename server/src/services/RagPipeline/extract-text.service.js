// src/services/RagPipeline/extract-text.service.js
//
// STAGE 1: file bytes -> plain text, page by page.
// Output: { pages: [{ pageNumber, text }], pageCount }
//   - PDF keeps real page numbers so chunks can cite "page 4".
//   - DOCX and text files have no pages; they come back as a single page 1.
// Pages with no text are kept (empty string) so page numbers stay aligned with the PDF.

import mammoth from 'mammoth';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import { PermanentPipelineError } from './pipeline-error.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Postgres rejects \0 in text columns; PDFs sometimes contain it. Other control characters are
// noise for retrieval. Whitespace is collapsed but paragraph breaks (\n\n) are kept, because the
// recursive chunker splits on them first.
export function cleanText(raw) {
  return raw
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(buffer) {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch (err) {
    throw new PermanentPipelineError(`Could not open PDF: ${err.message}`);
  }
  const { text } = await extractPdfText(pdf, { mergePages: false });
  return text.map((pageText, i) => ({ pageNumber: i + 1, text: cleanText(pageText) }));
}

async function extractDocx(buffer) {
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    return [{ pageNumber: 1, text: cleanText(value) }];
  } catch (err) {
    throw new PermanentPipelineError(`Could not read DOCX: ${err.message}`);
  }
}

function extractPlainText(buffer) {
  return [{ pageNumber: 1, text: cleanText(buffer.toString('utf8')) }];
}

function pickExtractor(mimeType, fileName = '') {
  if (mimeType === 'application/pdf') return extractPdf;
  if (mimeType === DOCX) return extractDocx;
  if (mimeType?.startsWith('text/') || /\.(txt|md|markdown)$/i.test(fileName)) return extractPlainText;
  return null;
}

export async function extractText({ buffer, mimeType, fileName }) {
  const extractor = pickExtractor(mimeType, fileName);
  if (!extractor) throw new PermanentPipelineError(`Unsupported file type: ${mimeType}`);

  const pages = await extractor(buffer);
  if (!pages.some((page) => page.text.length > 0)) {
    throw new PermanentPipelineError('No extractable text (is this a scanned PDF?)');
  }

  return { pages, pageCount: pages.length };
}
