import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { config } from '../config.js';
import * as schema from './schema.js';

// The Neon HTTP driver sends every query as an HTTPS request. On a flaky network that request can
// fail before a connection opens ("fetch failed"). Retrying is only safe in that case: the query
// never reached Postgres, so it cannot run twice. Errors after connecting are never retried.
const CONNECT_ERROR_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
]);
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [200, 800];

export function isConnectError(err) {
  const cause = err?.cause;
  if (!cause) return false;
  // Node tries each resolved address (IPv6 + IPv4); if all fail it throws an AggregateError.
  const causes = cause instanceof AggregateError ? cause.errors : [cause];
  return causes.length > 0 && causes.every((c) => CONNECT_ERROR_CODES.has(c?.code));
}

async function fetchWithConnectRetry(url, options) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (attempt >= MAX_RETRIES || !isConnectError(err)) throw err;
      console.warn(`[db] connection failed (${err.cause?.code ?? 'AggregateError'}), retry ${attempt + 1}/${MAX_RETRIES}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

neonConfig.fetchFunction = fetchWithConnectRetry;

export const db = drizzle(neon(config.databaseUrl), { schema });
