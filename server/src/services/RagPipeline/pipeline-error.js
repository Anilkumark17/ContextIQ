// A failure that retrying cannot fix (unsupported type, no text, file too large).
// The worker marks the document 'failed' immediately instead of retrying.
// Any other error is treated as temporary (network, database) and retried with backoff.
export class PermanentPipelineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentPipelineError';
  }
}
