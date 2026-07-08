import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

const invoiceDraftSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['Draft', 'Finalised']),
  invoiceNumber: z.string().nullable(),
});

const purchaseOrderSchema = z.object({
  id: z.string().uuid(),
  purchaseOrderNumber: z.string(),
});

const supplierBillSchema = z.object({
  id: z.string().uuid(),
  billNumber: z.string().nullable(),
});

const paymentSchema = z.object({
  id: z.string().uuid(),
  paymentNumber: z.string(),
});

const backupSchema = z.object({
  snapshot: z.object({
    entities: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  }),
});

function createTempDbPath(prefix: string): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, dbPath: join(dir, 'app.db') };
}

function rowsFrom(snapshot: z.infer<typeof backupSchema>['snapshot'], table: string): Array<Record<string, unknown>> {
  return snapshot.entities[table] ?? [];
}

describe('slice 37 concurrency, rollback, and idempotency integrity', () => {
  it('keeps writes atomic and deterministic under concurrency and duplicate submissions', async () => {
    const { dir, dbPath } = createTempDbPath('ai-business-os-slice37-');
    const app = await buildApp({ dbPath });

    try {
      const customer = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/customers',
            payload: { displayName: 'Slice37 Customer', email: 'slice37-customer@example.test' },
          })
        ).json(),
      );
      const supplier = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/suppliers',
            payload: { displayName: 'Slice37 Supplier', email: 'slice37-supplier@example.test' },
          })
        ).json(),
      );

      const duplicateInvoicePayload = {
        customerId: customer.id,
        title: 'Slice37 Duplicate Draft',
        issueDate: '2026-07-08',
        dueDate: '2026-07-22',
        lineItems: [{ description: 'Duplicate', quantity: 1, unitPrice: 125, gstApplicable: true }],
      };
      const duplicateA = invoiceDraftSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/invoices',
            payload: duplicateInvoicePayload,
          })
        ).json(),
      );
      const duplicateB = invoiceDraftSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/invoices',
            payload: duplicateInvoicePayload,
          })
        ).json(),
      );
      expect(duplicateB.id).toBe(duplicateA.id);

      const concurrentInvoiceResponses = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          app.inject({
            method: 'POST',
            url: '/invoices',
            payload: {
              customerId: customer.id,
              title: `Slice37 Concurrent Invoice ${index + 1}`,
              issueDate: '2026-07-08',
              dueDate: '2026-07-22',
              lineItems: [{ description: `Line ${index + 1}`, quantity: 1, unitPrice: 100, gstApplicable: true }],
            },
          }),
        ),
      );
      for (const response of concurrentInvoiceResponses) {
        expect(response.statusCode).toBe(201);
      }
      const concurrentInvoiceIds = concurrentInvoiceResponses.map((response) => idSchema.parse(response.json()).id);

      const finaliseResponses = await Promise.all(
        [duplicateA.id, ...concurrentInvoiceIds].map((invoiceId) =>
          app.inject({
            method: 'POST',
            url: `/invoices/${invoiceId}/finalise`,
          }),
        ),
      );
      for (const response of finaliseResponses) {
        expect(response.statusCode).toBe(200);
      }
      const finalisedInvoices = finaliseResponses.map((response) => invoiceDraftSchema.parse(response.json()));
      const invoiceNumbers = finalisedInvoices.map((invoice) => invoice.invoiceNumber);
      expect(invoiceNumbers.every((number) => typeof number === 'string' && number.length > 0)).toBe(true);
      expect(new Set(invoiceNumbers).size).toBe(invoiceNumbers.length);

      const concurrentPurchaseOrderResponses = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          app.inject({
            method: 'POST',
            url: '/purchase-orders',
            payload: {
              supplierId: supplier.id,
              issueDate: '2026-07-08',
              expectedDeliveryDate: '2026-07-15',
              supplierReference: `SLICE37-PO-${index + 1}`,
              currency: 'AUD',
              notes: `PO ${index + 1}`,
              lineItems: [{ description: `PO line ${index + 1}`, quantity: 2, unitPrice: 80 + index, gstApplicable: true }],
            },
          }),
        ),
      );
      for (const response of concurrentPurchaseOrderResponses) {
        expect(response.statusCode).toBe(201);
      }
      const purchaseOrders = concurrentPurchaseOrderResponses.map((response) => purchaseOrderSchema.parse(response.json()));
      expect(new Set(purchaseOrders.map((order) => order.purchaseOrderNumber)).size).toBe(purchaseOrders.length);

      const concurrentSupplierBillResponses = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          app.inject({
            method: 'POST',
            url: '/supplier-bills',
            payload: {
              supplierId: supplier.id,
              billDate: '2026-07-09',
              dueDate: '2026-07-20',
              supplierReference: `SLICE37-BILL-${index + 1}`,
              currency: 'AUD',
              notes: `Bill ${index + 1}`,
              lineItems: [{ description: `Bill line ${index + 1}`, quantity: 1, unitPrice: 60 + index, gstApplicable: true }],
            },
          }),
        ),
      );
      for (const response of concurrentSupplierBillResponses) {
        expect(response.statusCode).toBe(201);
      }
      const supplierBills = concurrentSupplierBillResponses.map((response) => supplierBillSchema.parse(response.json()));
      for (const bill of supplierBills) {
        const finalise = await app.inject({
          method: 'POST',
          url: `/supplier-bills/${bill.id}/finalise`,
        });
        expect(finalise.statusCode).toBe(200);
      }

      const concurrentPaymentResponses = await Promise.all(
        finalisedInvoices.slice(0, 10).map((invoice, index) =>
          app.inject({
            method: 'POST',
            url: '/payments',
            payload: {
              customerId: customer.id,
              paymentDate: '2026-07-10',
              paymentMethod: 'Bank Transfer',
              reference: `SLICE37-PAY-${index + 1}`,
              amount: 110,
              allocations: [{ invoiceId: invoice.id, amount: 110 }],
            },
          }),
        ),
      );
      for (const response of concurrentPaymentResponses) {
        expect(response.statusCode).toBe(201);
      }
      const payments = concurrentPaymentResponses.map((response) => paymentSchema.parse(response.json()));
      expect(new Set(payments.map((payment) => payment.paymentNumber)).size).toBe(payments.length);

      const baselineBackup = backupSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/platform/backup',
          })
        ).json(),
      ).snapshot;

      process.env.AI_BUSINESS_OS_FAILPOINT = 'create_invoice_after_line_items';
      const failedInvoiceResponse = await app.inject({
        method: 'POST',
        url: '/invoices',
        payload: {
          customerId: customer.id,
          title: 'Slice37 Failpoint Draft',
          issueDate: '2026-07-08',
          dueDate: '2026-07-22',
          lineItems: [{ description: 'Failpoint line', quantity: 1, unitPrice: 55, gstApplicable: true }],
        },
      });
      delete process.env.AI_BUSINESS_OS_FAILPOINT;
      expect(failedInvoiceResponse.statusCode).toBe(500);

      const postFailureBackup = backupSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/platform/backup',
          })
        ).json(),
      ).snapshot;
      expect(postFailureBackup).toEqual(baselineBackup);

      const reportA: unknown = (
        await app.inject({
          method: 'GET',
          url: '/reports/read-model?from=2026-07-01&to=2026-07-31&limit=500&offset=0',
        })
      ).json();
      const reportB: unknown = (
        await app.inject({
          method: 'GET',
          url: '/reports/read-model?from=2026-07-01&to=2026-07-31&limit=500&offset=0',
        })
      ).json();
      expect(reportA).toEqual(reportB);

      const searchA: unknown = (
        await app.inject({
          method: 'GET',
          url: '/search?q=slice37&limit=500&offset=0',
        })
      ).json();
      const searchB: unknown = (
        await app.inject({
          method: 'GET',
          url: '/search?q=slice37&limit=500&offset=0',
        })
      ).json();
      expect(searchA).toEqual(searchB);

      const timelineA: unknown = (
        await app.inject({
          method: 'GET',
          url: `/timeline/invoice/${duplicateA.id}?limit=200&offset=0`,
        })
      ).json();
      const timelineB: unknown = (
        await app.inject({
          method: 'GET',
          url: `/timeline/invoice/${duplicateA.id}?limit=200&offset=0`,
        })
      ).json();
      expect(timelineA).toEqual(timelineB);

      const finalBackup = backupSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/platform/backup',
          })
        ).json(),
      ).snapshot;

      const invoiceRows = rowsFrom(finalBackup, 'invoices');
      const paymentRows = rowsFrom(finalBackup, 'customer_payments');
      const paymentAllocationRows = rowsFrom(finalBackup, 'payment_allocations');
      const supplierBillRows = rowsFrom(finalBackup, 'supplier_bills');
      const poRows = rowsFrom(finalBackup, 'purchase_orders');
      const timelineRows = rowsFrom(finalBackup, 'timeline_events');

      const invoiceIdSet = new Set(invoiceRows.map((row) => row.id));
      const paymentIdSet = new Set(paymentRows.map((row) => row.id));
      const supplierBillIdSet = new Set(supplierBillRows.map((row) => row.id));
      const purchaseOrderIdSet = new Set(poRows.map((row) => row.id));

      for (const allocation of paymentAllocationRows) {
        expect(paymentIdSet.has(allocation.payment_id)).toBe(true);
        expect(invoiceIdSet.has(allocation.invoice_id)).toBe(true);
      }
      for (const supplierBill of supplierBillRows) {
        if (supplierBill.source_purchase_order_id) {
          expect(purchaseOrderIdSet.has(supplierBill.source_purchase_order_id)).toBe(true);
        }
      }
      expect(timelineRows.length).toBeGreaterThan(0);
      expect(new Set(invoiceRows.map((row) => row.invoice_number).filter(Boolean)).size).toBe(
        invoiceRows.filter((row) => row.invoice_number !== null).length,
      );
      expect(new Set(poRows.map((row) => row.purchase_order_number)).size).toBe(poRows.length);
      expect(new Set(paymentRows.map((row) => row.payment_number)).size).toBe(paymentRows.length);
      expect(new Set(supplierBillRows.map((row) => row.bill_number).filter(Boolean)).size).toBe(
        supplierBillRows.filter((row) => row.bill_number !== null).length,
      );
      expect(supplierBillIdSet.size).toBe(supplierBillRows.length);
    } finally {
      delete process.env.AI_BUSINESS_OS_FAILPOINT;
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
