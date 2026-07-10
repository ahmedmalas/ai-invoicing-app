import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });
const healthReadySchema = z.object({
  status: z.literal('ready'),
  checks: z.object({
    migration: z.object({
      schemaVersion: z.number().int(),
      userVersion: z.number().int(),
      compatible: z.boolean(),
    }),
    runtime: z.object({
      journalMode: z.string(),
      foreignKeysEnabled: z.boolean(),
      busyTimeoutMs: z.number().int(),
      quickCheck: z.string(),
    }),
    backupRestore: z.object({
      snapshotVersion: z.number().int(),
      tableCount: z.number().int(),
    }),
  }),
});
const backupSchema = z.object({
  snapshot: z.object({
    version: z.number().int(),
    products: z.array(z.record(z.string(), z.unknown())),
    derived: z.object({
      customerStatements: z.array(z.record(z.string(), z.unknown())),
    }),
    entities: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  }),
});
const diagnosticsSchema = z.object({
  requests: z.object({
    requestCount: z.number().int(),
  }),
  database: z.object({
    backupRestore: z.object({
      snapshotVersion: z.number().int(),
      tableCount: z.number().int(),
    }),
  }),
});

function createTempDbPath(prefix: string): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, dbPath: join(dir, 'app.db') };
}

function parseStructuredLogLines(lines: string): Array<Record<string, unknown>> {
  return lines
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('operations and production readiness', () => {
  it('exposes health endpoints and diagnostics with structured logging', async () => {
    const target = createTempDbPath('ai-business-os-slice42-ops-');
    const seedApp = await buildApp({ dbPath: target.dbPath, authBypassForTesting: true });

    const adminRole = idSchema.parse(
      (
        await seedApp.inject({
          method: 'POST',
          url: '/roles',
          payload: { name: 'Slice42 Admin', canBeAssigned: true, canManageAssignments: true },
        })
      ).json(),
    );
    const readonlyRole = idSchema.parse(
      (
        await seedApp.inject({
          method: 'POST',
          url: '/roles',
          payload: { name: 'Slice42 Readonly', canBeAssigned: false, canManageAssignments: false },
        })
      ).json(),
    );
    const adminUser = idSchema.parse(
      (
        await seedApp.inject({
          method: 'POST',
          url: '/users',
          payload: { displayName: 'Slice42 Admin User', roleIds: [adminRole.id] },
        })
      ).json(),
    );
    const readonlyUser = idSchema.parse(
      (
        await seedApp.inject({
          method: 'POST',
          url: '/users',
          payload: { displayName: 'Slice42 Readonly User', roleIds: [readonlyRole.id] },
        })
      ).json(),
    );
    await seedApp.close();

    const logStream = new PassThrough();
    let logOutput = '';
    logStream.on('data', (chunk: Buffer) => {
      logOutput += chunk.toString();
    });
    const app = await buildApp({
      dbPath: target.dbPath,
      authBypassForTesting: false,
      enableStructuredLogging: true,
      loggerStream: logStream,
      nodeEnv: 'test',
      serviceName: 'ai-business-os',
    });

    const healthResponse = await app.inject({ method: 'GET', url: '/health' });
    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.json()).toEqual({ status: 'ok' });

    const liveResponse = await app.inject({ method: 'GET', url: '/health/live' });
    expect(liveResponse.statusCode).toBe(200);
    expect(liveResponse.json()).toEqual({ status: 'ok' });

    const readyResponse = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(readyResponse.statusCode).toBe(200);
    const readyPayload = healthReadySchema.parse(readyResponse.json());
    expect(readyPayload.checks.migration.compatible).toBe(true);
    expect(readyPayload.checks.runtime.quickCheck).toBe('ok');
    expect(readyPayload.checks.runtime.foreignKeysEnabled).toBe(true);

    const unauthorizedDiagnostics = await app.inject({ method: 'GET', url: '/health/diagnostics' });
    expect(unauthorizedDiagnostics.statusCode).toBe(401);

    const diagnosticsResponse = await app.inject({
      method: 'GET',
      url: '/health/diagnostics',
      headers: { 'x-actor-user-id': adminUser.id },
    });
    expect(diagnosticsResponse.statusCode).toBe(200);
    const diagnosticsPayload = diagnosticsSchema.parse(diagnosticsResponse.json());
    expect(diagnosticsPayload.requests.requestCount).toBeGreaterThanOrEqual(4);
    expect(diagnosticsPayload.database.backupRestore.snapshotVersion).toBe(1);
    expect(diagnosticsPayload.database.backupRestore.tableCount).toBeGreaterThan(10);

    const validationFailure = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { 'x-actor-user-id': adminUser.id },
      payload: {},
    });
    expect(validationFailure.statusCode).toBe(400);

    const authFailure = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { 'x-actor-user-id': readonlyUser.id },
      payload: { displayName: 'Should Fail' },
    });
    expect(authFailure.statusCode).toBe(403);

    const logs = parseStructuredLogLines(logOutput);
    expect(logs.some((log) => log.event === 'request.received')).toBe(true);
    expect(logs.some((log) => log.event === 'request.completed')).toBe(true);
    expect(logs.some((log) => log.event === 'validation.failure')).toBe(true);
    expect(logs.some((log) => log.event === 'authorization.failure')).toBe(true);

    await app.close();
    rmSync(target.dir, { recursive: true, force: true });
  });

  it('keeps backup and restore operationally healthy after restore', async () => {
    const source = createTempDbPath('ai-business-os-slice42-source-');
    const target = createTempDbPath('ai-business-os-slice42-target-');
    const sourceApp = await buildApp({ dbPath: source.dbPath, authBypassForTesting: true });

    expect(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/customers',
          payload: { displayName: 'Slice42 Backup Customer' },
        })
      ).statusCode,
    ).toBe(201);

    const backup = backupSchema.parse(
      (await sourceApp.inject({ method: 'GET', url: '/platform/backup' })).json(),
    ).snapshot;
    await sourceApp.close();

    const targetApp = await buildApp({ dbPath: target.dbPath, authBypassForTesting: true });
    const restoreResponse = await targetApp.inject({
      method: 'POST',
      url: '/platform/restore',
      payload: { snapshot: backup },
    });
    expect(restoreResponse.statusCode).toBe(204);

    const readyResponse = await targetApp.inject({ method: 'GET', url: '/health/ready' });
    expect(readyResponse.statusCode).toBe(200);
    const readyPayload = healthReadySchema.parse(readyResponse.json());
    expect(readyPayload.status).toBe('ready');

    const restoredBackup = backupSchema.parse(
      (await targetApp.inject({ method: 'GET', url: '/platform/backup' })).json(),
    ).snapshot;
    expect(restoredBackup).toEqual(backup);

    await targetApp.close();
    rmSync(source.dir, { recursive: true, force: true });
    rmSync(target.dir, { recursive: true, force: true });
  });
});
