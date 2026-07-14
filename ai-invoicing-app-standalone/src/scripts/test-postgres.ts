import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

if (process.platform === 'win32' && process.arch === 'arm64') {
  // Windows ARM64 can execute x64 PostgreSQL under the built-in emulation layer.
  Object.defineProperty(os, 'arch', { value: () => 'x64' });
}
const { default: EmbeddedPostgres } = await import('embedded-postgres');

async function availablePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('PORT_ALLOCATION_FAILED'));
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

const directory = mkdtempSync(join(tmpdir(), 'aboss-postgres-'));
const port = await availablePort();
const password = randomBytes(24).toString('hex');
const database = 'aboss_invoicing_test';
const postgres = new EmbeddedPostgres({
  databaseDir: directory,
  port,
  user: 'postgres',
  password,
  persistent: false,
  onLog: () => undefined,
  onError: (error) => process.stderr.write(`embedded-postgres: ${String(error)}\n`),
});

let exitCode = 1;
try {
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase(database);
  const url = `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;
  exitCode = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(
      process.execPath,
      [
        resolve('node_modules/vitest/vitest.mjs'),
        'run',
        'tests/integration/postgres-database.integration.test.ts',
        '--coverage=false',
      ],
      {
        stdio: 'inherit',
        env: { ...process.env, TEST_DATABASE_URL: url },
      },
    );
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
} finally {
  await postgres.stop().catch(() => undefined);
  rmSync(directory, { recursive: true, force: true });
}

process.exitCode = exitCode;
