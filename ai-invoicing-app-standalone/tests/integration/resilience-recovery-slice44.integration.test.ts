import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });
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
const errorSchema = z.object({
  status: z.number().int(),
  code: z.string(),
  message: z.string(),
});
const readyDegradedSchema = z.object({
  status: z.literal('not_ready'),
  checks: z.unknown(),
});

function createTempDbPath(prefix: string): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, dbPath: join(dir, 'app.db') };
}

async function snapshot(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({ method: 'GET', url: '/platform/backup' });
  expect(response.statusCode).toBe(200);
  return backupSchema.parse(response.json()).snapshot;
}

async function withFailpoint<T>(failpoint: string, run: () => Promise<T>): Promise<T> {
  process.env.AI_BUSINESS_OS_FAILPOINT = failpoint;
  try {
    return await run();
  } finally {
    delete process.env.AI_BUSINESS_OS_FAILPOINT;
  }
}

describe('slice 44 resilience, recovery, and failure injection hardening', () => {
  it('rolls back critical writes under failpoints with no partial state or timeline emission', async () => {
    const { dir, dbPath } = createTempDbPath('ai-business-os-slice44-failpoints-');
    const app = await buildApp({ dbPath, authBypassForTesting: true });

    try {
      const customer = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/customers',
            payload: { displayName: 'Slice44 Customer', email: 'slice44-customer@example.test' },
          })
        ).json(),
      );
      const invoice = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/invoices',
            payload: {
              customerId: customer.id,
              title: 'Slice44 Invoice',
              issueDate: '2026-07-10',
              dueDate: '2026-07-30',
              lineItems: [{ description: 'Service', quantity: 1, unitPrice: 250, gstApplicable: true }],
            },
          })
        ).json(),
      );
      expect((await app.inject({ method: 'POST', url: `/invoices/${invoice.id}/finalise` })).statusCode).toBe(200);

      const failpointCases: Array<{
        failpoint: string;
        invoke: () => Promise<{ statusCode: number; payload: unknown }>;
      }> = [
        {
          failpoint: 'create_customer_after_insert',
          invoke: async () => {
            const response = await app.inject({
              method: 'POST',
              url: '/customers',
              payload: { displayName: 'Rollback Customer Probe' },
            });
            return { statusCode: response.statusCode, payload: response.json() };
          },
        },
        {
          failpoint: 'create_supplier_after_insert',
          invoke: async () => {
            const response = await app.inject({
              method: 'POST',
              url: '/suppliers',
              payload: { displayName: 'Rollback Supplier Probe' },
            });
            return { statusCode: response.statusCode, payload: response.json() };
          },
        },
        {
          failpoint: 'create_invoice_after_line_items',
          invoke: async () => {
            const response = await app.inject({
              method: 'POST',
              url: '/invoices',
              payload: {
                customerId: customer.id,
                title: 'Rollback Invoice Probe',
                issueDate: '2026-07-10',
                dueDate: '2026-07-30',
                lineItems: [{ description: 'Rollback', quantity: 1, unitPrice: 111, gstApplicable: true }],
              },
            });
            return { statusCode: response.statusCode, payload: response.json() };
          },
        },
        {
          failpoint: 'create_credit_note_after_insert',
          invoke: async () => {
            const response = await app.inject({
              method: 'POST',
              url: '/credit-notes',
              payload: {
                linkedInvoiceId: invoice.id,
                customerId: customer.id,
                issueDate: '2026-07-11',
                reason: 'Rollback Credit Probe',
                type: 'Partial',
                totalCredit: 20,
                lineItems: [{ description: 'Adjustment', amount: 20 }],
              },
            });
            return { statusCode: response.statusCode, payload: response.json() };
          },
        },
        {
          failpoint: 'create_customer_payment_after_allocations',
          invoke: async () => {
            const response = await app.inject({
              method: 'POST',
              url: '/payments',
              payload: {
                customerId: customer.id,
                paymentDate: '2026-07-12',
                paymentMethod: 'Bank Transfer',
                reference: 'SL44-ROLLBACK-PAY',
                amount: 30,
                allocations: [{ invoiceId: invoice.id, amount: 30 }],
              },
            });
            return { statusCode: response.statusCode, payload: response.json() };
          },
        },
      ];

      for (const testCase of failpointCases) {
        const before = await snapshot(app);
        const result = await withFailpoint(testCase.failpoint, testCase.invoke);
        expect(result.statusCode).toBe(500);
        expect(errorSchema.parse(result.payload).code).toBe('INTERNAL_SERVER_ERROR');
        const after = await snapshot(app);
        expect(after).toEqual(before);
      }
    } finally {
      delete process.env.AI_BUSINESS_OS_FAILPOINT;
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles lock/contention failures deterministically and recovers after lock release', async () => {
    const { dir, dbPath } = createTempDbPath('ai-business-os-slice44-lock-');
    const app = await buildApp({ dbPath, authBypassForTesting: true, dbBusyTimeoutMs: 1000 });
    const lockDb = new Database(dbPath);
    try {
      const baseline = await snapshot(app);

      lockDb.pragma('journal_mode = WAL');
      lockDb.exec('BEGIN EXCLUSIVE TRANSACTION;');

      const lockedResponse = await app.inject({
        method: 'POST',
        url: '/customers',
        payload: { displayName: 'Slice44 Locked Customer' },
      });
      expect(lockedResponse.statusCode).toBe(500);
      expect(errorSchema.parse(lockedResponse.json()).code).toBe('INTERNAL_SERVER_ERROR');

      const duringLockSnapshot = await snapshot(app);
      expect(duringLockSnapshot).toEqual(baseline);

      lockDb.exec('ROLLBACK;');

      const recoveredCreate = await app.inject({
        method: 'POST',
        url: '/customers',
        payload: { displayName: 'Slice44 Post-Lock Recovery Customer' },
      });
      expect(recoveredCreate.statusCode).toBe(201);
      const recoveredCustomer = idSchema.parse(recoveredCreate.json());
      expect(recoveredCustomer.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    } finally {
      try {
        lockDb.exec('ROLLBACK;');
      } catch {
        // no-op: rollback can fail if already released
      }
      lockDb.close();
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unsupported schema versions at startup and reports readiness degradation contract', async () => {
    const { dir, dbPath } = createTempDbPath('ai-business-os-slice44-schema-');
    const seed = await buildApp({ dbPath, authBypassForTesting: true });
    await seed.close();

    const mutate = new Database(dbPath);
    mutate.pragma('user_version = 999');
    mutate.close();

    await expect(buildApp({ dbPath, authBypassForTesting: true })).rejects.toThrow('DB_SCHEMA_VERSION_UNSUPPORTED');

    const healthyDb = createTempDbPath('ai-business-os-slice44-ready-');
    const app = await buildApp({ dbPath: healthyDb.dbPath, authBypassForTesting: true });
    try {
      const originalDiagnostics = app.db.getOperationalDiagnostics.bind(app.db);
      app.db.getOperationalDiagnostics = () => ({
        migration: { schemaVersion: 42, userVersion: 41, compatible: false },
        runtime: { journalMode: 'wal', foreignKeysEnabled: false, busyTimeoutMs: 5000, quickCheck: 'not ok' },
        backupRestore: { snapshotVersion: 1, tableCount: 34 },
      });

      const degraded = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(degraded.statusCode).toBe(503);
      const payload = readyDegradedSchema.parse(degraded.json());
      expect(payload.status).toBe('not_ready');
      expect(payload.checks).toBeDefined();

      app.db.getOperationalDiagnostics = originalDiagnostics;
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
      rmSync(healthyDb.dir, { recursive: true, force: true });
    }
  });

  it('handles interrupted backup/restore safely and recovers from a valid snapshot', async () => {
    const source = createTempDbPath('ai-business-os-slice44-backup-source-');
    const target = createTempDbPath('ai-business-os-slice44-backup-target-');
    const sourceApp = await buildApp({ dbPath: source.dbPath, authBypassForTesting: true });

    try {
      const customer = idSchema.parse(
        (
          await sourceApp.inject({
            method: 'POST',
            url: '/customers',
            payload: { displayName: 'Slice44 Recovery Customer' },
          })
        ).json(),
      );
      const invoice = idSchema.parse(
        (
          await sourceApp.inject({
            method: 'POST',
            url: '/invoices',
            payload: {
              customerId: customer.id,
              title: 'Slice44 Recovery Invoice',
              issueDate: '2026-07-10',
              dueDate: '2026-07-25',
              lineItems: [{ description: 'Recovery', quantity: 1, unitPrice: 80, gstApplicable: true }],
            },
          })
        ).json(),
      );
      expect((await sourceApp.inject({ method: 'POST', url: `/invoices/${invoice.id}/finalise` })).statusCode).toBe(200);

      const originalExport = sourceApp.db.exportPlatformSnapshot.bind(sourceApp.db);
      sourceApp.db.exportPlatformSnapshot = () => {
        throw new Error('INTERRUPTED_BACKUP');
      };
      const interruptedBackup = await sourceApp.inject({ method: 'GET', url: '/platform/backup' });
      expect(interruptedBackup.statusCode).toBe(500);
      expect(errorSchema.parse(interruptedBackup.json()).code).toBe('INTERNAL_SERVER_ERROR');
      sourceApp.db.exportPlatformSnapshot = originalExport;

      const validSnapshot = backupSchema.parse((await sourceApp.inject({ method: 'GET', url: '/platform/backup' })).json())
        .snapshot;

      const targetApp = await buildApp({ dbPath: target.dbPath, authBypassForTesting: true });
      try {
        const originalRestore = targetApp.db.restorePlatformSnapshot.bind(targetApp.db);
        targetApp.db.restorePlatformSnapshot = () => {
          throw new Error('INTERRUPTED_RESTORE');
        };

        const interruptedRestore = await targetApp.inject({
          method: 'POST',
          url: '/platform/restore',
          payload: { snapshot: validSnapshot },
        });
        expect(interruptedRestore.statusCode).toBe(500);
        expect(errorSchema.parse(interruptedRestore.json()).code).toBe('INTERNAL_SERVER_ERROR');

        const emptyAfterInterrupted = backupSchema.parse(
          (await targetApp.inject({ method: 'GET', url: '/platform/backup' })).json(),
        ).snapshot;
        expect(emptyAfterInterrupted.entities.customers ?? []).toHaveLength(0);
        expect(emptyAfterInterrupted.entities.invoices ?? []).toHaveLength(0);
        expect(emptyAfterInterrupted.entities.timeline_events ?? []).toHaveLength(0);

        targetApp.db.restorePlatformSnapshot = originalRestore;

        const malformedRestore = await targetApp.inject({
          method: 'POST',
          url: '/platform/restore',
          payload: { snapshot: { nope: true } },
        });
        expect(malformedRestore.statusCode).toBe(400);
        expect(errorSchema.parse(malformedRestore.json()).code).toBe('BACKUP_RESTORE_MALFORMED_PAYLOAD');

        const incompatibleSnapshot = structuredClone(validSnapshot);
        incompatibleSnapshot.version = validSnapshot.version + 99;
        const incompatibleRestore = await targetApp.inject({
          method: 'POST',
          url: '/platform/restore',
          payload: { snapshot: incompatibleSnapshot },
        });
        expect(incompatibleRestore.statusCode).toBe(409);
        expect(errorSchema.parse(incompatibleRestore.json()).code).toBe('BACKUP_RESTORE_INCOMPATIBLE_VERSION');

        const restoreResponse = await targetApp.inject({
          method: 'POST',
          url: '/platform/restore',
          payload: { snapshot: validSnapshot },
        });
        expect(restoreResponse.statusCode).toBe(204);

        const restoredSnapshot = backupSchema.parse(
          (await targetApp.inject({ method: 'GET', url: '/platform/backup' })).json(),
        ).snapshot;
        expect(restoredSnapshot).toEqual(validSnapshot);
      } finally {
        await targetApp.close();
      }
    } finally {
      await sourceApp.close();
      rmSync(source.dir, { recursive: true, force: true });
      rmSync(target.dir, { recursive: true, force: true });
    }
  });
});
