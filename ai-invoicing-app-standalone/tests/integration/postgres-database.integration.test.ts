import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/db/database.js';
import { migrateToPostgres } from '../../src/migration/postgres-migration.js';
import { enterWorkspaceContext } from '../../src/auth/workspace-context.js';
import { resetPostgresTestDatabase } from '../helpers/postgres-reset.js';

const connectionString = process.env.TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres('PostgreSQL AppDatabase parity', () => {
  const reset = async (): Promise<void> => {
    await resetPostgresTestDatabase(connectionString!);
  };

  beforeEach(async () => {
    const { createPostgresDatabase } = await import('../../src/db/postgres-database.js');
    const bootstrap = await createPostgresDatabase(connectionString!, { maxConnections: 2 });
    await bootstrap.close();
    await reset();
  }, 30_000);

  afterEach(reset, 30_000);

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

      const creditNote = await db.createCreditNote({
        linkedInvoiceId: finalised[0]!.id,
        issueDate: '2026-07-11',
        reason: 'PostgreSQL adjustment',
        type: 'Partial',
        lineItems: [{ description: 'Adjustment', amount: 10 }],
      });
      const payment = await db.createCustomerPayment({
        customerId: first.id,
        paymentDate: '2026-07-12',
        paymentMethod: 'Bank Transfer',
        reference: 'PG-CUSTOMER-PAYMENT',
        amount: 25,
        allocations: [{ invoiceId: finalised[1]!.id, amount: 25 }],
      });

      const supplier = await db.createSupplier({ displayName: 'PostgreSQL Supplier' });
      const purchaseOrder = await db.createPurchaseOrderDraft({
        supplierId: supplier.id,
        issueDate: '2026-07-10',
        expectedDeliveryDate: '2026-07-20',
        supplierReference: 'PG-PO-REF',
        currency: 'AUD',
        lineItems: [{ description: 'Materials', quantity: 2, unitPrice: 40, gstApplicable: true }],
      });
      await db.approvePurchaseOrder(purchaseOrder.id);
      const billDraft = await db.createSupplierBillDraftFromPurchaseOrder(purchaseOrder.id);
      const bill = await db.finaliseSupplierBill(billDraft.id);
      const supplierPayment = await db.createSupplierPayment({
        supplierId: supplier.id,
        paymentDate: '2026-07-12',
        paymentMethod: 'Bank Transfer',
        reference: 'PG-SUPPLIER-PAYMENT',
        amount: 20,
        allocations: [{ supplierBillId: bill.id, amount: 20 }],
      });

      const role = await db.createRole({
        name: 'PostgreSQL Assignee',
        canBeAssigned: true,
        canManageAssignments: true,
      });
      const user = await db.createUser({
        displayName: 'PostgreSQL User',
        roleIds: [role.id],
      });
      const team = await db.createTeam({ name: 'PostgreSQL Team' });
      await db.addTeamMember(team.id, user.id, 'owner', user.id);
      const job = await db.createJob({
        title: 'PostgreSQL Job',
        customerId: first.id,
        status: 'Draft',
        priority: 'Normal',
        assignedUserId: user.id,
        assignedUserName: user.displayName,
        teamId: team.id,
      });
      await db.linkDocumentToJob(job.id, finalised[0]!.id);

      const timeline = await db.getTimelineForEntity('invoice', drafts[0]!.id);
      expect(timeline.map((event) => event.eventKey)).toEqual([
        'invoice.draft_created',
        'invoice.finalised',
      ]);
      expect((await db.search('PostgreSQL')).customers).toEqual([first]);
      expect((await db.getReportingReadModel()).accountsReceivable.invoices).toHaveLength(2);
      expect(await db.getCustomerPaymentById(payment.id)).toEqual(payment);
      expect(await db.getCreditNoteById(creditNote.id)).toEqual(creditNote);
      expect(await db.getSupplierPaymentById(supplierPayment.id)).toEqual(supplierPayment);
      expect(await db.listJobDocuments(job.id)).toHaveLength(1);
      const snapshot = await db.exportPlatformSnapshot();
      expect(snapshot.entities.invoices).toHaveLength(2);
      expect(snapshot.entities.purchase_orders).toHaveLength(1);
      expect(snapshot.entities.jobs).toHaveLength(1);
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

  it('selects PostgreSQL in buildApp when only databaseUrl is provided', async () => {
    const { buildApp } = await import('../../src/app.js');
    const app = await buildApp({
      databaseUrl: connectionString!,
      authBypassForTesting: true,
      nodeEnv: 'test',
    });
    try {
      expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
      const created = await app.inject({
        method: 'POST',
        url: '/customers',
        payload: { displayName: 'PostgreSQL Route Customer' },
      });
      expect(created.statusCode).toBe(201);
      const customer = created.json<{ id: string }>();
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/customers/${customer.id}`,
          })
        ).json(),
      ).toMatchObject({ id: customer.id, displayName: 'PostgreSQL Route Customer' });
    } finally {
      await app.close();
    }
  });

  it('isolates every customer record by the authenticated workspace schema', async () => {
    const { createPostgresDatabase } = await import('../../src/db/postgres-database.js');
    const db = await createPostgresDatabase(connectionString!, { maxConnections: 2 });
    const ownerA = '10000000-0000-4000-8000-00000000000a';
    const ownerB = '10000000-0000-4000-8000-00000000000b';
    let schemaA: string | undefined;
    let schemaB: string | undefined;
    try {
      const workspaceA = await db.provisionWorkspaceOwner({
        authUserId: ownerA,
        displayName: 'Owner A',
        email: 'owner-a@example.test',
        workspaceName: 'Workspace A',
      });
      const workspaceB = await db.provisionWorkspaceOwner({
        authUserId: ownerB,
        displayName: 'Owner B',
        email: 'owner-b@example.test',
        workspaceName: 'Workspace B',
      });
      schemaA = workspaceA.schemaName;
      schemaB = workspaceB.schemaName;

      enterWorkspaceContext({
        authUserId: ownerA,
        workspaceId: workspaceA.workspaceId,
        schemaName: workspaceA.schemaName,
      });
      const privateCustomer = await db.createCustomer({ displayName: 'Workspace A customer' });
      expect(await db.getCustomerById(privateCustomer.id)).toEqual(privateCustomer);

      enterWorkspaceContext({
        authUserId: ownerB,
        workspaceId: workspaceB.workspaceId,
        schemaName: workspaceB.schemaName,
      });
      expect(await db.listCustomers()).toEqual([]);
      expect(await db.getCustomerById(privateCustomer.id)).toBeNull();
    } finally {
      await db.close();
      const pool = new Pool({ connectionString, max: 1, allowExitOnIdle: true });
      try {
        if (schemaA) await pool.query(`DROP SCHEMA "${schemaA}" CASCADE`);
        if (schemaB) await pool.query(`DROP SCHEMA "${schemaB}" CASCADE`);
        await pool.query('DELETE FROM public.auth_workspaces WHERE display_name IN ($1, $2)', [
          'Workspace A',
          'Workspace B',
        ]);
      } finally {
        await pool.end();
      }
    }
  });

  it('migrates SQLite or JSON snapshots and refuses a populated target', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'postgres-migration-'));
    const sqlitePath = join(tempDir, 'source.db');
    const snapshotPath = join(tempDir, 'snapshot.json');
    const source = createDatabase(sqlitePath);
    try {
      const customer = source.createCustomer({ displayName: 'Migration Customer' });
      const invoice = source.createInvoiceDraft({
        customerId: customer.id,
        title: 'Migration Invoice',
        issueDate: '2026-07-10',
        dueDate: '2026-07-24',
        lineItems: [{ description: 'Migration', quantity: 1, unitPrice: 100, gstApplicable: true }],
      });
      source.finaliseInvoice(invoice.id);
      writeFileSync(snapshotPath, JSON.stringify(source.exportPlatformSnapshot()), 'utf8');
    } finally {
      source.close();
    }

    try {
      const sqliteResult = await migrateToPostgres({ sqlitePath }, connectionString);
      expect(sqliteResult.tableCounts.customers).toBe(1);
      expect(sqliteResult.tableCounts.invoices).toBe(1);
      expect(sqliteResult.timelineReferenceCount).toBeGreaterThan(0);

      await expect(migrateToPostgres({ snapshotPath }, connectionString)).rejects.toThrow(
        'PostgreSQL target is not empty; migration refused.',
      );

      await reset();
      const snapshotResult = await migrateToPostgres({ snapshotPath }, connectionString);
      expect(snapshotResult.tableCounts).toEqual(sqliteResult.tableCounts);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
