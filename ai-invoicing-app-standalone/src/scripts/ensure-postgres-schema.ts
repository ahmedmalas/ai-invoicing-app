/**
 * Controlled one-shot Postgres schema migration for deploy pipelines.
 * Usage: npx tsx src/scripts/ensure-postgres-schema.ts
 *
 * Prefer this over relying on every Vercel cold start to run DDL.
 */

import { Pool } from 'pg';

import {
  DATABASE_SCHEMA_VERSION,
  ensurePostgresSchemaReady,
  normalizePostgresConnectionString,
} from '../db/postgres-database.js';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const pool = new Pool({
    connectionString: normalizePostgresConnectionString(databaseUrl),
    max: 1,
    connectionTimeoutMillis: 15_000,
  });
  try {
    const result = await ensurePostgresSchemaReady(pool);
    console.log(
      JSON.stringify({
        event: 'postgres.migrate.complete',
        path: result.path,
        schemaVersion: result.schemaVersion,
        appVersion: DATABASE_SCHEMA_VERSION,
      }),
    );
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'postgres.migrate.failed',
      message: error instanceof Error ? error.message : 'unknown',
    }),
  );
  process.exitCode = 1;
});
