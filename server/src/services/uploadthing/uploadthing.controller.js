// src/services/uploadthing/uploadthing.controller.js
import { UploadThingError, UTApi } from 'uploadthing/server';
import { config } from '../../config.js';
import { getAuthUser } from '../../common/middleware/auth.js';
import { sha256FromUrl } from '../../utils/hash.js';
import { wakePipeline } from '../RagPipeline/pipeline.worker.js';
import {
  findByChecksum,
  createDocument,
  listDocuments,
  resetToPending,
  restrictToAdmin,
} from './document.service.js';

const utapi = new UTApi({ token: config.uploadthingToken });

// GET /api/documents: documents visible to the signed-in user's role.
export async function getDocuments(req, res) {
  const rows = await listDocuments(req.user.role);
  res.json({ documents: rows });
}

// Before upload: verify user, decide access level, pass metadata to the post-upload step.
export async function authorizeUpload({ req, input }) {
  const user = await getAuthUser(req);
  if (!user) throw new UploadThingError('Unauthorized');

  const accessLevel = user.role === 'admin' ? input.accessLevel : 'employee';
  return { userId: user.id, role: user.role, accessLevel };
}

// Delete a redundant uploaded file; log instead of failing if deletion errors.
async function deleteUploadedFile(fileKey) {
  try {
    await utapi.deleteFiles(fileKey);
  } catch (err) {
    console.error(`[upload] orphaned file: ${fileKey}`, err);
  }
}

// After upload: hash the file, then create, retry, restrict, or mark as duplicate.
export async function handleUploadComplete({ metadata, file }) {
  let checksum;
  try {
    checksum = await sha256FromUrl(file.ufsUrl);
  } catch {
    await deleteUploadedFile(file.key);
    throw new UploadThingError('Could not read uploaded file');
  }

  let existing = await findByChecksum(checksum);

  if (!existing) {
    const created = await createDocument({
      title: file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      fileKey: file.key,
      fileUrl: file.ufsUrl,
      checksum,
      accessLevel: metadata.accessLevel,
      uploadedBy: metadata.userId,
    });
    if (created) {
      // The row is the pipeline job; wake the worker so it starts now instead of at the next poll.
      wakePipeline();
      return { documentId: created.id, outcome: 'created' };
    }

    existing = await findByChecksum(checksum);
  }

  await deleteUploadedFile(file.key);

  if (existing.accessLevel === 'admin' && metadata.role !== 'admin') {
    return { documentId: null, outcome: 'duplicate' };
  }

  if (metadata.role === 'admin' && metadata.accessLevel === 'admin' && existing.accessLevel === 'employee') {
    await restrictToAdmin(existing.id);
  }

  if (existing.status === 'failed') {
    const reset = await resetToPending(existing.id);
    if (reset) wakePipeline();
    return { documentId: existing.id, outcome: reset ? 'retried' : 'duplicate' };
  }

  return { documentId: existing.id, outcome: 'duplicate' };
}