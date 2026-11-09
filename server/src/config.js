import 'dotenv/config';
import dns from 'node:dns';

// This machine resolves Neon to IPv6 first, and IPv6 connections have been timing out.
// Try IPv4 addresses first; IPv6 remains the fallback.
dns.setDefaultResultOrder('ipv4first');

for (const key of ['DATABASE_URL', 'JWT_SECRET', 'UPLOADTHING_TOKEN']) {
  if (!process.env[key]) throw new Error(`${key} is not set`);
}

export const config = {
  port: Number(process.env.PORT) || 5000,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  uploadthingToken: process.env.UPLOADTHING_TOKEN,
  isProd: process.env.NODE_ENV === 'production',
  cookieName: 'token',
  tokenTtlSeconds: 60 * 60 * 24 * 7,
};
