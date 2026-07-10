import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

const purchaseOrderSchema = z.object({
  id: z.string().uuid(),
  purchaseOrderNumber: z.string(),
  supplierId: z.string().uuid(),
  issueDate: z.string(),
  expectedDeliveryDate: z.string().nullable(),
  supplierReference: z.string().nullable(),
  currency: z.string(),
  status: z.enum(['Draft', 'Approved', 'Closed', 'Cancelled']),
  closeReason: z.string().nullable().optional(),
  closedDate: z.string().nullable().optional(),
  billingStatus: z.enum(['unbilled', 'partially_billed', 'fully_billed']),
  totalBilledAmount: z.number(),
  remainingUnbilledAmount: z.number(),
  totals: z.object({ total: z.number() }),
  lineItems: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        quantity: z.number(),
      }),
    )
    .optional(),
});

const supplierBillSchema = z.object({
  id: z.string().uuid(),
  supplierId: z.string().uuid(),
  sourcePurchaseOrderId: z.string().uuid().nullable(),
  sourcePurchaseOrderNumber: z.string().nullable(),
  status: z.enum(['Draft', 'Finalised']),
  totals: z.object({ total: z.number() }),
});

describe('purchase orders e2e', () => {
  it('supports purchase order lifecycle with immutable non-draft behavior', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const supplierRes = await app.inject({
      method: 'POST',
      url: '/suppliers',
      payload: { displayName: 'PO Supplier', email: 'po@example.com' },
    });
    expect(supplierRes.statusCode).toBe(201);
    const supplier = idSchema.parse(supplierRes.json());

    const invalidSupplierRes = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      payload: {
        supplierId: '550e8400-e29b-41d4-a716-446655440099',
        issueDate: '2026-07-07',
        currency: 'AUD',
        lineItems: [{ description: 'Invalid supplier item', quantity: 1, unitPrice: 10, gstApplicable: true }],
      },
    });
    expect(invalidSupplierRes.statusCode).toBe(404);

    const emptyOrderRes = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      payload: {
        supplierId: supplier.id,
        issueDate: '2026-07-07',
        currency: 'AUD',
        lineItems: [],
      },
    });
    expect(emptyOrderRes.statusCode).toBe(400);

    const negativeQtyRes = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      payload: {
        supplierId: supplier.id,
        issueDate: '2026-07-07',
        currency: 'AUD',
        lineItems: [{ description: 'Invalid qty', quantity: -1, unitPrice: 10, gstApplicable: true }],
      },
    });
    expect(negativeQtyRes.statusCode).toBe(400);

    const draftPoRes = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      payload: {
        supplierId: supplier.id,
        issueDate: '2026-07-08',
        expectedDeliveryDate: '2026-07-20',
        supplierReference: 'PO-REF-1',
        currency: 'AUD',
        notes: 'Initial draft',
        lineItems: [{ description: 'Materials', quantity: 2, unitPrice: 50, gstApplicable: true }],
      },
    });
    expect(draftPoRes.statusCode).toBe(201);
    const draftPo = purchaseOrderSchema.parse(draftPoRes.json());
    expect(draftPo.status).toBe('Draft');

    const closeDraftRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${draftPo.id}/close`,
      payload: { closeReason: 'Draft should not close', closedDate: '2026-07-29' },
    });
    expect(closeDraftRes.statusCode).toBe(409);
    expect(closeDraftRes.json()).toMatchObject({
      message: 'PURCHASE_ORDER_DRAFT_CANNOT_CLOSE',
    });

    const updatedDraftRes = await app.inject({
      method: 'PUT',
      url: `/purchase-orders/${draftPo.id}`,
      payload: {
        issueDate: '2026-07-09',
        expectedDeliveryDate: '2026-07-22',
        supplierReference: 'PO-REF-1',
        currency: 'AUD',
        notes: 'Updated draft',
        lineItems: [
          { description: 'Materials', quantity: 2, unitPrice: 55, gstApplicable: true },
          { description: 'Delivery', quantity: 1, unitPrice: 10, gstApplicable: false },
        ],
      },
    });
    expect(updatedDraftRes.statusCode).toBe(200);
    const updatedDraft = purchaseOrderSchema.parse(updatedDraftRes.json());
    expect(updatedDraft.status).toBe('Draft');
    const updatedDraftDetailsRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${draftPo.id}`,
    });
    expect(updatedDraftDetailsRes.statusCode).toBe(200);
    const updatedDraftDetails = purchaseOrderSchema.parse(updatedDraftDetailsRes.json());
    const poLineAId = updatedDraftDetails.lineItems?.[0]?.id;
    const poLineBId = updatedDraftDetails.lineItems?.[1]?.id;
    if (!poLineAId || !poLineBId) {
      throw new Error('Expected purchase order line item ids');
    }

    const approveRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${draftPo.id}/approve`,
    });
    expect(approveRes.statusCode).toBe(200);
    const approvedPo = purchaseOrderSchema.parse(approveRes.json());
    expect(approvedPo.status).toBe('Approved');
    expect(approvedPo.billingStatus).toBe('unbilled');
    expect(approvedPo.totalBilledAmount).toBe(0);
    expect(approvedPo.remainingUnbilledAmount).toBe(approvedPo.totals.total);

    const createBillFromApprovedRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${draftPo.id}/create-supplier-bill`,
      payload: {
        lineItems: [{ purchaseOrderLineItemId: poLineAId, quantity: 1 }],
      },
    });
    expect(createBillFromApprovedRes.statusCode).toBe(201);
    const createdBillFromPo = supplierBillSchema.parse(createBillFromApprovedRes.json());
    expect(createdBillFromPo.supplierId).toBe(supplier.id);
    expect(createdBillFromPo.sourcePurchaseOrderId).toBe(draftPo.id);
    expect(createdBillFromPo.status).toBe('Draft');
    expect(createdBillFromPo.totals.total).toBeLessThan(approvedPo.totals.total);

    const overQuantityCreateBillRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${draftPo.id}/create-supplier-bill`,
      payload: {
        lineItems: [{ purchaseOrderLineItemId: poLineAId, quantity: 99 }],
      },
    });
    expect(overQuantityCreateBillRes.statusCode).toBe(409);
    expect(overQuantityCreateBillRes.json()).toMatchObject({
      message: 'PURCHASE_ORDER_BILLING_QUANTITY_EXCEEDS_REMAINING',
    });

    const poAfterPartialRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${draftPo.id}`,
    });
    expect(poAfterPartialRes.statusCode).toBe(200);
    const poAfterPartial = purchaseOrderSchema.parse(poAfterPartialRes.json());
    expect(poAfterPartial.billingStatus).toBe('partially_billed');
    expect(poAfterPartial.totalBilledAmount).toBeGreaterThan(0);
    expect(poAfterPartial.remainingUnbilledAmount).toBeGreaterThan(0);

    const createSecondBillRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${draftPo.id}/create-supplier-bill`,
      payload: {
        lineItems: [
          { purchaseOrderLineItemId: poLineAId, quantity: 1 },
          { purchaseOrderLineItemId: poLineBId, quantity: 1 },
        ],
      },
    });
    expect(createSecondBillRes.statusCode).toBe(201);
    const secondBillFromPo = supplierBillSchema.parse(createSecondBillRes.json());
    expect(secondBillFromPo.sourcePurchaseOrderId).toBe(draftPo.id);

    const poAfterFullRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${draftPo.id}`,
    });
    expect(poAfterFullRes.statusCode).toBe(200);
    const poAfterFull = purchaseOrderSchema.parse(poAfterFullRes.json());
    expect(poAfterFull.billingStatus).toBe('fully_billed');
    expect(poAfterFull.remainingUnbilledAmount).toBe(0);
    expect(poAfterFull.totalBilledAmount).toBe(poAfterFull.totals.total);

    const duplicateCreateBillRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${draftPo.id}/create-supplier-bill`,
    });
    expect(duplicateCreateBillRes.statusCode).toBe(409);
    expect(duplicateCreateBillRes.json()).toMatchObject({
      message: 'PURCHASE_ORDER_SUPPLIER_BILL_ALREADY_CREATED',
    });

    const bySourcePoRes = await app.inject({
      method: 'GET',
      url: `/supplier-bills?sourcePurchaseOrderId=${draftPo.id}`,
    });
    expect(bySourcePoRes.statusCode).toBe(200);
    const bySourcePo = z.object({ bills: z.array(supplierBillSchema) }).parse(bySourcePoRes.json());
    expect(bySourcePo.bills.map((bill) => bill.id)).toContain(createdBillFromPo.id);
    expect(bySourcePo.bills.map((bill) => bill.id)).toContain(secondBillFromPo.id);

    const linkedBillHtmlRes = await app.inject({
      method: 'GET',
      url: `/supplier-bills/${createdBillFromPo.id}/html`,
    });
    expect(linkedBillHtmlRes.statusCode).toBe(200);
    expect(linkedBillHtmlRes.body).toContain('Source PO');
    expect(linkedBillHtmlRes.body).toContain(approvedPo.purchaseOrderNumber);

    const immutableAfterApproveRes = await app.inject({
      method: 'PUT',
      url: `/purchase-orders/${draftPo.id}`,
      payload: {
        issueDate: '2026-07-10',
        expectedDeliveryDate: '2026-07-25',
        supplierReference: 'PO-REF-UPDATED',
        currency: 'AUD',
        notes: 'Should not save',
        lineItems: [{ description: 'Changed', quantity: 1, unitPrice: 99, gstApplicable: true }],
      },
    });
    expect(immutableAfterApproveRes.statusCode).toBe(409);

    const closeRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${draftPo.id}/close`,
    });
    expect(closeRes.statusCode).toBe(200);
    const closedPo = purchaseOrderSchema.parse(closeRes.json());
    expect(closedPo.status).toBe('Closed');
    expect(closedPo.closeReason).toBeNull();

    const modifyClosedRes = await app.inject({
      method: 'PUT',
      url: `/purchase-orders/${draftPo.id}`,
      payload: {
        issueDate: '2026-07-11',
        currency: 'AUD',
        lineItems: [{ description: 'Closed edit', quantity: 1, unitPrice: 1, gstApplicable: true }],
      },
    });
    expect(modifyClosedRes.statusCode).toBe(409);

    const cancellablePoRes = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      payload: {
        supplierId: supplier.id,
        issueDate: '2026-07-12',
        expectedDeliveryDate: '2026-07-24',
        supplierReference: 'PO-REF-2',
        currency: 'AUD',
        lineItems: [{ description: 'Cancelable line', quantity: 1, unitPrice: 20, gstApplicable: true }],
      },
    });
    expect(cancellablePoRes.statusCode).toBe(201);
    const cancellablePo = purchaseOrderSchema.parse(cancellablePoRes.json());

    const createBillFromDraftPoRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${cancellablePo.id}/create-supplier-bill`,
    });
    expect(createBillFromDraftPoRes.statusCode).toBe(409);
    expect(createBillFromDraftPoRes.json()).toMatchObject({
      message: 'PURCHASE_ORDER_REQUIRES_APPROVED_STATUS',
    });

    const approveUnbilledClosePoRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${cancellablePo.id}/approve`,
    });
    expect(approveUnbilledClosePoRes.statusCode).toBe(200);

    const closeUnbilledWithoutReasonRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${cancellablePo.id}/close`,
    });
    expect(closeUnbilledWithoutReasonRes.statusCode).toBe(409);
    expect(closeUnbilledWithoutReasonRes.json()).toMatchObject({
      message: 'PURCHASE_ORDER_CLOSE_REASON_REQUIRED',
    });

    const closeUnbilledWithReasonRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${cancellablePo.id}/close`,
      payload: {
        closeReason: 'Order no longer required',
        closedDate: '2026-07-30',
      },
    });
    expect(closeUnbilledWithReasonRes.statusCode).toBe(200);
    const unbilledClosedPo = purchaseOrderSchema.parse(closeUnbilledWithReasonRes.json());
    expect(unbilledClosedPo.closeReason).toBe('Order no longer required');
    expect(unbilledClosedPo.closedDate).toBe('2026-07-30');

    const unbilledClosedHtmlRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${unbilledClosedPo.id}/html`,
    });
    expect(unbilledClosedHtmlRes.statusCode).toBe(200);
    expect(unbilledClosedHtmlRes.body).toContain('Close Reason');
    expect(unbilledClosedHtmlRes.body).toContain('Order no longer required');

    const unbilledClosedPdfRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${unbilledClosedPo.id}/pdf`,
    });
    expect(unbilledClosedPdfRes.statusCode).toBe(200);
    expect(unbilledClosedPdfRes.headers['content-type']).toContain('application/pdf');
    const unbilledTimelineRes = await app.inject({
      method: 'GET',
      url: `/timeline/purchase_order/${unbilledClosedPo.id}`,
    });
    expect(unbilledTimelineRes.statusCode).toBe(200);
    const unbilledTimeline = z
      .object({ events: z.array(z.object({ eventKey: z.string(), eventPayload: z.string().optional() })) })
      .parse(unbilledTimelineRes.json());
    const unbilledClosedEvent = unbilledTimeline.events.find((event) => event.eventKey === 'purchase_order.closed');
    expect(unbilledClosedEvent).toBeTruthy();
    const unbilledClosedEventPayload = JSON.parse(unbilledClosedEvent?.eventPayload ?? '{}') as { closureType?: string };
    expect(unbilledClosedEventPayload.closureType).toBe('unbilled_closure');

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${unbilledClosedPo.id}/cancel`,
    });
    expect(cancelRes.statusCode).toBe(409);

    const cancellablePo2Res = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      payload: {
        supplierId: supplier.id,
        issueDate: '2026-07-13',
        expectedDeliveryDate: '2026-07-24',
        supplierReference: 'PO-REF-2B',
        currency: 'AUD',
        lineItems: [{ description: 'Cancelable line 2', quantity: 1, unitPrice: 20, gstApplicable: true }],
      },
    });
    expect(cancellablePo2Res.statusCode).toBe(201);
    const cancellablePo2 = purchaseOrderSchema.parse(cancellablePo2Res.json());

    const cancelRes2 = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${cancellablePo2.id}/cancel`,
    });
    expect(cancelRes2.statusCode).toBe(200);
    const cancelledPo = purchaseOrderSchema.parse(cancelRes2.json());
    expect(cancelledPo.status).toBe('Cancelled');

    const closeCancelledRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${cancelledPo.id}/close`,
      payload: {
        closeReason: 'Should fail',
        closedDate: '2026-07-30',
      },
    });
    expect(closeCancelledRes.statusCode).toBe(409);
    expect(closeCancelledRes.json()).toMatchObject({
      message: 'PURCHASE_ORDER_CANCELLED_CANNOT_CLOSE',
    });

    const createBillFromCancelledPoRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${cancellablePo.id}/create-supplier-bill`,
    });
    expect(createBillFromCancelledPoRes.statusCode).toBe(409);
    expect(createBillFromCancelledPoRes.json()).toMatchObject({
      message: 'PURCHASE_ORDER_REQUIRES_APPROVED_STATUS',
    });

    const approveCancelledRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${cancelledPo.id}/approve`,
    });
    expect(approveCancelledRes.statusCode).toBe(409);
    expect(approveCancelledRes.json()).toMatchObject({
      message: 'INVALID_PURCHASE_ORDER_STATUS_TRANSITION',
    });

    const bySupplierRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders?supplierId=${supplier.id}`,
    });
    expect(bySupplierRes.statusCode).toBe(200);
    const bySupplier = z.object({ purchaseOrders: z.array(purchaseOrderSchema) }).parse(bySupplierRes.json());
    expect(bySupplier.purchaseOrders.some((po) => po.id === draftPo.id)).toBe(true);

    const byStatusRes = await app.inject({
      method: 'GET',
      url: '/purchase-orders?billingStatus=fully_billed',
    });
    expect(byStatusRes.statusCode).toBe(200);
    const byStatus = z.object({ purchaseOrders: z.array(purchaseOrderSchema) }).parse(byStatusRes.json());
    expect(byStatus.purchaseOrders.some((po) => po.id === draftPo.id)).toBe(true);

    const byNumberRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders?purchaseOrderNumber=${approvedPo.purchaseOrderNumber}`,
    });
    expect(byNumberRes.statusCode).toBe(200);
    const byNumber = z.object({ purchaseOrders: z.array(purchaseOrderSchema) }).parse(byNumberRes.json());
    expect(byNumber.purchaseOrders.map((po) => po.id)).toContain(draftPo.id);

    const byExpectedDeliveryRes = await app.inject({
      method: 'GET',
      url: '/purchase-orders?fromExpectedDeliveryDate=2026-07-21&toExpectedDeliveryDate=2026-07-25',
    });
    expect(byExpectedDeliveryRes.statusCode).toBe(200);
    const byExpectedDelivery = z
      .object({ purchaseOrders: z.array(purchaseOrderSchema) })
      .parse(byExpectedDeliveryRes.json());
    expect(byExpectedDelivery.purchaseOrders.some((po) => po.id === draftPo.id)).toBe(true);

    const htmlRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${draftPo.id}/html`,
    });
    expect(htmlRes.statusCode).toBe(200);
    expect(htmlRes.headers['content-type']).toContain('text/html');
    expect(htmlRes.body).toContain('Purchase Order');
    expect(htmlRes.body).toContain('Billing Status');
    expect(htmlRes.body).toContain('Linked Supplier Bills');

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${draftPo.id}/pdf`,
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.body.length).toBeGreaterThan(1000);

    const approvedTimelineRes = await app.inject({
      method: 'GET',
      url: `/timeline/purchase_order/${draftPo.id}`,
    });
    expect(approvedTimelineRes.statusCode).toBe(200);
    const approvedTimeline = z
      .object(
        { events: z.array(z.object({ eventKey: z.string(), eventPayload: z.string().optional() })) },
      )
      .parse(approvedTimelineRes.json());
    expect(approvedTimeline.events.some((event) => event.eventKey === 'purchase_order.created')).toBe(true);
    expect(approvedTimeline.events.some((event) => event.eventKey === 'purchase_order.approved')).toBe(true);
    expect(approvedTimeline.events.some((event) => event.eventKey === 'purchase_order.partially_billed')).toBe(true);
    expect(approvedTimeline.events.some((event) => event.eventKey === 'purchase_order.fully_billed')).toBe(true);
    const closedEvent = approvedTimeline.events.find((event) => event.eventKey === 'purchase_order.closed');
    expect(closedEvent).toBeTruthy();
    const closedEventPayload = JSON.parse(closedEvent?.eventPayload ?? '{}') as { closureType?: string };
    expect(closedEventPayload.closureType).toBe('fully_billed_closure');
    const supplierBillTimelineRes = await app.inject({
      method: 'GET',
      url: `/timeline/supplier_bill/${createdBillFromPo.id}`,
    });
    expect(supplierBillTimelineRes.statusCode).toBe(200);
    const supplierBillTimeline = z
      .object({ events: z.array(z.object({ eventKey: z.string() })) })
      .parse(supplierBillTimelineRes.json());
    expect(
      supplierBillTimeline.events.some((event) => event.eventKey === 'supplier_bill.created_from_purchase_order'),
    ).toBe(true);

    const cancelledTimelineRes = await app.inject({
      method: 'GET',
      url: `/timeline/purchase_order/${cancelledPo.id}`,
    });
    expect(cancelledTimelineRes.statusCode).toBe(200);
    const cancelledTimeline = z
      .object({ events: z.array(z.object({ eventKey: z.string(), eventPayload: z.string().optional() })) })
      .parse(cancelledTimelineRes.json());
    expect(cancelledTimeline.events.some((event) => event.eventKey === 'purchase_order.cancelled')).toBe(true);

    const partialClosablePoRes = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      payload: {
        supplierId: supplier.id,
        issueDate: '2026-07-14',
        expectedDeliveryDate: '2026-07-27',
        supplierReference: 'PO-REF-4',
        currency: 'AUD',
        lineItems: [{ description: 'Partial close line', quantity: 2, unitPrice: 15, gstApplicable: true }],
      },
    });
    expect(partialClosablePoRes.statusCode).toBe(201);
    const partialClosablePo = purchaseOrderSchema.parse(partialClosablePoRes.json());
    const approvePartialClosablePoRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${partialClosablePo.id}/approve`,
    });
    expect(approvePartialClosablePoRes.statusCode).toBe(200);
    const partialClosableDetailsRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${partialClosablePo.id}`,
    });
    const partialClosableDetails = purchaseOrderSchema.parse(partialClosableDetailsRes.json());
    const partialLineId = partialClosableDetails.lineItems?.[0]?.id;
    if (!partialLineId) {
      throw new Error('Expected partial closable PO line id');
    }
    const partialBillCreateRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${partialClosablePo.id}/create-supplier-bill`,
      payload: {
        lineItems: [{ purchaseOrderLineItemId: partialLineId, quantity: 1 }],
      },
    });
    expect(partialBillCreateRes.statusCode).toBe(201);

    const closePartiallyBilledWithoutReasonRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${partialClosablePo.id}/close`,
    });
    expect(closePartiallyBilledWithoutReasonRes.statusCode).toBe(409);
    expect(closePartiallyBilledWithoutReasonRes.json()).toMatchObject({
      message: 'PURCHASE_ORDER_CLOSE_REASON_REQUIRED',
    });

    const closePartiallyBilledWithReasonRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${partialClosablePo.id}/close`,
      payload: {
        closeReason: 'Partial delivery accepted',
        closedDate: '2026-07-31',
      },
    });
    expect(closePartiallyBilledWithReasonRes.statusCode).toBe(200);
    const closedPartiallyBilledPo = purchaseOrderSchema.parse(closePartiallyBilledWithReasonRes.json());
    expect(closedPartiallyBilledPo.closeReason).toBe('Partial delivery accepted');
    const partiallyBilledTimelineRes = await app.inject({
      method: 'GET',
      url: `/timeline/purchase_order/${partialClosablePo.id}`,
    });
    expect(partiallyBilledTimelineRes.statusCode).toBe(200);
    const partiallyBilledTimeline = z
      .object({ events: z.array(z.object({ eventKey: z.string(), eventPayload: z.string().optional() })) })
      .parse(partiallyBilledTimelineRes.json());
    const partiallyClosedEvent = partiallyBilledTimeline.events.find((event) => event.eventKey === 'purchase_order.closed');
    expect(partiallyClosedEvent).toBeTruthy();
    const partiallyClosedEventPayload = JSON.parse(partiallyClosedEvent?.eventPayload ?? '{}') as {
      closureType?: string;
    };
    expect(partiallyClosedEventPayload.closureType).toBe('partially_billed_closure');

    const closablePoRes = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      payload: {
        supplierId: supplier.id,
        issueDate: '2026-07-13',
        expectedDeliveryDate: '2026-07-26',
        supplierReference: 'PO-REF-3',
        currency: 'AUD',
        lineItems: [{ description: 'Close-only line', quantity: 1, unitPrice: 10, gstApplicable: true }],
      },
    });
    expect(closablePoRes.statusCode).toBe(201);
    const closablePo = purchaseOrderSchema.parse(closablePoRes.json());
    const approveClosableRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${closablePo.id}/approve`,
    });
    expect(approveClosableRes.statusCode).toBe(200);
    const closeClosableRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${closablePo.id}/close`,
    });
    expect(closeClosableRes.statusCode).toBe(409);
    expect(closeClosableRes.json()).toMatchObject({
      message: 'PURCHASE_ORDER_CLOSE_REASON_REQUIRED',
    });
    const closeClosableWithReasonRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${closablePo.id}/close`,
      payload: {
        closeReason: 'No billing required',
        closedDate: '2026-07-31',
      },
    });
    expect(closeClosableWithReasonRes.statusCode).toBe(200);
    const closeClosableWithReason = purchaseOrderSchema.parse(closeClosableWithReasonRes.json());
    expect(closeClosableWithReason.closeReason).toBe('No billing required');
    const closeClosableAgainRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${closablePo.id}/close`,
      payload: {
        closeReason: 'Repeat close should fail',
        closedDate: '2026-07-31',
      },
    });
    expect(closeClosableAgainRes.statusCode).toBe(409);
    expect(closeClosableAgainRes.json()).toMatchObject({
      message: 'PURCHASE_ORDER_ALREADY_CLOSED',
    });
    const createBillFromClosedPoRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${closablePo.id}/create-supplier-bill`,
    });
    expect(createBillFromClosedPoRes.statusCode).toBe(409);
    expect(createBillFromClosedPoRes.json()).toMatchObject({
      message: 'PURCHASE_ORDER_REQUIRES_APPROVED_STATUS',
    });

    const searchRes = await app.inject({
      method: 'GET',
      url: `/search?q=${approvedPo.purchaseOrderNumber}`,
    });
    expect(searchRes.statusCode).toBe(200);
    const searchPayload = z
      .object({
        documents: z.array(z.object({ entityId: z.string() })),
      })
      .passthrough()
      .parse(searchRes.json());
    expect(searchPayload.documents.some((doc) => doc.entityId === draftPo.id)).toBe(true);

    await app.close();
  });
});
