// src/services/RagPipeline/pinecone.client.js
//
// Minimal client for Pinecone's Documents API (API version 2026-07).
//
// The index `production-rag-index` has a document schema with INTEGRATED EMBEDDING:
//   chunk_text  string, embedded by Pinecone with llama-text-embed-v2 (1024 dims, cosine),
//               input_type 'passage' on write / 'query' on read, plus full-text search
//   title       string, full-text search
// So we send text, not vectors: Pinecone creates the embedding on upsert.
// Any other field on a document is stored as metadata and is filterable.
// Such an index rejects the classic /vectors/* endpoints (HTTP 400).
//
// Docs: https://docs.pinecone.io/reference/api/2026-07/data-plane/upsert_documents

import { config } from '../../config.js';
import { PermanentPipelineError } from './pipeline-error.js';

const API_VERSION = '2026-07';
const MAX_TRIES = 4;

// Upsert limit when a schema field declares `embed` (otherwise 1000).
export const UPSERT_BATCH_SIZE = 96;
const DELETE_BATCH_SIZE = 1000;

const headers = () => ({
  'Api-Key': config.pinecone.apiKey,
  'X-Pinecone-Api-Version': API_VERSION,
  'Content-Type': 'application/json',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const namespaceUrl = (namespace, action) =>
  `${config.pinecone.indexHost}/namespaces/${encodeURIComponent(namespace)}/documents/${action}`;

// Retries rate limits (429), server errors (5xx) and network failures with exponential backoff.
// Other 4xx (bad key, invalid document, schema mismatch) are permanent: retrying cannot fix them.
async function post(url, body) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      if (attempt >= MAX_TRIES) throw new Error(`Pinecone unreachable: ${err.cause?.code ?? err.message}`);
      await sleep(500 * 2 ** attempt);
      continue;
    }

    if (response.ok) return response.json().catch(() => ({}));

    const detail = await response.text().catch(() => '');
    const message = `Pinecone ${new URL(url).pathname} failed (HTTP ${response.status}): ${detail.slice(0, 300)}`;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable) throw new PermanentPipelineError(message);
    if (attempt >= MAX_TRIES) throw new Error(message);

    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
  }
}

// documents: [{ _id, chunk_text, title, ...metadata }]. Upsert replaces a document with the same _id.
// Returns the embedding tokens Pinecone used.
export async function upsertDocuments(namespace, documents) {
  let embedTokens = 0;
  for (let i = 0; i < documents.length; i += UPSERT_BATCH_SIZE) {
    const result = await post(namespaceUrl(namespace, 'upsert'), {
      documents: documents.slice(i, i + UPSERT_BATCH_SIZE),
    });
    embedTokens += result?.usage?.embed_total_tokens ?? 0;
  }
  return embedTokens;
}

// All document ids in `namespace` starting with `prefix`.
export async function listDocumentIds(namespace, prefix) {
  const ids = [];
  let paginationToken;
  do {
    const page = await post(namespaceUrl(namespace, 'list'), {
      prefix,
      limit: 100,
      ...(paginationToken && { pagination_token: paginationToken }),
    });
    ids.push(...(page?.documents ?? []).map((doc) => doc._id));
    paginationToken = page?.pagination?.next;
  } while (paginationToken);
  return ids;
}

export async function deleteDocuments(namespace, ids) {
  for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
    await post(namespaceUrl(namespace, 'delete'), { ids: ids.slice(i, i + DELETE_BATCH_SIZE) });
  }
}
