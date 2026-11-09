// src/services/RagPipeline/pipeline.service.js
//
// Runs the pipeline for ONE claimed document:  download -> extract -> chunk -> save.
// Embedding + Pinecone indexing will be added as the next stage (status 'chunked' -> 'ready').
//
// The worker (pipeline.worker.js) decides WHEN this runs and handles retries; this file only does
// the work. It throws PermanentPipelineError for failures a retry cannot fix.

import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { documentChunks, documents } from '../../db/schema.js';
import { chunkPages } from './chunk.js';
import { extractText } from './extract-text.service.js';
import { PermanentPipelineError } from './pipeline-error.js';

const DOWNLOAD_TIMEOUT_MS = 60_000;
// Upload limit is 16 MB; leave headroom but refuse anything unreasonable.
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const INSERT_BATCH_SIZE = 500;

export async function downloadFile(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });

  if (!response.ok) {
    // 4xx: the file is gone or forbidden; retrying will not bring it back. 5xx: try again later.
    const message = `Could not download file (HTTP ${response.status})`;
    if (response.status >= 400 && response.status < 500) throw new PermanentPipelineError(message);
    throw new Error(message);
  }

  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_DOWNLOAD_BYTES) throw new PermanentPipelineError('File is too large to process');

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_DOWNLOAD_BYTES) throw new PermanentPipelineError('File is too large to process');
  return buffer;
}

// Replace the document's chunks and mark it 'chunked' in one transaction (db.batch), so a crash can
// never leave half the chunks saved.
//
// The status update is fenced on (status 'processing', attempts = this claim's attempt): if this
// worker's lease expired and another claim took over, our status write matches no row. The chunk
// delete/insert are not fenced, but chunking is deterministic, so a stale run writes exactly the
// same chunks the current owner will.
async function saveChunks(job, pageCount, chunks) {
  const rows = chunks.map((chunk) => ({ documentId: job.id, ...chunk }));
  const inserts = [];
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    inserts.push(db.insert(documentChunks).values(rows.slice(i, i + INSERT_BATCH_SIZE)));
  }

  const [updated] = await db.batch([
    db.delete(documentChunks).where(eq(documentChunks.documentId, job.id)),
    ...inserts,
    db
      .update(documents)
      .set({ status: 'chunked', chunkCount: chunks.length, pageCount, error: null, leaseExpiresAt: null })
      .where(and(eq(documents.id, job.id), eq(documents.status, 'processing'), eq(documents.attempts, job.attempts)))
      .returning({ id: documents.id }),
  ]).then((results) => results.at(-1));

  return Boolean(updated);
}

// job: { id, fileUrl, mimeType, fileName, attempts } as returned by the worker's claim.
// Returns { pageCount, chunkCount, saved } where saved=false means the lease was lost.
export async function runPipeline(job, { download = downloadFile } = {}) {
  const buffer = await download(job.fileUrl);
  const { pages, pageCount } = await extractText({ buffer, mimeType: job.mimeType, fileName: job.fileName });

  const chunks = chunkPages(pages);
  if (chunks.length === 0) throw new PermanentPipelineError('No extractable text');

  const saved = await saveChunks(job, pageCount, chunks);
  return { pageCount, chunkCount: chunks.length, saved };
}
