import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { enterWorkspaceContext } from '../../src/auth/workspace-context.js';
import { resetPostgresTestDatabase } from '../helpers/postgres-reset.js';

const connectionString = process.env.TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres('invoice workspace schema migration (product_id)', () => {
  const reset = async (): Promise<void> => {
    await resetPostgresTestDatabase(connectionString!);
  };

  beforeEach(async () => {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: connectionString!, max: 1 });
    try {
      // Keep metadata compatible with this branch's DATABASE_SCHEMA_VERSION.
      await pool.query(
        `UPDATE app_database_metadata SET schema_version = LEAST(schema_version, 45) WHERE singleton_id = 1`,
      );
    } catch {
      /* metadata table may not exist yet */
    } finally {
      await pool.end();
    }
    const { createPostgresDatabase } = await import('../../src/db/postgres-database.js');
    const bootstrap = await createPostgresDatabase(connectionString!, { maxConnections: 2 });
    await bootstrap.close();
    await reset();
  }, 60_000);

  afterEach(reset, 60_000);

  it('re-applies missing invoice_line_items.product_id on existing workspace schemas at boot', async () => {
    const { Pool } = await import('pg');
    const { createPostgresDatabase } = await import('../../src/db/postgres-database.js');

    const db = await createPostgresDatabase(connectionString!, { maxConnections: 3 });
    const ownerId = '30000000-0000-4000-8000-0000000000aa';
    let schemaName = '';
    try {
      const workspace = await db.provisionWorkspaceOwner({
        authUserId: ownerId,
        displayName: 'Schema Owner',
        email: 'schema-owner@example.test',
        workspaceName: 'Schema Workspace',
      });
      schemaName = workspace.schemaName;
      enterWorkspaceContext({
        authUserId: ownerId,
        workspaceId: workspace.workspaceId,
        schemaName: workspace.schemaName,
      });

      const customer = await db.createCustomer({
        displayName: 'Schema Customer',
        email: 'schema-customer@example.test',
      });

      // Simulate a pre-v45 workspace that is missing product_id.
      const pool = new Pool({ connectionString: connectionString! });
      try {
        await pool.query(`ALTER TABLE "${schemaName}".invoice_line_items DROP COLUMN IF EXISTS product_id`);
        const before = await pool.query(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = 'invoice_line_items' AND column_name = 'product_id'`,
          [schemaName],
        );
        expect(before.rows).toHaveLength(0);
      } finally {
        await pool.end();
      }
      await db.close();

      // Boot again — migration must restore the column on the existing workspace schema.
      const migrated = await createPostgresDatabase(connectionString!, { maxConnections: 3 });
      try {
        enterWorkspaceContext({
          authUserId: ownerId,
          workspaceId: workspace.workspaceId,
          schemaName: workspace.schemaName,
        });

        const verifyPool = new Pool({ connectionString: connectionString! });
        try {
          const after = await verifyPool.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_schema = $1 AND table_name = 'invoice_line_items' AND column_name = 'product_id'`,
            [schemaName],
          );
          expect(after.rows).toHaveLength(1);
        } finally {
          await verifyPool.end();
        }

        const invoice = await migrated.createInvoiceDraft({
          customerId: customer.id,
          title: 'Migrated workspace invoice',
          issueDate: '2026-07-20',
          dueDate: '2026-08-03',
          notes: 'Notes',
          paymentTerms: 'Net 14',
          lineItems: [
            {
              description: 'Labour',
              quantity: 1,
              unitPrice: 120,
              gstApplicable: true,
            },
          ],
        });
        const loaded = await migrated.getInvoiceById(invoice.id);

        expect(invoice.id).toBeTruthy();
        expect(invoice.title).toBe('Migrated workspace invoice');
        expect(loaded?.lineItems).toHaveLength(1);
        expect(loaded?.lineItems[0]?.description).toBe('Labour');
      } finally {
        await migrated.close();
      }
    } finally {
      // no-op; reset in afterEach
    }
  }, 60_000);
});
