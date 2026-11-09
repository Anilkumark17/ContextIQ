// src/services/RagPipeline/embedding.js
//
// STAGE 2: chunks (Postgres) -> Pinecone documents. Pinecone embeds `chunk_text` itself
// (integrated embedding, llama-text-embed-v2), so this stage sends text, not vectors.
//
// RESUMABLE BY DESIGN
// - Work is done in batches of up to 96 chunks (Pinecone's limit for embedding upserts).
// - After a batch is upserted, its chunks get `indexed_at`. A retry only picks chunks where
//   indexed_at IS NULL, so a crash or rate-limit failure resumes at the first unfinished batch.
//
// PINECONE DOCUMENT IDS: "<documentId>#<chunkIndex>"
// - Deterministic: re-running upserts the same ids (replace), never duplicates.
// - The prefix "<documentId>#" lists all of a document's entries, which is how stale ones are
//   found and deleted after a document is re-chunked into fewer chunks.
//
// FIELDS SENT
// - chunk_text, title: the index schema fields (embedded / full-text searchable).
// - documentId, chunkIndex, accessLevel, fileName, pageStart, pageEnd: metadata, filterable.
//   Retrieval filters on accessLevel, then re-checks access in Postgres (the source of truth).

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { documentChunks } from '../../db/schema.js';
import { UPSERT_BATCH_SIZE, deleteDocuments, listDocumentIds, upsertDocuments } from './pinecone.client.js';

export const pineconeIdPrefix = (documentId) => `${documentId}#`;
export const pineconeId = (documentId, chunkIndex) => `${pineconeIdPrefix(documentId)}${chunkIndex}`;

// Pinecone metadata accepts booleans, numbers, strings and string arrays; never null.
const withoutNulls = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

export const toPineconeDocument = (job, chunk) =>
  withoutNulls({
    _id: pineconeId(job.id, chunk.chunkIndex),
    chunk_text: chunk.content,
    title: job.title,
    documentId: job.id,
    chunkIndex: chunk.chunkIndex,
    accessLevel: job.accessLevel,
    fileName: job.fileName,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
  });

const defaultStore = { upsert: upsertDocuments, listIds: listDocumentIds, deleteIds: deleteDocuments };

// job: { id, title, fileName, accessLevel, namespace }
// heartbeat: called after each batch to extend the worker's lease (throws if the lease was lost).
// Returns { indexed, embedTokens } for this run.
export async function indexChunks(job, { store = defaultStore, batchSize = UPSERT_BATCH_SIZE, heartbeat } = {}) {
  let indexed = 0;
  let embedTokens = 0;

  for (;;) {
    const batch = await db
      .select({
        id: documentChunks.id,
        chunkIndex: documentChunks.chunkIndex,
        content: documentChunks.content,
        pageStart: documentChunks.pageStart,
        pageEnd: documentChunks.pageEnd,
      })
      .from(documentChunks)
      .where(and(eq(documentChunks.documentId, job.id), isNull(documentChunks.indexedAt)))
      .orderBy(asc(documentChunks.chunkIndex))
      .limit(batchSize);
    if (batch.length === 0) break;

    embedTokens += (await store.upsert(job.namespace, batch.map((chunk) => toPineconeDocument(job, chunk)))) ?? 0;

    await db
      .update(documentChunks)
      .set({ indexedAt: new Date() })
      .where(inArray(documentChunks.id, batch.map((chunk) => chunk.id)));

    indexed += batch.length;
    await heartbeat?.();
  }

  return { indexed, embedTokens };
}

// Deletes this document's Pinecone entries whose chunkIndex no longer exists (re-chunked into
// fewer chunks). Returns how many were deleted.
export async function removeStaleDocuments(job, chunkCount, { store = defaultStore } = {}) {
  const prefix = pineconeIdPrefix(job.id);
  const ids = await store.listIds(job.namespace, prefix);
  const stale = ids.filter((id) => Number(id.slice(prefix.length)) >= chunkCount);
  if (stale.length) await store.deleteIds(job.namespace, stale);
  return stale.length;
}
