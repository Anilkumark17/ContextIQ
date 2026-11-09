// src/utils/hash.js

// deduplication. The hash detects whether the exact same file has already been ingested,
// regardless of its name.

// otherwise we create the identical chunks in pinecone

import crypto from 'node:crypto';

export async function sha256FromUrl(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch file for hashing: ${response.status} ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return crypto.createHash('sha256').update(buffer).digest('hex');
}
