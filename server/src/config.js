import 'dotenv/config';
import dns from 'node:dns';

// This machine resolves Neon to IPv6 first, and IPv6 connections have been timing out.
// Try IPv4 addresses first; IPv6 remains the fallback.
dns.setDefaultResultOrder('ipv4first');

for (const key of ['DATABASE_URL', 'JWT_SECRET', 'UPLOADTHING_TOKEN', 'PINECONE_API_KEY', 'PINECONE_INDEX_HOST']) {
  if (!process.env[key]) throw new Error(`${key} is not set`);
}

if (!/^https:\/\//.test(process.env.PINECONE_INDEX_HOST)) {
  throw new Error('PINECONE_INDEX_HOST must be the index URL (https://<index>-<id>.svc.<env>.pinecone.io), not its name');
}

export const config = {
  port: Number(process.env.PORT) || 5000,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  uploadthingToken: process.env.UPLOADTHING_TOKEN,
  pinecone: {
    apiKey: process.env.PINECONE_API_KEY,
    indexHost: process.env.PINECONE_INDEX_HOST.replace(/\/+$/, ''),
    // The index embeds chunk_text itself (integrated embedding); the model is fixed by the index
    // schema. This value is only recorded on each document so a model change can be detected.
    embedModel: process.env.PINECONE_EMBED_MODEL || 'llama-text-embed-v2',
  },
  isProd: process.env.NODE_ENV === 'production',
  cookieName: 'token',
  tokenTtlSeconds: 60 * 60 * 24 * 7,
};
