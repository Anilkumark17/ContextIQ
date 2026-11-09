// Concatenates the Drizzle migrations into ../infra/schema.sql as one readable schema file.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(import.meta.dirname, '..', 'drizzle');
const outFile = join(import.meta.dirname, '..', '..', 'infra', 'schema.sql');

const header = `-- Full database schema, concatenated from server/drizzle migrations.
-- Source of truth: server/src/db/schema.js. Regenerate after changing it:
--   cd server && npm run db:generate && npm run schema:sql

`;

const body = readdirSync(migrationsDir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((f) => `-- ${f}\n${readFileSync(join(migrationsDir, f), 'utf8').replaceAll('--> statement-breakpoint', '')}\n`)
  .join('\n');

writeFileSync(outFile, header + body);
console.log(`Wrote ${outFile}`);
