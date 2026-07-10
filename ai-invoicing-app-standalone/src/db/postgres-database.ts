import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Pool, type PoolClient, types as pgTypes } from 'pg';

import {
  DATABASE_SCHEMA_VERSION,
  PLATFORM_SNAPSHOT_TABLES,
  PLATFORM_SNAPSHOT_VERSION,
  createDatabase,
  type AppDatabase,
  type DatabaseOperationalDiagnostics,
  type PlatformSnapshot,
  type SqliteAppDatabase,
} from './database.js';

const ADVISORY_LOCK_KEY = 1_905_052;
const MUTATING_METHOD =
  /^(?:add|approve|cancel|close|create|delete|finalise|link|remove|restore|update|upsert)/;

const EARLY_TABLES = [
  'business_profile',
  'preferences',
  'customers',
  'suppliers',
  'roles',
  'users',
  'user_role_links',
  'teams',
  'team_memberships',
  'documents',
] as const;
const DRAFT_ENTITY_TABLES = ['invoices', 'purchase_orders', 'supplier_bills'] as const;
const DRAFT_CHILD_TABLES = [
  'invoice_line_items',
  'purchase_order_line_items',
  'supplier_bill_line_items',
] as const;
const LATE_TABLES = [
  'jobs',
  'job_document_links',
  'credit_notes',
  'customer_payments',
  'payment_allocations',
  'supplier_payments',
  'supplier_payment_allocations',
  'invoice_sequences',
  'credit_note_sequences',
  'payment_sequences',
  'supplier_bill_sequences',
  'supplier_payment_sequences',
  'purchase_order_sequences',
  'job_sequences',
  'idempotency_requests',
] as const;
const FINAL_TABLES = ['invoice_snapshots', 'reminder_states', 'timeline_events'] as const;

type SnapshotTable = (typeof PLATFORM_SNAPSHOT_TABLES)[number];
type SnapshotRow = Record<string, unknown>;

export interface PostgresDatabaseOptions {
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
}

function loadPostgresSchema(): string {
  try {
    return readFileSync(new URL('./postgres-schema.sql', import.meta.url), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return readFileSync(resolve(process.cwd(), 'src/db/postgres-schema.sql'), 'utf8');
    }
    throw error;
  }
}

function emptySnapshot(entities: PlatformSnapshot['entities']): PlatformSnapshot {
  return {
    version: PLATFORM_SNAPSHOT_VERSION,
    products: [],
    derived: { customerStatements: [] },
    entities,
  };
}

async function readSnapshot(client: PoolClient): Promise<PlatformSnapshot> {
  const entities = {} as PlatformSnapshot['entities'];
  for (const table of PLATFORM_SNAPSHOT_TABLES) {
    const result = await client.query<SnapshotRow>(`SELECT * FROM "${table}" ORDER BY 1 ASC`);
    entities[table] = result.rows;
  }
  return emptySnapshot(entities);
}

async function tableColumns(client: PoolClient, table: SnapshotTable): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

async function insertRows(
  client: PoolClient,
  table: SnapshotTable,
  rows: SnapshotRow[],
  transform?: (row: SnapshotRow) => SnapshotRow,
): Promise<void> {
  if (rows.length === 0) return;
  const columns = await tableColumns(client, table);
  const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const sql = `INSERT INTO "${table}" (${quotedColumns}) VALUES (${placeholders})`;
  for (const source of rows) {
    const row = transform ? transform(source) : source;
    if (columns.some((column) => !Object.prototype.hasOwnProperty.call(row, column))) {
      throw new Error('BACKUP_RESTORE_INCOMPLETE_PAYLOAD');
    }
    await client.query(
      sql,
      columns.map((column) => row[column] ?? null),
    );
  }
}

async function replaceWithSnapshot(client: PoolClient, snapshot: PlatformSnapshot): Promise<void> {
  const tableList = [...PLATFORM_SNAPSHOT_TABLES]
    .reverse()
    .map((table) => `"${table}"`)
    .join(', ');
  await client.query(`TRUNCATE TABLE ${tableList} CASCADE`);

  for (const table of EARLY_TABLES) await insertRows(client, table, snapshot.entities[table]);
  for (const table of DRAFT_ENTITY_TABLES) {
    await insertRows(client, table, snapshot.entities[table], (row) => ({
      ...row,
      status: 'Draft',
    }));
  }
  for (const table of DRAFT_CHILD_TABLES) await insertRows(client, table, snapshot.entities[table]);
  for (const table of LATE_TABLES) await insertRows(client, table, snapshot.entities[table]);

  for (const table of DRAFT_ENTITY_TABLES) {
    for (const row of snapshot.entities[table]) {
      if (typeof row.id !== 'string' || typeof row.status !== 'string') {
        throw new Error('BACKUP_RESTORE_INCOMPLETE_PAYLOAD');
      }
      await client.query(`UPDATE "${table}" SET status = $1 WHERE id = $2`, [row.status, row.id]);
    }
  }
  for (const table of FINAL_TABLES) await insertRows(client, table, snapshot.entities[table]);
}

