import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { cleanText, extractText } from '../services/RagPipeline/extract-text.service.js';
import { PermanentPipelineError } from '../services/RagPipeline/pipeline-error.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Builds a minimal valid PDF with one text line per page ('' = page without text).
function makePdf(pageTexts) {
  const objects = [];
  const pageIds = pageTexts.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pageTexts.forEach((text, i) => {
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : '';
    objects[pageIds[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objects[pageIds[i] + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

async function makeDocx(paragraphs) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('PDF: one entry per page, page numbers kept, empty pages preserved', async () => {
  const buffer = makePdf(['Leave policy page one', '', 'Expense policy page three']);
  const { pages, pageCount } = await extractText({ buffer, mimeType: 'application/pdf' });

  assert.equal(pageCount, 3);
  assert.deepEqual(pages.map((p) => p.pageNumber), [1, 2, 3]);
  assert.match(pages[0].text, /Leave policy page one/);
  assert.equal(pages[1].text, '');
  assert.match(pages[2].text, /Expense policy page three/);
});

test('PDF with no text is a permanent failure', async () => {
  await assert.rejects(
    extractText({ buffer: makePdf(['', '']), mimeType: 'application/pdf' }),
    (err) => err instanceof PermanentPipelineError && /No extractable text/.test(err.message),
  );
});

test('corrupt PDF is a permanent failure', async () => {
  await assert.rejects(
    extractText({ buffer: Buffer.from('not a pdf'), mimeType: 'application/pdf' }),
    PermanentPipelineError,
  );
});

test('DOCX: paragraphs extracted as page 1', async () => {
  const buffer = await makeDocx(['Remote work policy', 'Employees may work remotely two days a week.']);
  const { pages, pageCount } = await extractText({ buffer, mimeType: DOCX });

  assert.equal(pageCount, 1);
  assert.equal(pages[0].text, 'Remote work policy\n\nEmployees may work remotely two days a week.');
});

test('plain text and markdown (by extension) are read as UTF-8', async () => {
  const txt = await extractText({ buffer: Buffer.from('﻿Hello\r\nWorld  ok'), mimeType: 'text/plain' });
  assert.equal(txt.pages[0].text, 'Hello\nWorld ok');

  const md = await extractText({ buffer: Buffer.from('# Title\n\nBody'), mimeType: '', fileName: 'notes.md' });
  assert.equal(md.pages[0].text, '# Title\n\nBody');
});

test('unsupported type is a permanent failure', async () => {
  await assert.rejects(
    extractText({ buffer: Buffer.from('x'), mimeType: 'image/png', fileName: 'a.png' }),
    (err) => err instanceof PermanentPipelineError && /Unsupported file type/.test(err.message),
  );
});

test('cleanText removes NUL/control chars and collapses whitespace, keeps paragraphs', () => {
  assert.equal(cleanText('a\u0000b \t c\n\n\n\nd\u0007'), 'ab c\n\nd');
});
