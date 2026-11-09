// src/services/RagPipeline/pipeline.service.js
//
// Runs the pipeline for ONE claimed document:
//   1. download -> extract -> chunk -> save chunks   (skipped if the chunks are already saved)
//   2. upsert chunks to Pinecone, batch by batch       (only chunks not yet indexed);
//      Pinecone embeds chunk_text itself (integrated embedding)
//   3. delete stale Pinecone entries, mark the document 'ready'
//
// Each stage persists its result, so a retry resumes where the last attempt stopped.
// The worker (pipeline.worker.js) decides WHEN this runs and handles retries; this file does the work.
//
// OWNERSHIP: every write to the document row is fenced on (status 'processing', attempts = this
// claim's attempt). If the lease expired and another claim took over, the write matches no row
// and LeaseLostError stops this run. Chunk and vector writes are not fenced, but they are
// deterministic (same chunks, same vector ids), so a stale run writes exactly what the owner would.

import { and, eq, sql } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { documentChunks, documents } from '../../db/schema.js';
import { chunkPages } from './chunk.js';
import { indexChunks, removeStaleDocuments } from './embedding.js';
import { extractText } from './extract-text.service.js';
import { LeaseLostError, PermanentPipelineError } from './pipeline-error.js';

const DOWNLOAD_TIMEOUT_MS = 60_000;
// Upload limit is 16 MB; leave headroom but refuse anything unreasonable.
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const INSERT_BATCH_SIZE = 500;
export const LEASE_SECONDS = 5 * 60;

export const ownedBy = (job) =>
  and(eq(documents.id, job.id), eq(documents.status, 'processing'), eq(documents.attempts, job.attempts));

// Fenced update of the document row; throws LeaseLostError if this claim no longer owns it.
async function updateOwned(job, values) {
  const rows = await db.update(documents).set(values).where(ownedBy(job)).returning({ id: documents.id });
  if (rows.length === 0) throw new LeaseLostError(job.id);
}

// Extends the lease during long runs so the job is not reclaimed while still making progress.
export const extendLease = (job) =>
  updateOwned(job, { leaseExpiresAt: sql`now() + make_interval(secs => ${LEASE_SECONDS})` });

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

// Stage 1. Replaces the document's chunks and records the counts in one transaction (db.batch).
// The document stays 'processing'; the counts tell a later retry that this stage is done.
async function extractAndChunk(job, download) {
  const buffer = await download(job.fileUrl);
  const { pages, pageCount } = await extractText({ buffer, mimeType: job.mimeType, fileName: job.fileName });

  const chunks = chunkPages(pages);
  if (chunks.length === 0) throw new PermanentPipelineError('No extractable text');

  const rows = chunks.map((chunk) => ({ documentId: job.id, ...chunk }));
  const inserts = [];
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    inserts.push(db.insert(documentChunks).values(rows.slice(i, i + INSERT_BATCH_SIZE)));
  }

  const results = await db.batch([
    db.delete(documentChunks).where(eq(documentChunks.documentId, job.id)),
    ...inserts,
    db
      .update(documents)
      .set({ chunkCount: chunks.length, pageCount, error: null })
      .where(ownedBy(job))
      .returning({ id: documents.id }),
  ]);
  if (results.at(-1).length === 0) throw new LeaseLostError(job.id);

  return { chunkCount: chunks.length, pageCount };
}

// job: claimed row from the worker:
//   { id, fileUrl, mimeType, fileName, title, accessLevel, namespace, chunkCount, pageCount, attempts }
// deps (for tests): { download, store, batchSize }
export async function runPipeline(job, { download = downloadFile, store, batchSize } = {}) {
  let { chunkCount, pageCount } = job;
  let chunked = false;

  if (!chunkCount) {
    ({ chunkCount, pageCount } = await extractAndChunk(job, download));
    chunked = true;
  }

  const { indexed, embedTokens } = await indexChunks(job, { store, batchSize, heartbeat: () => extendLease(job) });
  const removed = await removeStaleDocuments(job, chunkCount, { store });

  await updateOwned(job, {
    status: 'ready',
    embeddingModel: config.pinecone.embedModel,
    error: null,
    leaseExpiresAt: null,
  });

  return { chunked, chunkCount, pageCount, indexed, embedTokens, removed };
}
