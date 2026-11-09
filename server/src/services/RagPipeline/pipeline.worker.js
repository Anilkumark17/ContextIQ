// src/services/RagPipeline/pipeline.worker.js
//
// In-process worker that turns uploaded documents into searchable vectors.
//
// WHY A DB-BACKED WORKER (and not running the pipeline inside onUploadComplete)
// - onUploadComplete holds the browser's upload open until it returns; long work would stall it.
// - A restart (node --watch restarts on every save) would lose in-flight work.
// The document row is the job. Its status + lease survive restarts, and an expired lease is
// reclaimed, so no document is ever stuck.
//
// LIFECYCLE OF ONE JOB
//   claim   pending | chunked | processing(lease expired)  -> processing, attempts+1, lease 5 min
//   run     chunk (if not done) -> embed + index (unindexed chunks only)   (pipeline.service.js)
//   success processing -> ready
//   failure permanent error OR attempts used up -> failed
//           temporary error -> pending with lease = now + backoff  (waits, then is reclaimed;
//                              saved chunks and indexed batches are kept, so it resumes)

import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { documents } from '../../db/schema.js';
import { LeaseLostError, PermanentPipelineError } from './pipeline-error.js';
import { LEASE_SECONDS, ownedBy, runPipeline } from './pipeline.service.js';

const IDLE_POLL_MS = 5_000;
export const MAX_ATTEMPTS = 3;
// Wait before retry n (after attempt 1, after attempt 2).
const RETRY_BACKOFF_SECONDS = [30, 120];

const log = (message) => console.log(`[pipeline] ${message}`);

// Claim the oldest claimable document. FOR UPDATE SKIP LOCKED makes concurrent claims safe:
// two workers never get the same row. Claimable = waiting status with no live lease.
// 'chunked' covers documents chunked before the embedding stage existed.
export async function claimNext() {
  const result = await db.execute(sql`
    UPDATE documents
    SET status = 'processing',
        attempts = attempts + 1,
        lease_expires_at = now() + make_interval(secs => ${LEASE_SECONDS}),
        updated_at = now()
    WHERE id = (
      SELECT id FROM documents
      WHERE status IN ('pending', 'chunked', 'processing')
        AND (lease_expires_at IS NULL OR lease_expires_at < now())
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, file_url, mime_type, file_name, title, access_level, pinecone_namespace,
              chunk_count, page_count, attempts
  `);

  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    fileUrl: row.file_url,
    mimeType: row.mime_type,
    fileName: row.file_name,
    title: row.title,
    accessLevel: row.access_level,
    namespace: row.pinecone_namespace,
    chunkCount: row.chunk_count,
    pageCount: row.page_count,
    attempts: row.attempts,
  };
}

const errorText = (err) => String(err?.message ?? err).slice(0, 1000);

async function markFailed(job, message) {
  await db
    .update(documents)
    .set({ status: 'failed', error: message, leaseExpiresAt: null })
    .where(ownedBy(job));
}

async function scheduleRetry(job, message) {
  const delay = RETRY_BACKOFF_SECONDS[job.attempts - 1] ?? RETRY_BACKOFF_SECONDS.at(-1);
  await db
    .update(documents)
    .set({
      status: 'pending',
      error: message,
      leaseExpiresAt: sql`now() + make_interval(secs => ${delay})`,
    })
    .where(ownedBy(job));
  return delay;
}

export async function processJob(job, deps) {
  // A previous attempt died mid-run (lease expired) and attempts are used up.
  if (job.attempts > MAX_ATTEMPTS) {
    await markFailed(job, `Gave up after ${MAX_ATTEMPTS} attempts`);
    log(`${job.id} failed: attempts exhausted`);
    return;
  }

  const startedAt = Date.now();
  try {
    const result = await runPipeline(job, deps);
    log(
      `${job.id} ready: ${result.chunked ? `chunked into ${result.chunkCount}` : `${result.chunkCount} chunks`}, ` +
        `indexed ${result.indexed} (${result.embedTokens} embed tokens), removed ${result.removed} stale ` +
        `(${Date.now() - startedAt} ms)`,
    );
  } catch (err) {
    if (err instanceof LeaseLostError) {
      log(`${job.id} lease lost; the new owner continues`);
      return;
    }
    const message = errorText(err);
    try {
      if (err instanceof PermanentPipelineError || job.attempts >= MAX_ATTEMPTS) {
        await markFailed(job, message);
        log(`${job.id} failed (attempt ${job.attempts}): ${message}`);
      } else {
        const delay = await scheduleRetry(job, message);
        log(`${job.id} attempt ${job.attempts} failed, retrying in ${delay}s: ${message}`);
      }
    } catch (markErr) {
      // Could not record the outcome (e.g. database down). The lease expires and the job is reclaimed.
      log(`${job.id} could not record failure: ${errorText(markErr)}`);
    }
  }
}

// ---------- Worker loop ----------

let running = false;
let loopPromise = null;
let wakeSleeper = null;

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      wakeSleeper = null;
      resolve();
    }
    wakeSleeper = done;
  });
}

// Called after an upload: check for work now instead of waiting for the next poll.
// Safe to call when the worker is not running (e.g. in tests); it does nothing then.
export function wakePipeline() {
  wakeSleeper?.();
}

async function loop() {
  while (running) {
    let job;
    try {
      job = await claimNext();
    } catch (err) {
      log(`claim failed: ${errorText(err)}`);
      await sleep(IDLE_POLL_MS);
      continue;
    }

    if (!job) {
      await sleep(IDLE_POLL_MS);
      continue;
    }

    log(`${job.id} claimed (attempt ${job.attempts})`);
    await processJob(job);
  }
}

export function startPipelineWorker() {
  if (running) return;
  running = true;
  log('worker started');
  loopPromise = loop();
}

// Stops claiming new work and waits for the current job to finish.
export async function stopPipelineWorker() {
  if (!running) return;
  running = false;
  wakePipeline();
  await loopPromise;
  log('worker stopped');
}
