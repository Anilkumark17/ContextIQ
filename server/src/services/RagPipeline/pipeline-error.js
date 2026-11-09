// A failure that retrying cannot fix (unsupported type, no text, file too large, bad API key).
// The worker marks the document 'failed' immediately instead of retrying.
// Any other error is treated as temporary (network, database, rate limit) and retried with backoff.
export class PermanentPipelineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentPipelineError';
  }
}

// This worker's claim expired and another claim now owns the document. Stop without touching it.
export class LeaseLostError extends Error {
  constructor(documentId) {
    super(`Lease on ${documentId} was lost`);
    this.name = 'LeaseLostError';
  }
}
