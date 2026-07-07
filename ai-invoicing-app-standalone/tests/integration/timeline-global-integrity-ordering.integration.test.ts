import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
const eventSchema = z.object({
  id: z.string().uuid(),
  eventKey: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  eventPayload: z.string(),
  createdAt: z.string(),
});
const timelineSchema = z.object({ events: z.array(eventSchema) });

function assertOrdered(events: Array<z.infer<typeof eventSchema>>): void {
  const sorted = [...events].sort((a, b) => {
    if (a.createdAt === b.createdAt) {
      return a.id.localeCompare(b.id);
    }
    return a.createdAt.localeCompare(b.createdAt);
  });
  expect(events).toEqual(sorted);
}

describe('global timeline integrity and ordering', () => {
  it('keeps ordering, metadata, filtering, pagination, and lifecycle event integrity deterministic', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-business-os-timeline-'));
    createdDirs.push(tempDir);
    const dbPath = join(tempDir, 'timeline-integrity.sqlite');
    const app = await buildApp({ dbPath });
    const raw = new Database(dbPath);

    const customerRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Timeline Customer' },
    });
    expect(customerRes.statusCode).toBe(201);
    const customer = idSchema.parse(customerRes.json());

    const supplierRes = await app.inject({
      method: 'POST',
      url: '/suppliers',
      payload: { displayName: 'Timeline Supplier' },
    });
    expect(supplierRes.statusCode).toBe(201);
    const supplier = idSchema.parse(supplierRes.json());

    const invoiceDraftRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customer.id,
        title: 'Timeline Invoice',
        issueDate: '2026-07-08',
        dueDate: '2026-07-22',
        lineItems: [{ description: 'Line', quantity: 1, unitPrice: 120, gstApplicable: true }],
      },
    });
    expect(invoiceDraftRes.statusCode).toBe(201);
    const invoice = idSchema.parse(invoiceDraftRes.json());

    const invoiceUpdateRes = await app.inject({
      method: 'PUT',
      url: `/invoices/${invoice.id}`,
      payload: {
        title: 'Timeline Invoice Updated',
        issueDate: '2026-07-08',
        dueDate: '2026-07-22',
        paymentState: 'Sent',
        lineItems: [
          { description: 'Line', quantity: 1, unitPrice: 120, gstApplicable: true },
          { description: 'Line 2', quantity: 1, unitPrice: 20, gstApplicable: false },
        ],
      },
    });
    expect(invoiceUpdateRes.statusCode).toBe(200);

    const invoiceFinaliseRes = await app.inject({
      method: 'POST',
      url: `/invoices/${invoice.id}/finalise`,
    });
    expect(invoiceFinaliseRes.statusCode).toBe(200);
    const invoiceFinalised = z.object({ invoiceNumber: z.string() }).parse(invoiceFinaliseRes.json());

    const invoiceTimelineRes = await app.inject({
      method: 'GET',
      url: `/timeline/invoice/${invoice.id}`,
    });
    expect(invoiceTimelineRes.statusCode).toBe(200);
    const invoiceTimeline = timelineSchema.parse(invoiceTimelineRes.json());
    expect(invoiceTimeline.events.map((event) => event.eventKey)).toEqual([
      'invoice.draft_created',
      'invoice.draft_updated',
      'invoice.finalised',
    ]);
    assertOrdered(invoiceTimeline.events);

    const invoiceTimelineResRepeat = await app.inject({
      method: 'GET',
      url: `/timeline/invoice/${invoice.id}`,
    });
    expect(invoiceTimelineResRepeat.statusCode).toBe(200);
    expect(timelineSchema.parse(invoiceTimelineResRepeat.json())).toEqual(invoiceTimeline);

    const invoicePageOneRes = await app.inject({
      method: 'GET',
      url: `/timeline/invoice/${invoice.id}?limit=2&offset=0`,
    });
    const invoicePageTwoRes = await app.inject({
      method: 'GET',
      url: `/timeline/invoice/${invoice.id}?limit=2&offset=2`,
    });
    expect(invoicePageOneRes.statusCode).toBe(200);
    expect(invoicePageTwoRes.statusCode).toBe(200);
    const invoicePageOne = timelineSchema.parse(invoicePageOneRes.json()).events;
    const invoicePageTwo = timelineSchema.parse(invoicePageTwoRes.json()).events;
    expect([...invoicePageOne, ...invoicePageTwo].map((event) => event.id)).toEqual(
      invoiceTimeline.events.map((event) => event.id),
    );

    const invoiceFilteredRes = await app.inject({
      method: 'GET',
      url: `/timeline/invoice/${invoice.id}?eventKey=invoice.finalised`,
    });
    expect(invoiceFilteredRes.statusCode).toBe(200);
    const invoiceFiltered = timelineSchema.parse(invoiceFilteredRes.json()).events;
    expect(invoiceFiltered).toHaveLength(1);
    expect(invoiceFiltered[0]?.eventKey).toBe('invoice.finalised');
    expect(JSON.parse(invoiceFiltered[0]?.eventPayload ?? '{}')).toMatchObject({
      invoiceNumber: invoiceFinalised.invoiceNumber,
    });

    const invoiceTimelineCountBeforeFailures = invoiceTimeline.events.length;
    const duplicateInvoiceFinaliseRes = await app.inject({
      method: 'POST',
      url: `/invoices/${invoice.id}/finalise`,
    });
    expect(duplicateInvoiceFinaliseRes.statusCode).toBe(409);
    const rejectedInvoiceUpdateRes = await app.inject({
      method: 'PUT',
      url: `/invoices/${invoice.id}`,
      payload: {
        title: 'Rejected update',
        issueDate: '2026-07-08',
        dueDate: '2026-07-22',
        paymentState: 'Sent',
        lineItems: [{ description: 'Line', quantity: 1, unitPrice: 1, gstApplicable: false }],
      },
    });
    expect(rejectedInvoiceUpdateRes.statusCode).toBe(409);
    const invoiceTimelineAfterFailures = timelineSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/timeline/invoice/${invoice.id}`,
        })
      ).json(),
    ).events;
    expect(invoiceTimelineAfterFailures).toHaveLength(invoiceTimelineCountBeforeFailures);
    expect(invoiceTimelineAfterFailures.filter((event) => event.eventKey === 'invoice.finalised')).toHaveLength(1);

    const creditNoteRes = await app.inject({
      method: 'POST',
      url: '/credit-notes',
      payload: {
        linkedInvoiceId: invoice.id,
        issueDate: '2026-07-09',
        reason: 'Timeline credit',
        type: 'Partial',
        lineItems: [{ description: 'Adjustment', amount: 10 }],
      },
    });
    expect(creditNoteRes.statusCode).toBe(201);
    const creditNote = z.object({ id: z.string().uuid(), creditNoteNumber: z.string() }).parse(creditNoteRes.json());
    const creditNoteTimeline = timelineSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/timeline/credit_note/${creditNote.id}`,
        })
      ).json(),
    ).events;
    expect(creditNoteTimeline).toHaveLength(1);
    expect(creditNoteTimeline[0]?.eventKey).toBe('credit_note.created');
    expect(JSON.parse(creditNoteTimeline[0]?.eventPayload ?? '{}')).toMatchObject({
      creditNoteNumber: creditNote.creditNoteNumber,
    });
    const failedCreditNoteRes = await app.inject({
      method: 'POST',
      url: '/credit-notes',
      payload: {
        linkedInvoiceId: invoice.id,
        issueDate: '2026-07-10',
        reason: 'Too large',
        type: 'Partial',
        adjustmentAmount: 1_000_000,
      },
    });
    expect(failedCreditNoteRes.statusCode).toBe(409);
    expect(
      raw
        .prepare(`SELECT count(1) AS total FROM timeline_events WHERE entity_type = 'credit_note' AND entity_id = ?`)
        .get(creditNote.id),
    ).toMatchObject({ total: 1 });

    const customerPaymentRes = await app.inject({
      method: 'POST',
      url: '/payments',
      payload: {
        customerId: customer.id,
        paymentDate: '2026-07-10',
        paymentMethod: 'Bank Transfer',
        reference: 'TL-PAY-1',
        amount: 20,
        allocations: [{ invoiceId: invoice.id, amount: 20 }],
      },
    });
    expect(customerPaymentRes.statusCode).toBe(201);
    const customerPayment = z.object({ id: z.string().uuid(), paymentNumber: z.string() }).parse(customerPaymentRes.json());
    const customerPaymentTimeline = timelineSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/timeline/payment/${customerPayment.id}`,
        })
      ).json(),
    ).events;
    expect(customerPaymentTimeline.map((event) => event.eventKey)).toEqual(['payment.created', 'payment.allocated']);
    expect(JSON.parse(customerPaymentTimeline[0]?.eventPayload ?? '{}')).toMatchObject({
      paymentNumber: customerPayment.paymentNumber,
    });
    const failedCustomerPaymentRes = await app.inject({
      method: 'POST',
      url: '/payments',
      payload: {
        customerId: customer.id,
        paymentDate: '2026-07-11',
        paymentMethod: 'Card',
        reference: 'TL-PAY-FAIL',
        amount: 20,
        allocations: [
          { invoiceId: invoice.id, amount: 10 },
          { invoiceId: invoice.id, amount: 10 },
        ],
      },
    });
    expect(failedCustomerPaymentRes.statusCode).toBe(409);
    expect(
      raw.prepare(`SELECT count(1) AS total FROM timeline_events WHERE entity_type = 'payment'`).get(),
    ).toMatchObject({ total: 2 });

    const purchaseOrderRes = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      payload: {
        supplierId: supplier.id,
        issueDate: '2026-07-10',
        expectedDeliveryDate: '2026-07-25',
        supplierReference: 'TL-PO-1',
        currency: 'AUD',
        lineItems: [{ description: 'PO line', quantity: 1, unitPrice: 100, gstApplicable: true }],
      },
    });
    expect(purchaseOrderRes.statusCode).toBe(201);
    const purchaseOrder = z
      .object({ id: z.string().uuid(), purchaseOrderNumber: z.string() })
      .parse(purchaseOrderRes.json());
    const approvePoRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${purchaseOrder.id}/approve`,
    });
    expect(approvePoRes.statusCode).toBe(200);
    const duplicateApprovePoRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${purchaseOrder.id}/approve`,
    });
    expect(duplicateApprovePoRes.statusCode).toBe(409);
    const purchaseOrderTimeline = timelineSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/timeline/purchase_order/${purchaseOrder.id}`,
        })
      ).json(),
    ).events;
    expect(purchaseOrderTimeline.map((event) => event.eventKey)).toEqual([
      'purchase_order.created',
      'purchase_order.approved',
    ]);
    expect(purchaseOrderTimeline.filter((event) => event.eventKey === 'purchase_order.approved')).toHaveLength(1);
    expect(JSON.parse(purchaseOrderTimeline[0]?.eventPayload ?? '{}')).toMatchObject({
      purchaseOrderNumber: purchaseOrder.purchaseOrderNumber,
    });

    const supplierBillRes = await app.inject({
      method: 'POST',
      url: '/supplier-bills',
      payload: {
        supplierId: supplier.id,
        billDate: '2026-07-11',
        dueDate: '2026-07-27',
        supplierReference: 'TL-BILL-1',
        currency: 'AUD',
        lineItems: [{ description: 'Bill line', quantity: 1, unitPrice: 110, gstApplicable: true }],
      },
    });
    expect(supplierBillRes.statusCode).toBe(201);
    const supplierBill = z.object({ id: z.string().uuid() }).parse(supplierBillRes.json());
    const finaliseSupplierBillRes = await app.inject({
      method: 'POST',
      url: `/supplier-bills/${supplierBill.id}/finalise`,
    });
    expect(finaliseSupplierBillRes.statusCode).toBe(200);
    const supplierBillFinalised = z.object({ billNumber: z.string() }).parse(finaliseSupplierBillRes.json());
    const duplicateSupplierBillFinaliseRes = await app.inject({
      method: 'POST',
      url: `/supplier-bills/${supplierBill.id}/finalise`,
    });
    expect(duplicateSupplierBillFinaliseRes.statusCode).toBe(409);
    const supplierBillTimeline = timelineSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/timeline/supplier_bill/${supplierBill.id}`,
        })
      ).json(),
    ).events;
    expect(supplierBillTimeline.map((event) => event.eventKey)).toEqual([
      'supplier_bill.created',
      'supplier_bill.finalised',
    ]);
    expect(supplierBillTimeline.filter((event) => event.eventKey === 'supplier_bill.finalised')).toHaveLength(1);
    expect(JSON.parse(supplierBillTimeline[1]?.eventPayload ?? '{}')).toMatchObject({
      billNumber: supplierBillFinalised.billNumber,
    });

    const supplierPaymentRes = await app.inject({
      method: 'POST',
      url: '/supplier-payments',
      payload: {
        supplierId: supplier.id,
        paymentDate: '2026-07-12',
        paymentMethod: 'Bank Transfer',
        reference: 'TL-SPAY-1',
        amount: 30,
        allocations: [{ supplierBillId: supplierBill.id, amount: 30 }],
      },
    });
    expect(supplierPaymentRes.statusCode).toBe(201);
    const supplierPayment = z.object({ id: z.string().uuid(), paymentNumber: z.string() }).parse(supplierPaymentRes.json());
    const supplierPaymentTimeline = timelineSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/timeline/supplier_payment/${supplierPayment.id}`,
        })
      ).json(),
    ).events;
    expect(supplierPaymentTimeline.map((event) => event.eventKey)).toEqual([
      'supplier_payment.created',
      'supplier_payment.allocated',
    ]);
    expect(JSON.parse(supplierPaymentTimeline[0]?.eventPayload ?? '{}')).toMatchObject({
      paymentNumber: supplierPayment.paymentNumber,
    });
    const failedSupplierPaymentRes = await app.inject({
      method: 'POST',
      url: '/supplier-payments',
      payload: {
        supplierId: supplier.id,
        paymentDate: '2026-07-12',
        paymentMethod: 'Bank Transfer',
        reference: 'TL-SPAY-FAIL',
        amount: 10,
        allocations: [
          { supplierBillId: supplierBill.id, amount: 5 },
          { supplierBillId: supplierBill.id, amount: 5 },
        ],
      },
    });
    expect(failedSupplierPaymentRes.statusCode).toBe(409);
    expect(
      raw.prepare(`SELECT count(1) AS total FROM timeline_events WHERE entity_type = 'supplier_payment'`).get(),
    ).toMatchObject({ total: 2 });

    for (const timeline of [
      invoiceTimeline.events,
      creditNoteTimeline,
      customerPaymentTimeline,
      purchaseOrderTimeline,
      supplierBillTimeline,
      supplierPaymentTimeline,
    ]) {
      assertOrdered(timeline);
      for (const event of timeline) {
        expect(event.entityId).toBeTruthy();
        expect(event.entityType).toBeTruthy();
        expect(event.createdAt).toBeTruthy();
      }
    }

    raw.close();
    await app.close();
  });

  it('keeps stable event counts and deterministic ordering under concurrent operations', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-business-os-timeline-concurrent-'));
    createdDirs.push(tempDir);
    const dbPath = join(tempDir, 'timeline-concurrent.sqlite');
    const app = await buildApp({ dbPath });
    const raw = new Database(dbPath);

    const customerRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Concurrent Timeline Customer' },
    });
    const supplierRes = await app.inject({
      method: 'POST',
      url: '/suppliers',
      payload: { displayName: 'Concurrent Timeline Supplier' },
    });
    const customer = idSchema.parse(customerRes.json());
    const supplier = idSchema.parse(supplierRes.json());

    const invoiceDraftResponses = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/invoices',
          payload: {
            customerId: customer.id,
            title: `Concurrent Invoice ${index + 1}`,
            issueDate: '2026-07-12',
            dueDate: '2026-07-28',
            lineItems: [{ description: 'Concurrent', quantity: 1, unitPrice: 100, gstApplicable: true }],
          },
        }),
      ),
    );
    for (const response of invoiceDraftResponses) {
      expect(response.statusCode).toBe(201);
    }
    const invoiceIds = invoiceDraftResponses.map((response) => idSchema.parse(response.json()).id);

    const invoiceFinaliseResponses = await Promise.all(
      invoiceIds.map((invoiceId) => app.inject({ method: 'POST', url: `/invoices/${invoiceId}/finalise` })),
    );
    for (const response of invoiceFinaliseResponses) {
      expect(response.statusCode).toBe(200);
    }

    const supplierBillDraftResponses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/supplier-bills',
          payload: {
            supplierId: supplier.id,
            billDate: '2026-07-12',
            dueDate: '2026-07-28',
            supplierReference: `CON-BILL-${index + 1}`,
            currency: 'AUD',
            lineItems: [{ description: 'Concurrent bill', quantity: 1, unitPrice: 80, gstApplicable: true }],
          },
        }),
      ),
    );
    for (const response of supplierBillDraftResponses) {
      expect(response.statusCode).toBe(201);
    }
    const supplierBillIds = supplierBillDraftResponses.map((response) => idSchema.parse(response.json()).id);

    const supplierBillFinaliseResponses = await Promise.all(
      supplierBillIds.map((billId) => app.inject({ method: 'POST', url: `/supplier-bills/${billId}/finalise` })),
    );
    for (const response of supplierBillFinaliseResponses) {
      expect(response.statusCode).toBe(200);
    }

    const counts = raw
      .prepare(
        `SELECT
          sum(CASE WHEN event_key = 'invoice.draft_created' THEN 1 ELSE 0 END) AS invoice_draft_created,
          sum(CASE WHEN event_key = 'invoice.finalised' THEN 1 ELSE 0 END) AS invoice_finalised,
          sum(CASE WHEN event_key = 'supplier_bill.created' THEN 1 ELSE 0 END) AS supplier_bill_created,
          sum(CASE WHEN event_key = 'supplier_bill.finalised' THEN 1 ELSE 0 END) AS supplier_bill_finalised
         FROM timeline_events`,
      )
      .get() as {
      invoice_draft_created: number;
      invoice_finalised: number;
      supplier_bill_created: number;
      supplier_bill_finalised: number;
    };

    expect(counts.invoice_draft_created).toBe(12);
    expect(counts.invoice_finalised).toBe(12);
    expect(counts.supplier_bill_created).toBe(10);
    expect(counts.supplier_bill_finalised).toBe(10);

    const uniqueness = raw
      .prepare('SELECT count(1) AS total, count(distinct id) AS distinct_total FROM timeline_events')
      .get() as { total: number; distinct_total: number };
    expect(uniqueness.total).toBe(uniqueness.distinct_total);

    const sampleInvoiceTimeline = timelineSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/timeline/invoice/${invoiceIds[0]}`,
        })
      ).json(),
    ).events;
    assertOrdered(sampleInvoiceTimeline);
    expect(sampleInvoiceTimeline.map((event) => event.eventKey)).toEqual(['invoice.draft_created', 'invoice.finalised']);

    raw.close();
    await app.close();
  });
});
