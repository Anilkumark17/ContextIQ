// src/services/RagPipeline/pipeline.worker.js
//
// In-process worker that turns 'pending' documents into chunks.
//
// WHY A DB-BACKED WORKER (and not running the pipeline inside onUploadComplete)
// - onUploadComplete holds the browser's upload open until it returns; long work would stall it.
// - A restart (node --watch restarts on every save) would lose in-flight work.
// The document row is the job. Its status + lease survive restarts, and an expired lease is
// reclaimed, so no document is ever stuck.
//
// LIFECYCLE OF ONE JOB
//   claim   pending (lease free) -> processing, attempts+1, lease = now + 5 min   (one atomic SQL)
//   run     download -> extract -> chunk -> save                  (pipeline.service.js)
//   success processing -> chunked                                 (saved with the chunks)
//   failure permanent error OR attempts used up -> failed
//           temporary error -> pending with lease = now + backoff  (waits, then is reclaimed)

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { documents } from '../../db/schema.js';
import { PermanentPipelineError } from './pipeline-error.js';
import { runPipeline } from './pipeline.service.js';

const LEASE_SECONDS = 5 * 60;
const IDLE_POLL_MS = 5_000;
export const MAX_ATTEMPTS = 3;
// Wait before retry n (after attempt 1, after attempt 2).
const RETRY_BACKOFF_SECONDS = [30, 120];

const log = (message) => console.log(`[pipeline] ${message}`);

// Claim the oldest claimable document. FOR UPDATE SKIP LOCKED makes concurrent claims safe:
// two workers never get the same row. Claimable = pending or processing, with no live lease.
export async function claimNext() {
  const result = await db.execute(sql`
    UPDATE documents
    SET status = 'processing',
        attempts = attempts + 1,
        lease_expires_at = now() + make_interval(secs => ${LEASE_SECONDS}),
        updated_at = now()
    WHERE id = (
      SELECT id FROM documents
      WHERE status IN ('pending', 'processing')
        AND (lease_expires_at IS NULL OR lease_expires_at < now())
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, file_url, mime_type, file_name, attempts
  `);

  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    fileUrl: row.file_url,
    mimeType: row.mime_type,
    fileName: row.file_name,
    attempts: row.attempts,
  };
}

// Only the current claim may change the row (status 'processing' + same attempt number).
const ownedBy = (job) =>
  and(eq(documents.id, job.id), eq(documents.status, 'processing'), eq(documents.attempts, job.attempts));

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
    const { pageCount, chunkCount, saved } = await runPipeline(job, deps);
    if (saved) log(`${job.id} chunked: ${pageCount} pages, ${chunkCount} chunks (${Date.now() - startedAt} ms)`);
    else log(`${job.id} finished but its lease was taken over; result left to the new owner`);
  } catch (err) {
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
