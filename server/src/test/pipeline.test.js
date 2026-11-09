// Integration tests for the pipeline job lifecycle against the real database.
// Rows are inserted already claimed (status 'processing' + a lease 1 hour out), so a dev-server
// worker running at the same time can never pick them up. Downloads are injected; no network.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documentChunks, documents } from '../db/schema.js';
import { MAX_ATTEMPTS, processJob } from '../services/RagPipeline/pipeline.worker.js';

const created = [];

after(async () => {
  if (created.length) await db.delete(documents).where(inArray(documents.id, created));
});

async function insertClaimedDoc({ attempts = 1, mimeType = 'text/plain', fileName = 'test.txt' } = {}) {
  const tag = randomUUID();
  const [doc] = await db
    .insert(documents)
    .values({
      title: `zz-pipeline-test-${tag}`,
      fileName,
      mimeType,
      sizeBytes: 100,
      fileKey: `zz-test-${tag}`,
      fileUrl: `https://example.invalid/${tag}`,
      checksum: tag.replaceAll('-', '').padEnd(64, '0'),
      status: 'processing',
      attempts,
      leaseExpiresAt: sql`now() + interval '1 hour'`,
    })
    .returning();
  created.push(doc.id);
  return { id: doc.id, fileUrl: doc.fileUrl, mimeType: doc.mimeType, fileName: doc.fileName, attempts };
}

const readDoc = async (id) => (await db.select().from(documents).where(eq(documents.id, id)))[0];

const policyText = Array.from({ length: 40 }, (_, i) => `Policy rule ${i} applies to every employee.`).join(' ');

test('success: chunks saved and document marked chunked', async () => {
  const job = await insertClaimedDoc();
  await processJob(job, { download: async () => Buffer.from(policyText) });

  const doc = await readDoc(job.id);
  const chunks = await db
    .select()
    .from(documentChunks)
    .where(eq(documentChunks.documentId, job.id))
    .orderBy(asc(documentChunks.chunkIndex));

  assert.equal(doc.status, 'chunked');
  assert.equal(doc.pageCount, 1);
  assert.equal(doc.chunkCount, chunks.length);
  assert.equal(doc.leaseExpiresAt, null);
  assert.ok(chunks.length >= 2);
  assert.deepEqual(chunks.map((c) => c.chunkIndex), chunks.map((_, i) => i));
  assert.ok(chunks.every((c) => c.pageStart === 1 && c.pageEnd === 1 && c.tokenCount > 0));
});

test('re-running replaces chunks instead of duplicating them', async () => {
  const job = await insertClaimedDoc();
  const download = async () => Buffer.from(policyText);
  await processJob(job, { download });
  const firstCount = (await readDoc(job.id)).chunkCount;

  // Simulate a reclaim (e.g. after a crash) and run again.
  await db.update(documents).set({ status: 'processing', attempts: 2 }).where(eq(documents.id, job.id));
  await processJob({ ...job, attempts: 2 }, { download });

  const rows = await db.select().from(documentChunks).where(eq(documentChunks.documentId, job.id));
  assert.equal(rows.length, firstCount);
});

test('permanent error: failed immediately, no retry', async () => {
  const job = await insertClaimedDoc({ mimeType: 'image/png', fileName: 'photo.png' });
  await processJob(job, { download: async () => Buffer.from('x') });

  const doc = await readDoc(job.id);
  assert.equal(doc.status, 'failed');
  assert.match(doc.error, /Unsupported file type/);
});

test('temporary error: back to pending with a backoff lease', async () => {
  const job = await insertClaimedDoc();
  await processJob(job, {
    download: async () => {
      throw new Error('socket hang up');
    },
  });

  const doc = await readDoc(job.id);
  assert.equal(doc.status, 'pending');
  assert.equal(doc.attempts, 1);
  assert.match(doc.error, /socket hang up/);
  assert.ok(doc.leaseExpiresAt > new Date(), 'retry should wait for the backoff');
});

test('temporary error on the last attempt: failed', async () => {
  const job = await insertClaimedDoc({ attempts: MAX_ATTEMPTS });
  await processJob(job, {
    download: async () => {
      throw new Error('socket hang up');
    },
  });
  assert.equal((await readDoc(job.id)).status, 'failed');
});

test('a stale worker cannot overwrite the current owner', async () => {
  const job = await insertClaimedDoc({ attempts: 1 });
  // Another claim took over (attempt 2) while the stale worker (attempt 1) was still running.
  await db.update(documents).set({ attempts: 2 }).where(eq(documents.id, job.id));
  await processJob(job, { download: async () => Buffer.from(policyText) });

  const doc = await readDoc(job.id);
  assert.equal(doc.status, 'processing', 'status must stay with the attempt-2 owner');
  assert.equal(doc.chunkCount, 0, 'stale run must not mark the document chunked');
});
