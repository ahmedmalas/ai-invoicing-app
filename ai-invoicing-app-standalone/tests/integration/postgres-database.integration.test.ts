import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PLATFORM_SNAPSHOT_TABLES } from '../../src/db/database.js';

const connectionString = process.env.TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres('PostgreSQL AppDatabase parity', () => {
  const reset = async (): Promise<void> => {
    const pool = new Pool({ connectionString, max: 1, allowExitOnIdle: true });
    try {
      const tables = [...PLATFORM_SNAPSHOT_TABLES]
        .reverse()
        .map((table) => `"${table}"`)
        .join(', ');
      await pool.query(`TRUNCATE TABLE ${tables} CASCADE`);
    } finally {
      await pool.end();
    }
  };

  beforeEach(async () => {
    const { createPostgresDatabase } = await import('../../src/db/postgres-database.js');
    const bootstrap = await createPostgresDatabase(connectionString!, { maxConnections: 2 });
    await bootstrap.close();
    await reset();
  });

  afterEach(reset);

  it('preserves idempotency, concurrent numbering, timeline, search, reporting, and diagnostics', async () => {
    const { createPostgresDatabase } = await import('../../src/db/postgres-database.js');
    const db = await createPostgresDatabase(connectionString!, { maxConnections: 3 });
    try {
      const input = { displayName: 'PostgreSQL Customer', email: 'postgres@example.test' };
      const first = await db.createCustomer(input);
      const replay = await db.createCustomer(input);
      expect(replay).toEqual(first);

      const drafts = await Promise.all(
        ['Migration A', 'Migration B'].map((title) =>
          Promise.resolve(
            db.createInvoiceDraft({
              customerId: first.id,
              title,
              issueDate: '2026-07-10',
              dueDate: '2026-07-24',
              lineItems: [
                { description: 'Database work', quantity: 1, unitPrice: 100, gstApplicable: true },
              ],
            }),
          ),
        ),
      );
      const finalised = await Promise.all(
        drafts.map((draft) => Promise.resolve(db.finaliseInvoice(draft.id))),
      );
      expect(new Set(finalised.map((invoice) => invoice.invoiceNumber)).size).toBe(2);
      expect(finalised.every((invoice) => invoice.status === 'Finalised')).toBe(true);

      const timeline = await db.getTimelineForEntity('invoice', drafts[0]!.id);
      expect(timeline.map((event) => event.eventKey)).toEqual([
        'invoice.draft_created',
        'invoice.finalised',
      ]);
      expect((await db.search('PostgreSQL')).customers).toEqual([first]);
      expect((await db.getReportingReadModel()).accountsReceivable.invoices).toHaveLength(2);
      expect((await db.exportPlatformSnapshot()).entities.invoices).toHaveLength(2);
      expect(await db.getOperationalDiagnostics()).toMatchObject({
        migration: { compatible: true },
        runtime: { journalMode: 'postgresql', foreignKeysEnabled: true, quickCheck: 'ok' },
      });
    } finally {
      await db.close();
    }
  });

  it('applies schema repeatedly and restores an exported snapshot', async () => {
    const { createPostgresDatabase } = await import('../../src/db/postgres-database.js');
    const source = await createPostgresDatabase(connectionString!, { maxConnections: 2 });
    const customer = await source.createCustomer({ displayName: 'Snapshot Customer' });
    const snapshot = await source.exportPlatformSnapshot();
    await source.close();

    await reset();
    const target = await createPostgresDatabase(connectionString!, { maxConnections: 2 });
    try {
      await target.restorePlatformSnapshot(snapshot);
      expect(await target.getCustomerById(customer.id)).toEqual(customer);
      await expect(target.restorePlatformSnapshot(snapshot)).rejects.toThrow(
        'BACKUP_RESTORE_TARGET_NOT_EMPTY',
      );
    } finally {
      await target.close();
    }
  });
});
