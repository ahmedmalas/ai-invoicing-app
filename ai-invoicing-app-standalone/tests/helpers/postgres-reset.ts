import { Pool } from 'pg';

import { PLATFORM_SNAPSHOT_TABLES } from '../../src/db/database.js';

const RESET_LOCK_KEY = 874_221;

export async function resetPostgresTestDatabase(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1, allowExitOnIdle: true });
  const client = await pool.connect();
  const tables = [...PLATFORM_SNAPSHOT_TABLES]
    .reverse()
    .map((table) => `"${table}"`)
    .join(', ');
  try {
    await client.query('SELECT pg_advisory_lock($1)', [RESET_LOCK_KEY]);
    let attempt = 0;
    for (;;) {
      try {
        await client.query(`TRUNCATE TABLE ${tables} CASCADE`);
        break;
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: string }).code)
            : '';
        attempt += 1;
        if (code !== '40P01' || attempt >= 12) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 40 * attempt));
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [RESET_LOCK_KEY]);
    } catch {
      // ignore unlock failures during teardown
    }
    client.release();
    await pool.end();
  }
}