async function applySchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(loadPostgresSchema());
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_database_metadata (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        schema_version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    const current = await client.query<{ schema_version: number }>(
      'SELECT schema_version FROM app_database_metadata WHERE singleton_id = 1',
    );
    const version = current.rows[0]?.schema_version;
    if (version !== undefined && version > DATABASE_SCHEMA_VERSION) {
      throw new Error('DB_SCHEMA_VERSION_UNSUPPORTED');
    }
    await client.query(
      `INSERT INTO app_database_metadata (singleton_id, schema_version, updated_at)
       VALUES (1, $1, $2)
       ON CONFLICT (singleton_id) DO UPDATE
       SET schema_version = EXCLUDED.schema_version, updated_at = EXCLUDED.updated_at`,
      [DATABASE_SCHEMA_VERSION, new Date().toISOString()],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function invokeSqlite(
  sqlite: SqliteAppDatabase,
  method: keyof AppDatabase,
  args: unknown[],
): unknown {
  const candidate = sqlite[method] as unknown;
  if (typeof candidate !== 'function') throw new Error(`DATABASE_METHOD_NOT_FOUND:${method}`);
  return candidate.apply(sqlite, args);
}

export async function createPostgresDatabase(
  connectionString: string,
  options: PostgresDatabaseOptions = {},
): Promise<AppDatabase> {
  pgTypes.setTypeParser(20, Number);
  const pool = new Pool({
    connectionString,
    max: Math.max(1, Math.trunc(options.maxConnections ?? 5)),
    idleTimeoutMillis: Math.max(1000, Math.trunc(options.idleTimeoutMs ?? 10_000)),
    connectionTimeoutMillis: Math.max(1000, Math.trunc(options.connectionTimeoutMs ?? 10_000)),
    allowExitOnIdle: true,
  });
  pool.on('error', () => {
    // Checked-out operations surface their own error. Idle-client errors must be
    // observed to prevent Node from terminating the process.
  });

  try {
    await applySchema(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await pool.end();
  };
  const diagnostics = async (): Promise<DatabaseOperationalDiagnostics> => {
    const client = await pool.connect();
    try {
      const [metadata, check] = await Promise.all([
        client.query<{ schema_version: number }>(
          'SELECT schema_version FROM app_database_metadata WHERE singleton_id = 1',
        ),
        client.query<{ ok: number }>('SELECT 1 AS ok'),
      ]);
      const userVersion = metadata.rows[0]?.schema_version ?? 0;
      return {
        migration: {
          schemaVersion: DATABASE_SCHEMA_VERSION,
          userVersion,
          compatible: userVersion === DATABASE_SCHEMA_VERSION,
        },
        runtime: {
          journalMode: 'postgresql',
          foreignKeysEnabled: true,
          busyTimeoutMs: 0,
          quickCheck: check.rows[0]?.ok === 1 ? 'ok' : 'failed',
        },
        backupRestore: {
          snapshotVersion: PLATFORM_SNAPSHOT_VERSION,
          tableCount: PLATFORM_SNAPSHOT_TABLES.length,
        },
      };
    } finally {
      client.release();
    }
  };

  return new Proxy({} as AppDatabase, {
    get(_target, property) {
      if (property === 'close') return close;
      if (property === 'getOperationalDiagnostics') return diagnostics;
      if (typeof property !== 'string') return undefined;

      return async (...args: unknown[]): Promise<unknown> => {
        if (closed) throw new Error('DATABASE_CLOSED');
        const client = await pool.connect();
        const sqlite = createDatabase(':memory:');
        try {
          await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
          await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);
          const source = await readSnapshot(client);
          sqlite.restorePlatformSnapshot(source);
          const result = invokeSqlite(sqlite, property as keyof AppDatabase, args);
          if (MUTATING_METHOD.test(property)) {
            await replaceWithSnapshot(client, sqlite.exportPlatformSnapshot());
          }
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          sqlite.close();
          client.release();
        }
      };
    },
  });
}
