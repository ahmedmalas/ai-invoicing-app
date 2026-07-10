import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });
const invoiceSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string().nullable(),
});
const paymentSchema = z.object({
  id: z.string().uuid(),
  paymentNumber: z.string(),
});
const supplierBillSchema = z.object({
  id: z.string().uuid(),
  billNumber: z.string().nullable(),
});
const supplierPaymentSchema = z.object({
  id: z.string().uuid(),
  paymentNumber: z.string(),
});
const purchaseOrderSchema = z.object({
  id: z.string().uuid(),
  purchaseOrderNumber: z.string(),
});
const paymentListSchema = z.object({
  payments: z.array(
    z.object({
      id: z.string().uuid(),
      paymentDate: z.string(),
      createdAt: z.string(),
    }),
  ),
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

describe('slice 45 concurrency and large-dataset stress validation', () => {
  it('keeps numbering/idempotency/allocation integrity under concurrent writes', async () => {
    const { dir, dbPath } = createTempDbPath('ai-business-os-slice45-concurrency-');
    const app = await buildApp({ dbPath, authBypassForTesting: true });

    try {
      const customer = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/customers',
            payload: { displayName: 'Slice45 Customer', email: 'slice45-customer@example.test' },
          })
        ).json(),
      );
      const supplier = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/suppliers',
            payload: { displayName: 'Slice45 Supplier', email: 'slice45-supplier@example.test' },
          })
        ).json(),
      );

      const duplicateInvoicePayload = {
        customerId: customer.id,
        title: 'Slice45 Duplicate Invoice',
        issueDate: '2026-07-10',
        dueDate: '2026-07-25',
        lineItems: [{ description: 'Duplicate', quantity: 1, unitPrice: 150, gstApplicable: true }],
      };
      const duplicateInvoiceA = invoiceSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/invoices',
            payload: duplicateInvoicePayload,
          })
        ).json(),
      );
      const duplicateInvoiceB = invoiceSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/invoices',
            payload: duplicateInvoicePayload,
          })
        ).json(),
      );
      expect(duplicateInvoiceB.id).toBe(duplicateInvoiceA.id);

      const invoiceCreates = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          app.inject({
            method: 'POST',
            url: '/invoices',
            payload: {
              customerId: customer.id,
              title: `Slice45 Invoice ${index + 1}`,
              issueDate: '2026-07-10',
              dueDate: '2026-07-25',
              lineItems: [{ description: `Line ${index + 1}`, quantity: 1, unitPrice: 110 + index, gstApplicable: true }],
            },
          }),
        ),
      );
      invoiceCreates.forEach((response) => expect(response.statusCode).toBe(201));
      const invoiceIds = invoiceCreates.map((response) => idSchema.parse(response.json()).id);

      const finaliseResponses = await Promise.all(
        [duplicateInvoiceA.id, ...invoiceIds].map((invoiceId) =>
          app.inject({ method: 'POST', url: `/invoices/${invoiceId}/finalise` }),
        ),
      );
      finaliseResponses.forEach((response) => expect(response.statusCode).toBe(200));
      const finalisedInvoices = finaliseResponses.map((response) => invoiceSchema.parse(response.json()));
      const invoiceNumbers = finalisedInvoices.map((row) => row.invoiceNumber).filter((value): value is string => !!value);
      expect(new Set(invoiceNumbers).size).toBe(invoiceNumbers.length);

      const creditNoteResponses = await Promise.all(
        finalisedInvoices.slice(0, 8).map((invoice, index) =>
          app.inject({
            method: 'POST',
            url: '/credit-notes',
            payload: {
              linkedInvoiceId: invoice.id,
              customerId: customer.id,
              issueDate: '2026-07-11',
              reason: `Slice45 Credit ${index + 1}`,
              type: 'Partial',
              totalCredit: 15,
              lineItems: [{ description: 'Credit', amount: 15 }],
            },
          }),
        ),
      );
      creditNoteResponses.forEach((response) => expect(response.statusCode).toBe(201));

      const customerPaymentPayload = {
        customerId: customer.id,
        paymentDate: '2026-07-12',
        paymentMethod: 'Bank Transfer',
        reference: 'SLICE45-PAY-IDEMPOTENT',
        amount: 40,
        allocations: [{ invoiceId: finalisedInvoices[0]?.id, amount: 40 }],
      };
      const customerPaymentA = paymentSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/payments',
            payload: customerPaymentPayload,
          })
        ).json(),
      );
      const customerPaymentB = paymentSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/payments',
            payload: customerPaymentPayload,
          })
        ).json(),
      );
      expect(customerPaymentB.id).toBe(customerPaymentA.id);

      const paymentResponses = await Promise.all(
        finalisedInvoices.slice(1, 10).map((invoice, index) =>
          app.inject({
            method: 'POST',
            url: '/payments',
            payload: {
              customerId: customer.id,
              paymentDate: '2026-07-12',
              paymentMethod: 'Bank Transfer',
              reference: `SLICE45-PAY-${index + 1}`,
              amount: 30,
              allocations: [{ invoiceId: invoice.id, amount: 30 }],
            },
          }),
        ),
      );
      paymentResponses.forEach((response) => expect(response.statusCode).toBe(201));
      const paymentNumbers = paymentResponses.map((response) => paymentSchema.parse(response.json()).paymentNumber);
      expect(new Set(paymentNumbers).size).toBe(paymentNumbers.length);

      const purchaseOrderResponses = await Promise.all(
        Array.from({ length: 14 }, (_, index) =>
          app.inject({
            method: 'POST',
            url: '/purchase-orders',
            payload: {
              supplierId: supplier.id,
              issueDate: '2026-07-10',
              expectedDeliveryDate: '2026-07-20',
              supplierReference: `SLICE45-PO-${index + 1}`,
              currency: 'AUD',
              lineItems: [{ description: `PO Line ${index + 1}`, quantity: 2, unitPrice: 90 + index, gstApplicable: true }],
            },
          }),
        ),
      );
      purchaseOrderResponses.forEach((response) => expect(response.statusCode).toBe(201));
      const purchaseOrders = purchaseOrderResponses.map((response) => purchaseOrderSchema.parse(response.json()));
      expect(new Set(purchaseOrders.map((po) => po.purchaseOrderNumber)).size).toBe(purchaseOrders.length);

      const approveResponses = await Promise.all(
        purchaseOrders.map((purchaseOrder) =>
          app.inject({ method: 'POST', url: `/purchase-orders/${purchaseOrder.id}/approve` }),
        ),
      );
      approveResponses.forEach((response) => expect(response.statusCode).toBe(200));

      const supplierBillCreateResponses = await Promise.all(
        purchaseOrders.map((purchaseOrder) =>
          app.inject({
            method: 'POST',
            url: `/purchase-orders/${purchaseOrder.id}/create-supplier-bill`,
            payload: {},
          }),
        ),
      );
      supplierBillCreateResponses.forEach((response) => expect(response.statusCode).toBe(201));
      const supplierBills = supplierBillCreateResponses.map((response) => supplierBillSchema.parse(response.json()));

      const supplierBillFinaliseResponses = await Promise.all(
        supplierBills.map((supplierBill) =>
          app.inject({ method: 'POST', url: `/supplier-bills/${supplierBill.id}/finalise` }),
        ),
      );
      supplierBillFinaliseResponses.forEach((response) => expect(response.statusCode).toBe(200));
      const supplierBillNumbers = supplierBillFinaliseResponses
        .map((response) => supplierBillSchema.parse(response.json()).billNumber)
        .filter((value): value is string => !!value);
      expect(new Set(supplierBillNumbers).size).toBe(supplierBillNumbers.length);

      const supplierPaymentIdempotentPayload = {
        supplierId: supplier.id,
        paymentDate: '2026-07-12',
        paymentMethod: 'Bank Transfer',
        reference: 'SLICE45-SP-IDEMPOTENT',
        amount: 25,
        allocations: [{ supplierBillId: supplierBills[0]?.id, amount: 25 }],
      };
      const supplierPaymentA = supplierPaymentSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/supplier-payments',
            payload: supplierPaymentIdempotentPayload,
          })
        ).json(),
      );
      const supplierPaymentB = supplierPaymentSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/supplier-payments',
            payload: supplierPaymentIdempotentPayload,
          })
        ).json(),
      );
      expect(supplierPaymentB.id).toBe(supplierPaymentA.id);

      const supplierPaymentResponses = await Promise.all(
        supplierBills.slice(1, 10).map((supplierBill, index) =>
          app.inject({
            method: 'POST',
            url: '/supplier-payments',
            payload: {
              supplierId: supplier.id,
              paymentDate: '2026-07-12',
              paymentMethod: 'Bank Transfer',
              reference: `SLICE45-SP-${index + 1}`,
              amount: 20,
              allocations: [{ supplierBillId: supplierBill.id, amount: 20 }],
            },
          }),
        ),
      );
      supplierPaymentResponses.forEach((response) => expect(response.statusCode).toBe(201));
      const supplierPaymentNumbers = supplierPaymentResponses.map(
        (response) => supplierPaymentSchema.parse(response.json()).paymentNumber,
      );
      expect(new Set(supplierPaymentNumbers).size).toBe(supplierPaymentNumbers.length);

      const snapshot = backupSchema.parse((await app.inject({ method: 'GET', url: '/platform/backup' })).json()).snapshot;
      const paymentAllocationRows = snapshot.entities.payment_allocations ?? [];
      const supplierPaymentAllocationRows = snapshot.entities.supplier_payment_allocations ?? [];
      const invoiceRows = snapshot.entities.invoices ?? [];
      const supplierBillRows = snapshot.entities.supplier_bills ?? [];
      const paymentRows = snapshot.entities.customer_payments ?? [];
      const supplierPaymentRows = snapshot.entities.supplier_payments ?? [];
      const invoiceIdsSet = new Set(invoiceRows.map((row) => row.id));
      const supplierBillIdsSet = new Set(supplierBillRows.map((row) => row.id));
      const paymentIdsSet = new Set(paymentRows.map((row) => row.id));
      const supplierPaymentIdsSet = new Set(supplierPaymentRows.map((row) => row.id));

      for (const allocation of paymentAllocationRows) {
        expect(paymentIdsSet.has(allocation.payment_id)).toBe(true);
        expect(invoiceIdsSet.has(allocation.invoice_id)).toBe(true);
      }
      for (const allocation of supplierPaymentAllocationRows) {
        expect(supplierPaymentIdsSet.has(allocation.supplier_payment_id)).toBe(true);
        expect(supplierBillIdsSet.has(allocation.supplier_bill_id)).toBe(true);
      }
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps list/search/report/timeline deterministic for large seeded sets and concurrent reads', async () => {
    const { dir, dbPath } = createTempDbPath('ai-business-os-slice45-dataset-');
    const app = await buildApp({ dbPath, authBypassForTesting: true });

    try {
      const customer = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/customers',
            payload: { displayName: 'Slice45 Dataset Customer' },
          })
        ).json(),
      );

      const seededInvoiceIds: string[] = [];
      for (let index = 0; index < 120; index += 1) {
        const day = String((index % 28) + 1).padStart(2, '0');
        const invoice = idSchema.parse(
          (
            await app.inject({
              method: 'POST',
              url: '/invoices',
              payload: {
                customerId: customer.id,
                title: `Slice45 Dataset Invoice ${index + 1}`,
                issueDate: `2026-06-${day}`,
                dueDate: `2026-07-${day}`,
                lineItems: [
                  { description: `Dataset ${index + 1}`, quantity: 1, unitPrice: 70 + index, gstApplicable: true },
                ],
              },
            })
          ).json(),
        );
        seededInvoiceIds.push(invoice.id);
        const finalise = await app.inject({ method: 'POST', url: `/invoices/${invoice.id}/finalise` });
        expect(finalise.statusCode).toBe(200);
        const payment = await app.inject({
          method: 'POST',
          url: '/payments',
          payload: {
            customerId: customer.id,
            paymentDate: `2026-06-${day}`,
            paymentMethod: 'Bank Transfer',
            reference: `SL45-BASE-PAY-${index + 1}`,
            amount: 20,
            allocations: [{ invoiceId: invoice.id, amount: 20 }],
          },
        });
        expect(payment.statusCode).toBe(201);
      }

      const fixedBeforePageA = paymentListSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/payments?from=2026-06-01&to=2026-06-28&limit=25&offset=0',
          })
        ).json(),
      );
      const fixedBeforePageB = paymentListSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/payments?from=2026-06-01&to=2026-06-28&limit=25&offset=25',
          })
        ).json(),
      );

      await Promise.all(
        Array.from({ length: 25 }, (_, index) =>
          app.inject({
            method: 'POST',
            url: '/payments',
            payload: {
              customerId: customer.id,
              paymentDate: '2026-08-01',
              paymentMethod: 'Bank Transfer',
              reference: `SL45-CONCURRENT-PAY-${index + 1}`,
              amount: 10,
              allocations: [{ invoiceId: seededInvoiceIds[index] ?? seededInvoiceIds[0], amount: 10 }],
            },
          }),
        ),
      );

      const concurrentReads = await Promise.all([
        app.inject({ method: 'GET', url: '/payments?from=2026-06-01&to=2026-06-28&limit=25&offset=0' }),
        app.inject({ method: 'GET', url: '/payments?from=2026-06-01&to=2026-06-28&limit=25&offset=25' }),
        app.inject({ method: 'GET', url: '/search?q=slice45 dataset&limit=100&offset=0' }),
        app.inject({
          method: 'GET',
          url: '/reports/read-model?from=2026-06-01&to=2026-08-31&limit=100&offset=0',
        }),
      ]);
      concurrentReads.forEach((response) => expect(response.statusCode).toBe(200));

      const fixedAfterPageA = paymentListSchema.parse(concurrentReads[0].json());
      const fixedAfterPageB = paymentListSchema.parse(concurrentReads[1].json());
      expect(fixedAfterPageA).toEqual(fixedBeforePageA);
      expect(fixedAfterPageB).toEqual(fixedBeforePageB);

      const finalReadA = await app.inject({
        method: 'GET',
        url: '/reports/read-model?from=2026-06-01&to=2026-08-31&limit=100&offset=0',
      });
      const finalReadB = await app.inject({
        method: 'GET',
        url: '/reports/read-model?from=2026-06-01&to=2026-08-31&limit=100&offset=0',
      });
      expect(finalReadA.statusCode).toBe(200);
      expect(finalReadB.statusCode).toBe(200);
      expect(finalReadA.json()).toEqual(finalReadB.json());

      const timelineA = await app.inject({
        method: 'GET',
        url: `/timeline/invoice/${seededInvoiceIds[0]}?limit=100&offset=0`,
      });
      const timelineB = await app.inject({
        method: 'GET',
        url: `/timeline/invoice/${seededInvoiceIds[0]}?limit=100&offset=0`,
      });
      expect(timelineA.statusCode).toBe(200);
      expect(timelineB.statusCode).toBe(200);
      expect(timelineA.json()).toEqual(timelineB.json());
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
