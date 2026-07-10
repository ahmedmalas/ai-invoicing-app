import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const idSchema = z.object({ id: z.string().uuid() });

function extractPageIds(payload: unknown, key: string): string[] {
  const parsed = z.record(z.string(), z.array(z.object({ id: z.string().uuid() }))).parse(payload);
  return (parsed[key] ?? []).map((row) => row.id);
}

function explainPlanDetails(raw: Database.Database, sql: string, params: unknown[] = []): string[] {
  return (
    raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{
      detail: string;
    }>
  ).map((row) => row.detail);
}

describe('performance, query efficiency, and scalability integrity', () => {
  it('keeps large search/timeline/reporting deterministic and pagination stable under load', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-business-os-perf-'));
    createdDirs.push(tempDir);
    const dbPath = join(tempDir, 'perf-scalability.sqlite');
    const app = await buildApp({ dbPath });

    const customer = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/customers',
          payload: { displayName: 'Performance Customer' },
        })
      ).json(),
    );
    const supplier = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/suppliers',
          payload: { displayName: 'Performance Supplier' },
        })
      ).json(),
    );

    const invoiceIds: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const issueDay = String((index % 28) + 1).padStart(2, '0');
      const invoice = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/invoices',
            payload: {
              customerId: customer.id,
              title: `Performance Invoice ${index}`,
              issueDate: `2026-07-${issueDay}`,
              dueDate: `2026-08-${issueDay}`,
              lineItems: [{ description: `Perf line ${index}`, quantity: 1, unitPrice: 100 + index, gstApplicable: true }],
            },
          })
        ).json(),
      );
      invoiceIds.push(invoice.id);
      expect((await app.inject({ method: 'POST', url: `/invoices/${invoice.id}/finalise` })).statusCode).toBe(200);

      if (index % 5 === 0) {
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/credit-notes',
              payload: {
                linkedInvoiceId: invoice.id,
                issueDate: `2026-07-${issueDay}`,
                reason: `Performance credit ${index}`,
                type: 'Partial',
                lineItems: [{ description: `Credit ${index}`, amount: 10 }],
              },
            })
          ).statusCode,
        ).toBe(201);
      }

      if (index % 3 === 0) {
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/payments',
              payload: {
                customerId: customer.id,
                paymentDate: `2026-07-${issueDay}`,
                paymentMethod: 'Bank Transfer',
                reference: `PERF-PAY-${index}`,
                amount: 30,
                allocations: [{ invoiceId: invoice.id, amount: 30 }],
              },
            })
          ).statusCode,
        ).toBe(201);
      }
    }

    for (let index = 0; index < 30; index += 1) {
      const issueDay = String((index % 28) + 1).padStart(2, '0');
      const po = z.object({ id: z.string().uuid() }).parse(
        (
          await app.inject({
            method: 'POST',
            url: '/purchase-orders',
            payload: {
              supplierId: supplier.id,
              issueDate: `2026-07-${issueDay}`,
              expectedDeliveryDate: `2026-08-${issueDay}`,
              supplierReference: `PERF-PO-${index}`,
              currency: 'AUD',
              lineItems: [{ description: `PO line ${index}`, quantity: 1, unitPrice: 80 + index, gstApplicable: true }],
            },
          })
        ).json(),
      );
      expect((await app.inject({ method: 'POST', url: `/purchase-orders/${po.id}/approve` })).statusCode).toBe(200);
      const bill = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: `/purchase-orders/${po.id}/create-supplier-bill`,
            payload: {},
          })
        ).json(),
      );
      expect((await app.inject({ method: 'POST', url: `/supplier-bills/${bill.id}/finalise` })).statusCode).toBe(200);

      if (index % 2 === 0) {
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/supplier-payments',
              payload: {
                supplierId: supplier.id,
                paymentDate: `2026-07-${issueDay}`,
                paymentMethod: 'Bank Transfer',
                reference: `PERF-SPAY-${index}`,
                amount: 20,
                allocations: [{ supplierBillId: bill.id, amount: 20 }],
              },
            })
          ).statusCode,
        ).toBe(201);
      }
    }

    const searchA = await app.inject({
      method: 'GET',
      url: '/search?q=performance&limit=25&offset=0',
    });
    const searchB = await app.inject({
      method: 'GET',
      url: '/search?q=performance&limit=25&offset=0',
    });
    expect(searchA.statusCode).toBe(200);
    expect(searchB.statusCode).toBe(200);
    expect(searchA.json()).toEqual(searchB.json());

    const timelineA = await app.inject({
      method: 'GET',
      url: `/timeline/invoice/${invoiceIds[0]}?limit=20&offset=0`,
    });
    const timelineB = await app.inject({
      method: 'GET',
      url: `/timeline/invoice/${invoiceIds[0]}?limit=20&offset=0`,
    });
    expect(timelineA.statusCode).toBe(200);
    expect(timelineB.statusCode).toBe(200);
    expect(timelineA.json()).toEqual(timelineB.json());

    const reportA = await app.inject({
      method: 'GET',
      url: '/reports/read-model?from=2026-07-01&to=2026-08-31&limit=25&offset=0',
    });
    const reportB = await app.inject({
      method: 'GET',
      url: '/reports/read-model?from=2026-07-01&to=2026-08-31&limit=25&offset=0',
    });
    expect(reportA.statusCode).toBe(200);
    expect(reportB.statusCode).toBe(200);
    expect(reportA.json()).toEqual(reportB.json());

    const paymentsPageA = extractPageIds((await app.inject({ method: 'GET', url: '/payments?limit=15&offset=0' })).json(), 'payments');
    const paymentsPageB = extractPageIds((await app.inject({ method: 'GET', url: '/payments?limit=15&offset=15' })).json(), 'payments');
    const paymentsFull = extractPageIds((await app.inject({ method: 'GET', url: '/payments?limit=30&offset=0' })).json(), 'payments');
    expect([...paymentsPageA, ...paymentsPageB]).toEqual(paymentsFull);

    const supplierPaymentsPageA = extractPageIds(
      (await app.inject({ method: 'GET', url: '/supplier-payments?limit=10&offset=0' })).json(),
      'payments',
    );
    const supplierPaymentsPageB = extractPageIds(
      (await app.inject({ method: 'GET', url: '/supplier-payments?limit=10&offset=10' })).json(),
      'payments',
    );
    const supplierPaymentsFull = extractPageIds(
      (await app.inject({ method: 'GET', url: '/supplier-payments?limit=20&offset=0' })).json(),
      'payments',
    );
    expect([...supplierPaymentsPageA, ...supplierPaymentsPageB]).toEqual(supplierPaymentsFull);

    const purchaseOrdersPageA = extractPageIds(
      (await app.inject({ method: 'GET', url: '/purchase-orders?limit=15&offset=0' })).json(),
      'purchaseOrders',
    );
    const purchaseOrdersPageB = extractPageIds(
      (await app.inject({ method: 'GET', url: '/purchase-orders?limit=15&offset=15' })).json(),
      'purchaseOrders',
    );
    const purchaseOrdersFull = extractPageIds(
      (await app.inject({ method: 'GET', url: '/purchase-orders?limit=30&offset=0' })).json(),
      'purchaseOrders',
    );
    expect([...purchaseOrdersPageA, ...purchaseOrdersPageB]).toEqual(purchaseOrdersFull);

    const billsPageA = extractPageIds((await app.inject({ method: 'GET', url: '/supplier-bills?limit=15&offset=0' })).json(), 'bills');
    const billsPageB = extractPageIds((await app.inject({ method: 'GET', url: '/supplier-bills?limit=15&offset=15' })).json(), 'bills');
    const billsFull = extractPageIds((await app.inject({ method: 'GET', url: '/supplier-bills?limit=30&offset=0' })).json(), 'bills');
    expect([...billsPageA, ...billsPageB]).toEqual(billsFull);

    const creditNotesPageA = extractPageIds(
      (await app.inject({ method: 'GET', url: '/credit-notes?limit=10&offset=0' })).json(),
      'creditNotes',
    );
    const creditNotesPageB = extractPageIds(
      (await app.inject({ method: 'GET', url: '/credit-notes?limit=10&offset=10' })).json(),
      'creditNotes',
    );
    const creditNotesFull = extractPageIds(
      (await app.inject({ method: 'GET', url: '/credit-notes?limit=20&offset=0' })).json(),
      'creditNotes',
    );
    expect([...creditNotesPageA, ...creditNotesPageB]).toEqual(creditNotesFull);

    const concurrentReads = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({
          method: 'GET',
          url: '/reports/read-model?from=2026-07-01&to=2026-08-31&limit=25&offset=0',
        }),
      ),
    );
    for (const response of concurrentReads) {
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(concurrentReads[0]?.json());
    }

    await app.close();
  });

  it('keeps concurrent creation queryable and uses index-backed plans for high-volume reads', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-business-os-perf-plans-'));
    createdDirs.push(tempDir);
    const dbPath = join(tempDir, 'perf-plans.sqlite');
    const app = await buildApp({ dbPath });
    const raw = new Database(dbPath);

    const customer = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/customers',
          payload: { displayName: 'Concurrent Customer' },
        })
      ).json(),
    );
    const supplier = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/suppliers',
          payload: { displayName: 'Concurrent Supplier' },
        })
      ).json(),
    );

    const invoiceDraftResponses = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/invoices',
          payload: {
            customerId: customer.id,
            title: `Concurrent Invoice ${index}`,
            issueDate: '2026-07-10',
            dueDate: '2026-07-20',
            lineItems: [{ description: `Concurrent line ${index}`, quantity: 1, unitPrice: 100, gstApplicable: true }],
          },
        }),
      ),
    );
    const invoiceIds = invoiceDraftResponses.map((response) => {
      expect(response.statusCode).toBe(201);
      return idSchema.parse(response.json()).id;
    });
    const finaliseResponses = await Promise.all(
      invoiceIds.map((invoiceId) => app.inject({ method: 'POST', url: `/invoices/${invoiceId}/finalise` })),
    );
    for (const response of finaliseResponses) {
      expect(response.statusCode).toBe(200);
    }

    const poResponses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/purchase-orders',
          payload: {
            supplierId: supplier.id,
            issueDate: '2026-07-11',
            currency: 'AUD',
            supplierReference: `CONC-PO-${index}`,
            lineItems: [{ description: `Concurrent PO ${index}`, quantity: 1, unitPrice: 100, gstApplicable: true }],
          },
        }),
      ),
    );
    const poIds = poResponses.map((response) => {
      expect(response.statusCode).toBe(201);
      return idSchema.parse(response.json()).id;
    });
    const approveResponses = await Promise.all(
      poIds.map((poId) => app.inject({ method: 'POST', url: `/purchase-orders/${poId}/approve` })),
    );
    for (const response of approveResponses) {
      expect(response.statusCode).toBe(200);
    }
    const billResponses = await Promise.all(
      poIds.map((poId) =>
        app.inject({
          method: 'POST',
          url: `/purchase-orders/${poId}/create-supplier-bill`,
          payload: {},
        }),
      ),
    );
    const billIds = billResponses.map((response) => {
      expect(response.statusCode).toBe(201);
      return idSchema.parse(response.json()).id;
    });
    const billFinaliseResponses = await Promise.all(
      billIds.map((billId) => app.inject({ method: 'POST', url: `/supplier-bills/${billId}/finalise` })),
    );
    for (const response of billFinaliseResponses) {
      expect(response.statusCode).toBe(200);
    }

    const searchResponse = await app.inject({
      method: 'GET',
      url: '/search?q=concurrent&limit=50&offset=0',
    });
    expect(searchResponse.statusCode).toBe(200);
    const searchPayload = z
      .object({
        invoices: z.array(z.object({ id: z.string().uuid() })),
        purchaseOrders: z.array(z.object({ id: z.string().uuid() })),
        supplierBills: z.array(z.object({ id: z.string().uuid() })),
      })
      .parse(searchResponse.json());
    expect(searchPayload.invoices.length).toBeGreaterThan(0);
    expect(searchPayload.purchaseOrders.length).toBeGreaterThan(0);
    expect(searchPayload.supplierBills.length).toBeGreaterThan(0);

    const invoiceTimelineRes = await app.inject({
      method: 'GET',
      url: `/timeline/invoice/${invoiceIds[0]}?eventKey=invoice.finalised&limit=10&offset=0`,
    });
    expect(invoiceTimelineRes.statusCode).toBe(200);
    const invoiceTimelinePayload = z.object({ events: z.array(z.object({ eventKey: z.string() })) }).parse(
      invoiceTimelineRes.json(),
    );
    expect(invoiceTimelinePayload.events.map((event) => event.eventKey)).toEqual(['invoice.finalised']);

    const timelinePlan = explainPlanDetails(
      raw,
      `SELECT id
       FROM timeline_events
       WHERE entity_type = ?
         AND entity_id = ?
         AND coalesce(event_key, event_type) = ?
       ORDER BY created_at ASC, rowid ASC
       LIMIT ? OFFSET ?`,
      ['invoice', invoiceIds[0], 'invoice.finalised', 10, 0],
    );
    expect(timelinePlan.some((detail) => detail.includes('idx_timeline_entity_event_key_order'))).toBe(true);

    const reportInvoicePlan = explainPlanDetails(
      raw,
      `SELECT id
       FROM invoices
       WHERE status = 'Finalised'
         AND issue_date >= ?
         AND issue_date <= ?
       ORDER BY issue_date ASC, created_at ASC, id ASC
       LIMIT ? OFFSET ?`,
      ['2026-07-01', '2026-07-31', 25, 0],
    );
    expect(reportInvoicePlan.some((detail) => detail.includes('idx_invoices_status_issue_order'))).toBe(true);

    const customerPaymentsPlan = explainPlanDetails(
      raw,
      `SELECT id
       FROM customer_payments
       WHERE customer_id = ?
       ORDER BY payment_date DESC, created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [customer.id, 20, 0],
    );
    expect(customerPaymentsPlan.some((detail) => detail.includes('idx_customer_payments_customer_payment_order'))).toBe(
      true,
    );

    const supplierBillsPlan = explainPlanDetails(
      raw,
      `SELECT id
       FROM supplier_bills
       WHERE supplier_id = ?
       ORDER BY bill_date DESC, created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [supplier.id, 20, 0],
    );
    expect(supplierBillsPlan.some((detail) => detail.includes('idx_supplier_bills_supplier_bill_order'))).toBe(true);

    const purchaseOrdersPlan = explainPlanDetails(
      raw,
      `SELECT id
       FROM purchase_orders
       WHERE supplier_id = ?
       ORDER BY issue_date DESC, created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [supplier.id, 20, 0],
    );
    expect(purchaseOrdersPlan.some((detail) => detail.includes('idx_purchase_orders_supplier_issue_order'))).toBe(true);

    raw.close();
    await app.close();
  });
});
