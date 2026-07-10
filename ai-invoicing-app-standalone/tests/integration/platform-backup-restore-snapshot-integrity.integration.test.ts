import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

const backupResponseSchema = z.object({
  snapshot: z.object({
    version: z.number().int(),
    products: z.array(z.record(z.string(), z.unknown())),
    entities: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
    derived: z.object({
      customerStatements: z.array(
        z.object({
          customerId: z.string().uuid(),
          statement: z.unknown(),
        }),
      ),
    }),
  }),
});

const errorResponseSchema = z.object({
  code: z.string().optional(),
});

function createTempDbPath(prefix: string): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, dbPath: join(dir, 'app.db') };
}

function tableCounts(snapshot: z.infer<typeof backupResponseSchema>['snapshot']): Record<string, number> {
  return Object.fromEntries(Object.entries(snapshot.entities).map(([table, rows]) => [table, rows.length]));
}

function entityRows(
  snapshot: z.infer<typeof backupResponseSchema>['snapshot'],
  table: string,
): Array<Record<string, unknown>> {
  const rows = snapshot.entities[table];
  if (!rows) {
    throw new Error(`Expected snapshot.entities.${table} to exist`);
  }
  return rows;
}

describe('platform backup, restore, and snapshot integrity', () => {
  it('backs up and restores full platform state deterministically', async () => {
    const source = createTempDbPath('ai-business-os-slice36-source-');
    const target = createTempDbPath('ai-business-os-slice36-target-');

    const sourceApp = await buildApp({ dbPath: source.dbPath });

    const businessProfileResponse = await sourceApp.inject({
      method: 'POST',
      url: '/business-profile',
      payload: {
        companyName: 'Slice36 Co',
        legalName: 'Slice36 Co Pty Ltd',
        abnTaxId: '12345678901',
        address: '1 Deterministic Street',
        email: 'ops@slice36.test',
        phone: '+61-555-1000',
        primaryColor: '#111111',
        secondaryColor: '#eeeeee',
      },
    });
    expect(businessProfileResponse.statusCode).toBe(200);

    expect(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/preferences/branding',
          payload: { value: { template: 'slice36', locale: 'en-AU' } },
        })
      ).statusCode,
    ).toBe(201);

    const customer = idSchema.parse(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/customers',
          payload: {
            displayName: 'Slice36 Customer',
            email: 'customer@slice36.test',
          },
        })
      ).json(),
    );

    const supplier = idSchema.parse(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/suppliers',
          payload: {
            displayName: 'Slice36 Supplier',
            email: 'supplier@slice36.test',
          },
        })
      ).json(),
    );

    const roleOwner = idSchema.parse(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/roles',
          payload: {
            name: 'Slice36 Owner',
            canBeAssigned: true,
            canManageAssignments: true,
          },
        })
      ).json(),
    );
    const roleTechnician = idSchema.parse(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/roles',
          payload: {
            name: 'Slice36 Technician',
            canBeAssigned: true,
            canManageAssignments: false,
          },
        })
      ).json(),
    );

    const ownerUser = idSchema.parse(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/users',
          payload: {
            displayName: 'Slice36 Owner User',
            email: 'owner@slice36.test',
            roleIds: [roleOwner.id],
          },
        })
      ).json(),
    );
    const workerUser = idSchema.parse(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/users',
          payload: {
            displayName: 'Slice36 Worker User',
            email: 'worker@slice36.test',
            roleIds: [roleTechnician.id],
          },
        })
      ).json(),
    );

    const team = idSchema.parse(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/teams',
          payload: { name: 'Slice36 Team' },
        })
      ).json(),
    );

    expect(
      (
        await sourceApp.inject({
          method: 'POST',
          url: `/teams/${team.id}/members`,
          headers: { 'x-actor-user-id': ownerUser.id },
          payload: { userId: ownerUser.id, role: 'owner' },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await sourceApp.inject({
          method: 'POST',
          url: `/teams/${team.id}/members`,
          headers: { 'x-actor-user-id': ownerUser.id },
          payload: { userId: workerUser.id, role: 'member' },
        })
      ).statusCode,
    ).toBe(201);

    const invoice = idSchema.parse(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/invoices',
          payload: {
            customerId: customer.id,
            title: 'Slice36 Final Invoice',
            issueDate: '2026-07-08',
            dueDate: '2026-07-22',
            lineItems: [{ description: 'Implementation', quantity: 2, unitPrice: 150, gstApplicable: true }],
          },
        })
      ).json(),
    );
    const finalisedInvoice = await sourceApp.inject({
      method: 'POST',
      url: `/invoices/${invoice.id}/finalise`,
    });
    expect(finalisedInvoice.statusCode).toBe(200);

    expect(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/credit-notes',
          payload: {
            linkedInvoiceId: invoice.id,
            customerId: customer.id,
            issueDate: '2026-07-09',
            reason: 'Slice36 adjustment',
            type: 'Partial',
            totalCredit: 50,
            lineItems: [{ description: 'Discount', amount: 50 }],
          },
        })
      ).statusCode,
    ).toBe(201);

    expect(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/payments',
          payload: {
            customerId: customer.id,
            paymentDate: '2026-07-10',
            paymentMethod: 'Bank Transfer',
            reference: 'SLICE36-PAY-1',
            amount: 250,
            allocations: [{ invoiceId: invoice.id, amount: 250 }],
          },
        })
      ).statusCode,
    ).toBe(201);

    const purchaseOrder = idSchema.parse(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/purchase-orders',
          payload: {
            supplierId: supplier.id,
            issueDate: '2026-07-08',
            expectedDeliveryDate: '2026-07-15',
            supplierReference: 'SLICE36-PO-REF',
            currency: 'AUD',
            notes: 'Slice36 procurement',
            lineItems: [{ description: 'Materials', quantity: 3, unitPrice: 120, gstApplicable: true }],
          },
        })
      ).json(),
    );
    expect(
      (
        await sourceApp.inject({
          method: 'POST',
          url: `/purchase-orders/${purchaseOrder.id}/approve`,
        })
      ).statusCode,
    ).toBe(200);

    const supplierBill = idSchema.parse(
      (
        await sourceApp.inject({
          method: 'POST',
          url: `/purchase-orders/${purchaseOrder.id}/create-supplier-bill`,
          payload: {},
        })
      ).json(),
    );
    expect(
      (
        await sourceApp.inject({
          method: 'POST',
          url: `/supplier-bills/${supplierBill.id}/finalise`,
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/supplier-payments',
          payload: {
            supplierId: supplier.id,
            paymentDate: '2026-07-12',
            paymentMethod: 'Bank Transfer',
            reference: 'SLICE36-SP-1',
            amount: 396,
            allocations: [{ supplierBillId: supplierBill.id, amount: 396 }],
          },
        })
      ).statusCode,
    ).toBe(201);

    const job = idSchema.parse(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/jobs',
          payload: {
            title: 'Slice36 Job',
            customerId: customer.id,
            status: 'Scheduled',
            priority: 'High',
            scheduledStartAt: '2026-07-13T10:00:00.000Z',
            scheduledEndAt: '2026-07-13T12:00:00.000Z',
            assignedUserId: workerUser.id,
            teamId: team.id,
          },
        })
      ).json(),
    );
    expect(
      (
        await sourceApp.inject({
          method: 'POST',
          url: `/jobs/${job.id}/documents`,
          payload: { documentId: invoice.id },
        })
      ).statusCode,
    ).toBe(201);

    const reportBefore: unknown = (
      await sourceApp.inject({
        method: 'GET',
        url: '/reports/read-model?from=2026-07-01&to=2026-07-31&limit=200&offset=0',
      })
    ).json();
    const statementBefore: unknown = (
      await sourceApp.inject({
        method: 'GET',
        url: `/statements/customers/${customer.id}?from=2026-07-01&to=2026-07-31`,
      })
    ).json();
    const searchBefore: unknown = (
      await sourceApp.inject({
        method: 'GET',
        url: '/search?q=slice36&limit=200&offset=0',
      })
    ).json();

    const firstBackupResponse = await sourceApp.inject({
      method: 'GET',
      url: '/platform/backup',
    });
    expect(firstBackupResponse.statusCode).toBe(200);
    const firstBackup = backupResponseSchema.parse(firstBackupResponse.json()).snapshot;
    expect(firstBackup.products).toEqual([]);

    const secondBackupResponse = await sourceApp.inject({
      method: 'GET',
      url: '/platform/backup',
    });
    expect(secondBackupResponse.statusCode).toBe(200);
    const secondBackup = backupResponseSchema.parse(secondBackupResponse.json()).snapshot;
    expect(secondBackup).toEqual(firstBackup);

    const sourceCounts = tableCounts(firstBackup);
    const sourceInvoiceNumbers = entityRows(firstBackup, 'invoices').map((row) => row.invoice_number);
    const sourceCreditNoteNumbers = entityRows(firstBackup, 'credit_notes').map((row) => row.credit_note_number);
    const sourcePaymentNumbers = entityRows(firstBackup, 'customer_payments').map((row) => row.payment_number);
    const sourceSupplierBillNumbers = entityRows(firstBackup, 'supplier_bills').map((row) => row.bill_number);
    const sourceSupplierPaymentNumbers = entityRows(firstBackup, 'supplier_payments').map(
      (row) => row.payment_number,
    );
    const sourcePurchaseOrderNumbers = entityRows(firstBackup, 'purchase_orders').map(
      (row) => row.purchase_order_number,
    );

    const sourceTimelineCount = entityRows(firstBackup, 'timeline_events').length;
    const sourcePoBillLinks = entityRows(firstBackup, 'supplier_bills').map((row) => ({
      id: row.id,
      sourcePurchaseOrderId: row.source_purchase_order_id,
    }));
    const sourcePaymentAllocations = entityRows(firstBackup, 'payment_allocations').map((row) => ({
      paymentId: row.payment_id,
      invoiceId: row.invoice_id,
      amount: row.amount,
    }));
    const sourceSupplierPaymentAllocations = entityRows(firstBackup, 'supplier_payment_allocations').map((row) => ({
      supplierPaymentId: row.supplier_payment_id,
      supplierBillId: row.supplier_bill_id,
      amount: row.amount,
    }));

    const targetApp = await buildApp({ dbPath: target.dbPath });
    const restoreResponse = await targetApp.inject({
      method: 'POST',
      url: '/platform/restore',
      payload: { snapshot: firstBackup },
    });
    expect(restoreResponse.statusCode).toBe(204);

    const restoredBackupResponse = await targetApp.inject({
      method: 'GET',
      url: '/platform/backup',
    });
    expect(restoredBackupResponse.statusCode).toBe(200);
    const restoredBackup = backupResponseSchema.parse(restoredBackupResponse.json()).snapshot;
    expect(restoredBackup).toEqual(firstBackup);

    expect(tableCounts(restoredBackup)).toEqual(sourceCounts);
    expect(entityRows(restoredBackup, 'invoices').map((row) => row.invoice_number)).toEqual(sourceInvoiceNumbers);
    expect(entityRows(restoredBackup, 'credit_notes').map((row) => row.credit_note_number)).toEqual(
      sourceCreditNoteNumbers,
    );
    expect(entityRows(restoredBackup, 'customer_payments').map((row) => row.payment_number)).toEqual(
      sourcePaymentNumbers,
    );
    expect(entityRows(restoredBackup, 'supplier_bills').map((row) => row.bill_number)).toEqual(
      sourceSupplierBillNumbers,
    );
    expect(entityRows(restoredBackup, 'supplier_payments').map((row) => row.payment_number)).toEqual(
      sourceSupplierPaymentNumbers,
    );
    expect(entityRows(restoredBackup, 'purchase_orders').map((row) => row.purchase_order_number)).toEqual(
      sourcePurchaseOrderNumbers,
    );
    expect(entityRows(restoredBackup, 'timeline_events').length).toBe(sourceTimelineCount);
    expect(
      entityRows(restoredBackup, 'supplier_bills').map((row) => ({
        id: row.id,
        sourcePurchaseOrderId: row.source_purchase_order_id,
      })),
    ).toEqual(sourcePoBillLinks);
    expect(
      entityRows(restoredBackup, 'payment_allocations').map((row) => ({
        paymentId: row.payment_id,
        invoiceId: row.invoice_id,
        amount: row.amount,
      })),
    ).toEqual(sourcePaymentAllocations);
    expect(
      entityRows(restoredBackup, 'supplier_payment_allocations').map((row) => ({
        supplierPaymentId: row.supplier_payment_id,
        supplierBillId: row.supplier_bill_id,
        amount: row.amount,
      })),
    ).toEqual(sourceSupplierPaymentAllocations);

    const reportAfter: unknown = (
      await targetApp.inject({
        method: 'GET',
        url: '/reports/read-model?from=2026-07-01&to=2026-07-31&limit=200&offset=0',
      })
    ).json();
    const statementAfter: unknown = (
      await targetApp.inject({
        method: 'GET',
        url: `/statements/customers/${customer.id}?from=2026-07-01&to=2026-07-31`,
      })
    ).json();
    const searchAfter: unknown = (
      await targetApp.inject({
        method: 'GET',
        url: '/search?q=slice36&limit=200&offset=0',
      })
    ).json();

    expect(reportAfter).toEqual(reportBefore);
    expect(statementAfter).toEqual(statementBefore);
    expect(searchAfter).toEqual(searchBefore);

    expect(
      (
        await sourceApp.inject({
          method: 'GET',
          url: `/timeline/invoice/${invoice.id}?limit=100&offset=0`,
        })
      ).json(),
    ).toEqual(
      (
        await targetApp.inject({
          method: 'GET',
          url: `/timeline/invoice/${invoice.id}?limit=100&offset=0`,
        })
      ).json(),
    );

    await sourceApp.close();
    await targetApp.close();
    rmSync(source.dir, { recursive: true, force: true });
    rmSync(target.dir, { recursive: true, force: true });
  });

  it('rejects malformed, incomplete, incompatible, and duplicate restore payloads deterministically', async () => {
    const source = createTempDbPath('ai-business-os-slice36-validate-source-');
    const target = createTempDbPath('ai-business-os-slice36-validate-target-');

    const sourceApp = await buildApp({ dbPath: source.dbPath });
    expect(
      (
        await sourceApp.inject({
          method: 'POST',
          url: '/customers',
          payload: { displayName: 'Slice36 Restore Validation Customer' },
        })
      ).statusCode,
    ).toBe(201);
    const validSnapshot = backupResponseSchema.parse(
      (await sourceApp.inject({ method: 'GET', url: '/platform/backup' })).json(),
    ).snapshot;
    await sourceApp.close();

    const targetApp = await buildApp({ dbPath: target.dbPath });

    const malformedResponse = await targetApp.inject({
      method: 'POST',
      url: '/platform/restore',
      payload: { snapshot: { nope: true } },
    });
    expect(malformedResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(malformedResponse.json()).code).toBe('BACKUP_RESTORE_MALFORMED_PAYLOAD');

    const incompleteSnapshot = structuredClone(validSnapshot);
    delete incompleteSnapshot.entities.customers;
    const incompleteResponse = await targetApp.inject({
      method: 'POST',
      url: '/platform/restore',
      payload: { snapshot: incompleteSnapshot },
    });
    expect(incompleteResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(incompleteResponse.json()).code).toBe('BACKUP_RESTORE_INCOMPLETE_PAYLOAD');

    const incompatibleSnapshot = structuredClone(validSnapshot);
    incompatibleSnapshot.version = validSnapshot.version + 1;
    const incompatibleResponse = await targetApp.inject({
      method: 'POST',
      url: '/platform/restore',
      payload: { snapshot: incompatibleSnapshot },
    });
    expect(incompatibleResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(incompatibleResponse.json()).code).toBe('BACKUP_RESTORE_INCOMPATIBLE_VERSION');

    const firstRestoreResponse = await targetApp.inject({
      method: 'POST',
      url: '/platform/restore',
      payload: { snapshot: validSnapshot },
    });
    expect(firstRestoreResponse.statusCode).toBe(204);

    const duplicateRestoreResponse = await targetApp.inject({
      method: 'POST',
      url: '/platform/restore',
      payload: { snapshot: validSnapshot },
    });
    expect(duplicateRestoreResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(duplicateRestoreResponse.json()).code).toBe('BACKUP_RESTORE_TARGET_NOT_EMPTY');

    await targetApp.close();
    rmSync(source.dir, { recursive: true, force: true });
    rmSync(target.dir, { recursive: true, force: true });
  });
});
