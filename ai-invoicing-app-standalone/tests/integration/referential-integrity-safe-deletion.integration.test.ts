import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

const backupSchema = z.object({
  snapshot: z.object({
    entities: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  }),
});

const errorSchema = z.object({
  status: z.number().int(),
  code: z.string().min(1),
  message: z.string().min(1),
});

function createTempDbPath(prefix: string): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, dbPath: join(dir, 'app.db') };
}

function entityRows(
  snapshot: z.infer<typeof backupSchema>['snapshot'],
  table: string,
): Array<Record<string, unknown>> {
  return snapshot.entities[table] ?? [];
}

describe('slice 38 referential integrity and safe deletion guardrails', () => {
  it('rejects referenced deletes/mutations deterministically and keeps timeline/reporting/search stable', async () => {
    const { dir, dbPath } = createTempDbPath('ai-business-os-slice38-');
    const app = await buildApp({ dbPath });
    const sql = new Database(dbPath);

    try {
      const customer = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/customers',
            payload: { displayName: 'Slice38 Customer', email: 'slice38.customer@example.test' },
          })
        ).json(),
      );
      const supplier = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/suppliers',
            payload: { displayName: 'Slice38 Supplier', email: 'slice38.supplier@example.test' },
          })
        ).json(),
      );

      const role = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/roles',
            payload: { name: 'Slice38 Agent', canBeAssigned: true, canManageAssignments: false },
          })
        ).json(),
      );
      const user = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/users',
            payload: {
              displayName: 'Slice38 User',
              email: 'slice38.user@example.test',
              roleIds: [role.id],
            },
          })
        ).json(),
      );

      const team = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/teams',
            payload: { name: 'Slice38 Team' },
          })
        ).json(),
      );
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/teams/${team.id}/members`,
            payload: { userId: user.id, role: 'owner' },
          })
        ).statusCode,
      ).toBe(201);

      const job = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/jobs',
            payload: {
              customerId: customer.id,
              title: 'Slice38 Job',
              description: 'Guardrail job',
              status: 'Scheduled',
              priority: 'Normal',
              assignedUserId: user.id,
            },
          })
        ).json(),
      );
      expect(job.id).toBeDefined();

      const invoice = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/invoices',
            payload: {
              customerId: customer.id,
              title: 'Slice38 Invoice',
              issueDate: '2026-07-08',
              dueDate: '2026-07-20',
              lineItems: [{ description: 'Service', quantity: 1, unitPrice: 200, gstApplicable: true }],
            },
          })
        ).json(),
      );
      expect((await app.inject({ method: 'POST', url: `/invoices/${invoice.id}/finalise` })).statusCode).toBe(200);

      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/credit-notes',
            payload: {
              linkedInvoiceId: invoice.id,
              issueDate: '2026-07-09',
              reason: 'Slice38 credit',
              type: 'Partial',
              adjustmentAmount: 25,
            },
          })
        ).statusCode,
      ).toBe(201);

      const customerPayment = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/payments',
            payload: {
              customerId: customer.id,
              paymentDate: '2026-07-10',
              paymentMethod: 'Bank Transfer',
              reference: 'SLICE38-PAY',
              amount: 100,
              allocations: [{ invoiceId: invoice.id, amount: 100 }],
            },
          })
        ).json(),
      );

      const purchaseOrder = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/purchase-orders',
            payload: {
              supplierId: supplier.id,
              issueDate: '2026-07-08',
              expectedDeliveryDate: '2026-07-15',
              supplierReference: 'SLICE38-PO',
              currency: 'AUD',
              lineItems: [{ description: 'Input', quantity: 2, unitPrice: 90, gstApplicable: true }],
            },
          })
        ).json(),
      );
      expect((await app.inject({ method: 'POST', url: `/purchase-orders/${purchaseOrder.id}/approve` })).statusCode).toBe(
        200,
      );

      const supplierBill = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: `/purchase-orders/${purchaseOrder.id}/create-supplier-bill`,
            payload: {},
          })
        ).json(),
      );
      expect((await app.inject({ method: 'POST', url: `/supplier-bills/${supplierBill.id}/finalise` })).statusCode).toBe(
        200,
      );

      const supplierPayment = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/supplier-payments',
            payload: {
              supplierId: supplier.id,
              paymentDate: '2026-07-12',
              paymentMethod: 'Bank Transfer',
              reference: 'SLICE38-SPAY',
              amount: 198,
              allocations: [{ supplierBillId: supplierBill.id, amount: 198 }],
            },
          })
        ).json(),
      );
      expect(supplierPayment.id).toBeDefined();

      const timelineBefore = entityRows(
        backupSchema.parse((await app.inject({ method: 'GET', url: '/platform/backup' })).json()).snapshot,
        'timeline_events',
      );
      const searchBefore: unknown = (
        await app.inject({ method: 'GET', url: '/search?q=slice38&limit=200&offset=0' })
      ).json();
      const reportBefore: unknown = (
        await app.inject({
          method: 'GET',
          url: '/reports/read-model?from=2026-07-01&to=2026-07-31&limit=200&offset=0',
        })
      ).json();

      const customerDeleteA = await app.inject({ method: 'DELETE', url: `/customers/${customer.id}` });
      expect(customerDeleteA.statusCode).toBe(409);
      expect(errorSchema.parse(customerDeleteA.json()).code).toBe('CUSTOMER_HAS_INVOICES');

      const [customerDeleteConcurrentA, customerDeleteConcurrentB] = await Promise.all([
        app.inject({ method: 'DELETE', url: `/customers/${customer.id}` }),
        app.inject({ method: 'DELETE', url: `/customers/${customer.id}` }),
      ]);
      expect(customerDeleteConcurrentA.statusCode).toBe(409);
      expect(customerDeleteConcurrentB.statusCode).toBe(409);
      expect(errorSchema.parse(customerDeleteConcurrentA.json()).code).toBe('CUSTOMER_HAS_INVOICES');
      expect(errorSchema.parse(customerDeleteConcurrentB.json()).code).toBe('CUSTOMER_HAS_INVOICES');

      const supplierDelete = await app.inject({ method: 'DELETE', url: `/suppliers/${supplier.id}` });
      expect(supplierDelete.statusCode).toBe(409);
      expect(errorSchema.parse(supplierDelete.json()).code).toBe('SUPPLIER_HAS_PURCHASE_ORDERS');

      const poDelete = await app.inject({ method: 'DELETE', url: `/purchase-orders/${purchaseOrder.id}` });
      expect(poDelete.statusCode).toBe(409);
      expect(errorSchema.parse(poDelete.json()).code).toBe('PURCHASE_ORDER_HAS_LINKED_SUPPLIER_BILLS');

      const supplierBillDelete = await app.inject({ method: 'DELETE', url: `/supplier-bills/${supplierBill.id}` });
      expect(supplierBillDelete.statusCode).toBe(409);
      expect(errorSchema.parse(supplierBillDelete.json()).code).toBe('SUPPLIER_BILL_HAS_ALLOCATIONS');

      const roleDelete = await app.inject({ method: 'DELETE', url: `/roles/${role.id}` });
      expect(roleDelete.statusCode).toBe(409);
      expect(errorSchema.parse(roleDelete.json()).code).toBe('ROLE_HAS_USERS');

      const userDelete = await app.inject({ method: 'DELETE', url: `/users/${user.id}` });
      expect(userDelete.statusCode).toBe(409);
      expect(errorSchema.parse(userDelete.json()).code).toBe('USER_HAS_ASSIGNED_JOBS');

      expect(() =>
        sql.prepare('UPDATE invoices SET customer_id = ? WHERE id = ?').run(randomUUID(), invoice.id),
      ).toThrowError(/IMMUTABLE_INVOICE_CUSTOMER_REFERENCE/);
      expect(() =>
        sql.prepare('UPDATE purchase_orders SET supplier_id = ? WHERE id = ?').run(randomUUID(), purchaseOrder.id),
      ).toThrowError(/IMMUTABLE_PURCHASE_ORDER_SUPPLIER_REFERENCE/);
      expect(() => sql.prepare('DELETE FROM payment_allocations WHERE payment_id = ?').run(customerPayment.id)).toThrowError(
        /IMMUTABLE_PAYMENT_ALLOCATION/,
      );
      expect(() =>
        sql.prepare('DELETE FROM supplier_payment_allocations WHERE supplier_payment_id = ?').run(supplierPayment.id),
      ).toThrowError(/IMMUTABLE_SUPPLIER_PAYMENT_ALLOCATION/);

      const timelineAfter = entityRows(
        backupSchema.parse((await app.inject({ method: 'GET', url: '/platform/backup' })).json()).snapshot,
        'timeline_events',
      );
      const searchAfter: unknown = (
        await app.inject({ method: 'GET', url: '/search?q=slice38&limit=200&offset=0' })
      ).json();
      const reportAfter: unknown = (
        await app.inject({
          method: 'GET',
          url: '/reports/read-model?from=2026-07-01&to=2026-07-31&limit=200&offset=0',
        })
      ).json();

      expect(timelineAfter).toHaveLength(timelineBefore.length);
      expect(searchAfter).toEqual(searchBefore);
      expect(reportAfter).toEqual(reportBefore);
    } finally {
      sql.close();
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
