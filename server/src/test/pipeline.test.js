// Integration tests for the pipeline job lifecycle against the real database.
// Rows are inserted already claimed (status 'processing' + a lease 1 hour out), so a dev-server
// worker running at the same time can never pick them up. Downloads and Pinecone are faked.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { asc, eq, inArray, isNull, and, sql } from 'drizzle-orm';
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
  return {
    id: doc.id,
    fileUrl: doc.fileUrl,
    mimeType: doc.mimeType,
    fileName: doc.fileName,
    title: doc.title,
    accessLevel: doc.accessLevel,
    namespace: doc.pineconeNamespace,
    chunkCount: doc.chunkCount,
    pageCount: doc.pageCount,
    attempts,
  };
}

// In-memory stand-in for the Pinecone documents API. failUpsertOnCall makes the n-th upsert throw.
function fakeStore({ failUpsertOnCall } = {}) {
  const docs = new Map();
  let upsertCalls = 0;
  return {
    docs,
    get upsertCalls() {
      return upsertCalls;
    },
    upsert: async (namespace, batch) => {
      upsertCalls++;
      if (upsertCalls === failUpsertOnCall) throw new Error('Pinecone 429 rate limited');
      batch.forEach((d) => docs.set(`${namespace}/${d._id}`, d));
      return batch.length * 10;
    },
    listIds: async (namespace, prefix) =>
      [...docs.keys()].filter((k) => k.startsWith(`${namespace}/${prefix}`)).map((k) => k.slice(namespace.length + 1)),
    deleteIds: async (namespace, ids) => ids.forEach((id) => docs.delete(`${namespace}/${id}`)),
  };
}

const readDoc = async (id) => (await db.select().from(documents).where(eq(documents.id, id)))[0];
const unindexedCount = async (id) =>
  (await db.select().from(documentChunks).where(and(eq(documentChunks.documentId, id), isNull(documentChunks.indexedAt))))
    .length;
const reclaim = async (job, attempts) => {
  await db.update(documents).set({ status: 'processing', attempts }).where(eq(documents.id, job.id));
  return { ...job, attempts };
};

const policyText = Array.from({ length: 60 }, (_, i) => `Policy rule ${i} applies to every employee.`).join(' ');
const download = async () => Buffer.from(policyText);

test('success: chunked, upserted to Pinecone with deterministic ids, marked ready', async () => {
  const job = await insertClaimedDoc();
  const store = fakeStore();
  await processJob(job, { download, store, batchSize: 2 });

  const doc = await readDoc(job.id);
  const chunks = await db
    .select()
    .from(documentChunks)
    .where(eq(documentChunks.documentId, job.id))
    .orderBy(asc(documentChunks.chunkIndex));

  assert.equal(doc.status, 'ready');
  assert.equal(doc.embeddingModel, 'llama-text-embed-v2');
  assert.equal(doc.chunkCount, chunks.length);
  assert.equal(doc.leaseExpiresAt, null);
  assert.ok(chunks.length >= 3, 'needs several chunks to exercise batching');
  assert.ok(chunks.every((c) => c.indexedAt !== null));
  assert.equal(store.docs.size, chunks.length);

  const first = store.docs.get(`default/${job.id}#0`);
  assert.deepEqual(first, {
    _id: `${job.id}#0`,
    chunk_text: chunks[0].content,
    documentId: job.id,
    chunkIndex: 0,
    accessLevel: 'employee',
    title: job.title,
    fileName: 'test.txt',
    pageStart: 1,
    pageEnd: 1,
  });
});

test('Pinecone failure resumes from the unfinished batch without re-chunking', async () => {
  const job = await insertClaimedDoc();
  // Batch 1 succeeds, batch 2 hits a rate limit.
  const store = fakeStore({ failUpsertOnCall: 2 });
  await processJob(job, { download, store, batchSize: 2 });

  let doc = await readDoc(job.id);
  assert.equal(doc.status, 'pending', 'temporary failure should schedule a retry');
  assert.match(doc.error, /429/);
  const remaining = await unindexedCount(job.id);
  assert.equal(remaining, doc.chunkCount - 2, 'first batch stays indexed');

  // Retry: chunks exist, so download must not be called again.
  const retry = await reclaim({ ...job, chunkCount: doc.chunkCount, pageCount: doc.pageCount }, 2);
  const callsBefore = store.upsertCalls;
  await processJob(retry, {
    download: async () => assert.fail('should not re-download'),
    store,
    batchSize: 2,
  });

  doc = await readDoc(job.id);
  assert.equal(doc.status, 'ready');
  assert.equal(await unindexedCount(job.id), 0);
  assert.equal(store.upsertCalls - callsBefore, Math.ceil(remaining / 2), 'only unfinished chunks upserted');
  assert.equal(store.docs.size, doc.chunkCount);
});

test('stale Pinecone entries beyond the current chunk count are deleted', async () => {
  const job = await insertClaimedDoc();
  const store = fakeStore();
  await store.upsert('default', [{ _id: `${job.id}#999`, chunk_text: 'old' }]);
  await processJob(job, { download, store, batchSize: 50 });

  assert.equal((await readDoc(job.id)).status, 'ready');
  assert.equal(store.docs.has(`default/${job.id}#999`), false);
});

test('permanent error: failed immediately, no retry', async () => {
  const job = await insertClaimedDoc({ mimeType: 'image/png', fileName: 'photo.png' });
  await processJob(job, { download: async () => Buffer.from('x'), store: fakeStore() });

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
    store: fakeStore(),
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
    store: fakeStore(),
  });
  assert.equal((await readDoc(job.id)).status, 'failed');
});

test('a stale worker cannot overwrite the current owner', async () => {
  const job = await insertClaimedDoc({ attempts: 1 });
  // Another claim took over (attempt 2) while the stale worker (attempt 1) was still running.
  await db.update(documents).set({ attempts: 2 }).where(eq(documents.id, job.id));
  await processJob(job, { download, store: fakeStore() });

  const doc = await readDoc(job.id);
  assert.equal(doc.status, 'processing', 'status must stay with the attempt-2 owner');
  assert.equal(doc.chunkCount, 0, 'stale run must not record chunk counts');
});
