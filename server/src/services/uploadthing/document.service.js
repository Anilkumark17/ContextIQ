// src/services/uploadthing/document.service.js
//
// SERVICE LAYER
// - The only layer that talks to the database for the `documents` table.
// - The controller calls these functions; it never writes Drizzle queries itself.
// - Each function = one database operation. No UploadThing, no req/res here.
//
// DATA FLOW PER CALL
//   service function -> Drizzle builds SQL -> Neon driver sends it -> Postgres executes
//   Nothing is sent until `await`. The method chain only builds a query object.
//
// CHECKSUM DESIGN
// - checksum = SHA-256 of the file bytes (computed in utils/hash.js).
// - Same bytes -> same checksum, regardless of file name or uploader.
// - Purpose: one row per unique content. Prevents duplicate chunks/vectors in Pinecone,
//   which would waste top-k retrieval slots, duplicate citations, and break deletion.
// - The checksum FINDS a row. Changes to that row are made by its `id`.
// - The UNIQUE constraint on `checksum` in Postgres is the final guarantee.
//   Application checks can lose a race; the constraint cannot.

import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { documents, users } from '../../db/schema.js';

// ------------------------------------------------------------------
// findByChecksum
// Question answered: "Have we already seen these exact bytes?"
//
// Returns only id, status, accessLevel: the minimum the controller needs to decide.
//   null                         -> new content      -> createDocument
//   status 'failed'              -> retry            -> resetToPending
//   status pending/processing/ready -> duplicate     -> return existing id
//   accessLevel                  -> needed to block leaks / allow admin upgrade
//
// .limit(1): checksum is unique, so at most one match; limit states that intent.
// rows[0] ?? null: Drizzle always returns an array; null gives a simple `if (existing)`.
// ------------------------------------------------------------------
export async function findByChecksum(checksum) {
  const rows = await db
    .select({
      id: documents.id,
      status: documents.status,
      accessLevel: documents.accessLevel,
    })
    .from(documents)
    .where(eq(documents.checksum, checksum))
    .limit(1);

  return rows[0] ?? null;
}

// ------------------------------------------------------------------
// createDocument
// Inserts a new document row with status 'pending'.
//
// Explicit field mapping (no `...data` spread):
//   prevents a caller from injecting `status: 'ready'` or a custom `id`.
// status hard-coded 'pending': a new document always starts unprocessed.
//
// RACE CONDITION HANDLED:
//   Two concurrent uploads of the same file can both see `null` from findByChecksum.
//   Without protection, the second insert throws Postgres error 23505 (unique violation).
//   onConflictDoNothing on `checksum` makes the losing insert return no rows instead.
//
// Returns:
//   { id }  -> this call created the row
//   null    -> another request created it first; controller should re-run findByChecksum
// ------------------------------------------------------------------
export async function createDocument(data) {
  const rows = await db
    .insert(documents)
    .values({
      title: data.title,
      fileName: data.fileName,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      fileKey: data.fileKey,
      fileUrl: data.fileUrl,
      checksum: data.checksum,
      accessLevel: data.accessLevel,
      uploadedBy: data.uploadedBy,
      status: 'pending',
    })
    .onConflictDoNothing({ target: documents.checksum })
    .returning({ id: documents.id });

  return rows[0] ?? null;
}

// ------------------------------------------------------------------
// resetToPending
// Retries a failed document by reusing its existing row (no new row, no duplicate).
// Clears `error` so the retried document does not show the old failure.
// `updatedAt` refreshes automatically via $onUpdate in the schema.
//
// DOUBLE-RETRY RACE HANDLED:
//   The WHERE includes status = 'failed'. If two requests retry together,
//   only the first matches; the second updates 0 rows.
//   Prevents the same document being processed twice (duplicate chunks/vectors).
//
// Returns:
//   true  -> this call reset it
//   false -> already reset by another request, or the id does not exist
//
// KNOWN LIMITATION:
//   Keeps the OLD fileKey/fileUrl. If that file was deleted from UploadThing,
//   the retry fails again. The new duplicate upload must be deleted by the controller.
//
// PIPELINE: attempts and lease are reset so the worker gets a fresh set of retries
// and can claim the row immediately.
// ------------------------------------------------------------------
export async function resetToPending(documentId) {
  const rows = await db
    .update(documents)
    .set({ status: 'pending', error: null, attempts: 0, leaseExpiresAt: null })
    .where(and(eq(documents.id, documentId), eq(documents.status, 'failed')))
    .returning({ id: documents.id });

  return rows.length > 0;
}

// ------------------------------------------------------------------
// restrictToAdmin
// Handles the access-level gap in dedup:
//   An employee uploaded a file as 'employee'. An admin uploads the same bytes as 'admin'.
//   Dedup would return the existing row and silently drop the admin's restriction.
// The controller calls this only when the uploader is an admin requesting 'admin'.
//
// Upgrade only, never downgrade: WHERE access_level = 'employee'.
// Downgrading restricted content must be a deliberate admin action, not a side effect of upload.
//
// NOTE: vectors already in Pinecone carry accessLevel in metadata.
//   After this update, those vectors must be re-tagged or the restriction is not
//   enforced at retrieval. That sync belongs to the Pinecone subtask.
// ------------------------------------------------------------------
export async function restrictToAdmin(documentId) {
  const rows = await db
    .update(documents)
    .set({ accessLevel: 'admin' })
    .where(and(eq(documents.id, documentId), eq(documents.accessLevel, 'employee')))
    .returning({ id: documents.id });

  return rows.length > 0;
}

// ------------------------------------------------------------------
// listDocuments
// Documents the given role may see, newest first, with the uploader's name.
//   admin    -> every document
//   employee -> only accessLevel 'employee' (admin-only documents never leave the DB)
// Selects explicit columns: checksum, fileKey and internal metadata stay server-side.
// ------------------------------------------------------------------
export async function listDocuments(role) {
  return db
    .select({
      id: documents.id,
      title: documents.title,
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      fileUrl: documents.fileUrl,
      status: documents.status,
      accessLevel: documents.accessLevel,
      error: documents.error,
      chunkCount: documents.chunkCount,
      pageCount: documents.pageCount,
      uploadedBy: users.name,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .leftJoin(users, eq(users.id, documents.uploadedBy))
    .where(role === 'admin' ? undefined : eq(documents.accessLevel, 'employee'))
    .orderBy(desc(documents.createdAt));
}

// ------------------------------------------------------------------
// FAILURE CASES NOT HANDLED IN THIS FILE (owned by later steps)
// - Stuck rows: a crash mid-ingestion leaves status pending/processing forever;
//   re-upload returns "duplicate" and it never gets indexed. Needs a staleness rule
//   in the processing step.
// - Existence leak: an employee uploading bytes that exist as 'admin' must not receive
//   that document id. The controller enforces this using accessLevel from findByChecksum.
// - Orphaned duplicate files in UploadThing: the controller deletes them.
// - DB unavailable / Neon cold start: errors propagate; the controller decides the response.
// ------------------------------------------------------------------
