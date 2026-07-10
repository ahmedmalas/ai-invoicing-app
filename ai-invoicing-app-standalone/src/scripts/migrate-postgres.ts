import { pathToFileURL } from 'node:url';

import {
  PostgresMigrationError,
  migrateToPostgres,
  type MigrationSource,
} from '../migration/postgres-migration.js';

export function parseMigrationArguments(args: string[]): MigrationSource {
  const source: MigrationSource = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== '--sqlite' && flag !== '--snapshot') {
      throw new PostgresMigrationError(
        'Usage: npm run migrate:postgres -- --sqlite <path> | --snapshot <json path>',
      );
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new PostgresMigrationError(`Missing path for ${flag}.`);
    }
    if (flag === '--sqlite') {
      source.sqlitePath = value;
    } else {
      source.snapshotPath = value;
    }
    index += 1;
  }
  if (Boolean(source.sqlitePath) === Boolean(source.snapshotPath)) {
    throw new PostgresMigrationError('Specify exactly one of --sqlite or --snapshot.');
  }
  return source;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const source = parseMigrationArguments(args);
  const result = await migrateToPostgres(source, process.env.DATABASE_URL);
  const totalRows = Object.values(result.tableCounts).reduce((sum, count) => sum + count, 0);
  console.log(
    `PostgreSQL migration verified: ${totalRows} rows across ${Object.keys(result.tableCounts).length} platform tables.`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void main().catch((error: unknown) => {
    if (error instanceof PostgresMigrationError) {
      console.error(`PostgreSQL migration failed: ${error.message}`);
    } else {
      // Do not surface driver errors: malformed connection errors can contain DATABASE_URL.
      console.error('PostgreSQL migration failed.');
    }
    process.exitCode = 1;
  });
}
