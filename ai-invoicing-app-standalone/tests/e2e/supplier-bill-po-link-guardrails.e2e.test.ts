import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

const supplierBillLineSchema = z.object({
  id: z.string().uuid(),
  sourcePurchaseOrderLineItemId: z.string().uuid().optional(),
  description: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  gstApplicable: z.boolean(),
});

const supplierBillSchema = z.object({
  id: z.string().uuid(),
  supplierId: z.string().uuid(),
  sourcePurchaseOrderId: z.string().uuid().nullable(),
  sourcePurchaseOrderNumber: z.string().nullable(),
  status: z.enum(['Draft', 'Finalised']),
  totals: z.object({ total: z.number() }),
  lineItems: z.array(supplierBillLineSchema).optional(),
});

const purchaseOrderSchema = z.object({
  id: z.string().uuid(),
  billingStatus: z.enum(['unbilled', 'partially_billed', 'fully_billed']),
  totalBilledAmount: z.number(),
  remainingUnbilledAmount: z.number(),
  totals: z.object({ total: z.number() }),
  lineItems: z.array(
    z.object({
      id: z.string().uuid().optional(),
      quantity: z.number(),
    }),
  ),
});

describe('supplier bill po-link guardrails e2e', () => {
  it('enforces immutable PO linkage and over-billing protections for linked draft bill edits', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const supplierRes = await app.inject({
      method: 'POST',
      url: '/suppliers',
      payload: { displayName: 'PO Link Supplier', email: 'po-link@example.com' },
    });
    expect(supplierRes.statusCode).toBe(201);
    const supplier = idSchema.parse(supplierRes.json());

    const poDraftRes = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      payload: {
        supplierId: supplier.id,
        issueDate: '2026-08-01',
        expectedDeliveryDate: '2026-08-10',
        currency: 'AUD',
        lineItems: [
          { description: 'Line A', quantity: 2, unitPrice: 50, gstApplicable: true },
          { description: 'Line B', quantity: 1, unitPrice: 100, gstApplicable: false },
        ],
      },
    });
    expect(poDraftRes.statusCode).toBe(201);
    const poDraft = z.object({ id: z.string().uuid() }).parse(poDraftRes.json());
    const poDraftDetailsRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${poDraft.id}`,
    });
    expect(poDraftDetailsRes.statusCode).toBe(200);
    const poDraftDetails = purchaseOrderSchema.parse(poDraftDetailsRes.json());
    const poLineAId = poDraftDetails.lineItems[0]?.id;
    const poLineBId = poDraftDetails.lineItems[1]?.id;
    if (!poLineAId || !poLineBId) {
      throw new Error('Expected purchase order line item ids');
    }

    const poApproveRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${poDraft.id}/approve`,
    });
    expect(poApproveRes.statusCode).toBe(200);

    const linkedBill1Res = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${poDraft.id}/create-supplier-bill`,
      payload: { lineItems: [{ purchaseOrderLineItemId: poLineAId, quantity: 1 }] },
    });
    expect(linkedBill1Res.statusCode).toBe(201);
    const linkedBill1 = supplierBillSchema.parse(linkedBill1Res.json());
    expect(linkedBill1.sourcePurchaseOrderId).toBe(poDraft.id);

    const linkedBill1DetailsRes = await app.inject({
      method: 'GET',
      url: `/supplier-bills/${linkedBill1.id}`,
    });
    expect(linkedBill1DetailsRes.statusCode).toBe(200);
    const linkedBill1Details = supplierBillSchema.parse(linkedBill1DetailsRes.json());
    const linkedBill1SourceLineId = linkedBill1Details.lineItems?.[0]?.sourcePurchaseOrderLineItemId;
    expect(linkedBill1SourceLineId).toBe(poLineAId);

    const mutateSupplierRes = await app.inject({
      method: 'PUT',
      url: `/supplier-bills/${linkedBill1.id}`,
      payload: {
        supplierId: '550e8400-e29b-41d4-a716-446655440099',
        billDate: '2026-08-01',
        dueDate: '2026-08-10',
        currency: 'AUD',
        lineItems: [
          {
            description: 'Line A',
            quantity: 1,
            unitPrice: 50,
            gstApplicable: true,
            sourcePurchaseOrderLineItemId: poLineAId,
          },
        ],
      },
    });
    expect(mutateSupplierRes.statusCode).toBe(400);

    const mutateSourcePoRes = await app.inject({
      method: 'PUT',
      url: `/supplier-bills/${linkedBill1.id}`,
      payload: {
        sourcePurchaseOrderId: '550e8400-e29b-41d4-a716-446655440099',
        billDate: '2026-08-01',
        dueDate: '2026-08-10',
        currency: 'AUD',
        lineItems: [
          {
            description: 'Line A',
            quantity: 1,
            unitPrice: 50,
            gstApplicable: true,
            sourcePurchaseOrderLineItemId: poLineAId,
          },
        ],
      },
    });
    expect(mutateSourcePoRes.statusCode).toBe(400);

    const missingSourceLineRes = await app.inject({
      method: 'PUT',
      url: `/supplier-bills/${linkedBill1.id}`,
      payload: {
        billDate: '2026-08-01',
        dueDate: '2026-08-10',
        currency: 'AUD',
        lineItems: [{ description: 'Line A', quantity: 1, unitPrice: 50, gstApplicable: true }],
      },
    });
    expect(missingSourceLineRes.statusCode).toBe(409);
    expect(missingSourceLineRes.json()).toMatchObject({ message: 'SUPPLIER_BILL_LINKED_LINE_SOURCE_REQUIRED' });

    const wrongSourceLineRes = await app.inject({
      method: 'PUT',
      url: `/supplier-bills/${linkedBill1.id}`,
      payload: {
        billDate: '2026-08-01',
        dueDate: '2026-08-10',
        currency: 'AUD',
        lineItems: [
          {
            description: 'Line A',
            quantity: 1,
            unitPrice: 50,
            gstApplicable: true,
            sourcePurchaseOrderLineItemId: '550e8400-e29b-41d4-a716-446655440088',
          },
        ],
      },
    });
    expect(wrongSourceLineRes.statusCode).toBe(409);
    expect(wrongSourceLineRes.json()).toMatchObject({ message: 'SUPPLIER_BILL_SOURCE_PO_LINE_MISMATCH' });

    const linkedBill2Res = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${poDraft.id}/create-supplier-bill`,
      payload: { lineItems: [{ purchaseOrderLineItemId: poLineAId, quantity: 1 }] },
    });
    expect(linkedBill2Res.statusCode).toBe(201);
    const linkedBill2 = supplierBillSchema.parse(linkedBill2Res.json());

    const overBillByEditRes = await app.inject({
      method: 'PUT',
      url: `/supplier-bills/${linkedBill1.id}`,
      payload: {
        billDate: '2026-08-01',
        dueDate: '2026-08-10',
        currency: 'AUD',
        lineItems: [
          {
            description: 'Line A',
            quantity: 1.5,
            unitPrice: 50,
            gstApplicable: true,
            sourcePurchaseOrderLineItemId: poLineAId,
          },
        ],
      },
    });
    expect(overBillByEditRes.statusCode).toBe(409);
    expect(overBillByEditRes.json()).toMatchObject({
      message: 'PURCHASE_ORDER_BILLING_QUANTITY_EXCEEDS_REMAINING',
    });

    const validLinkedEditRes = await app.inject({
      method: 'PUT',
      url: `/supplier-bills/${linkedBill1.id}`,
      payload: {
        billDate: '2026-08-01',
        dueDate: '2026-08-10',
        currency: 'AUD',
        lineItems: [
          {
            description: 'Line A',
            quantity: 0.5,
            unitPrice: 50,
            gstApplicable: true,
            sourcePurchaseOrderLineItemId: poLineAId,
          },
        ],
      },
    });
    expect(validLinkedEditRes.statusCode).toBe(200);
    const validLinkedEdit = supplierBillSchema.parse(validLinkedEditRes.json());
    expect(validLinkedEdit.sourcePurchaseOrderId).toBe(poDraft.id);

    const poAfterDraftEditRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${poDraft.id}`,
    });
    expect(poAfterDraftEditRes.statusCode).toBe(200);
    const poAfterDraftEdit = purchaseOrderSchema.parse(poAfterDraftEditRes.json());
    expect(poAfterDraftEdit.billingStatus).toBe('partially_billed');
    expect(poAfterDraftEdit.totalBilledAmount).toBeCloseTo(82.5, 6);

    const linkedBill3Res = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${poDraft.id}/create-supplier-bill`,
      payload: { lineItems: [{ purchaseOrderLineItemId: poLineBId, quantity: 1 }] },
    });
    expect(linkedBill3Res.statusCode).toBe(201);

    const finalTopUpEditRes = await app.inject({
      method: 'PUT',
      url: `/supplier-bills/${linkedBill2.id}`,
      payload: {
        billDate: '2026-08-01',
        dueDate: '2026-08-10',
        currency: 'AUD',
        lineItems: [
          {
            description: 'Line A',
            quantity: 1.5,
            unitPrice: 50,
            gstApplicable: true,
            sourcePurchaseOrderLineItemId: poLineAId,
          },
        ],
      },
    });
    expect(finalTopUpEditRes.statusCode).toBe(200);

    const poAfterMultiBillRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${poDraft.id}`,
    });
    expect(poAfterMultiBillRes.statusCode).toBe(200);
    const poAfterMultiBill = purchaseOrderSchema.parse(poAfterMultiBillRes.json());
    expect(poAfterMultiBill.billingStatus).toBe('fully_billed');
    expect(poAfterMultiBill.totalBilledAmount).toBeCloseTo(poAfterMultiBill.totals.total, 6);
    expect(poAfterMultiBill.remainingUnbilledAmount).toBeCloseTo(0, 6);

    const finaliseLinkedBillRes = await app.inject({
      method: 'POST',
      url: `/supplier-bills/${linkedBill2.id}/finalise`,
    });
    expect(finaliseLinkedBillRes.statusCode).toBe(200);

    const editFinalisedLinkedBillRes = await app.inject({
      method: 'PUT',
      url: `/supplier-bills/${linkedBill2.id}`,
      payload: {
        billDate: '2026-08-01',
        dueDate: '2026-08-10',
        currency: 'AUD',
        lineItems: [
          {
            description: 'Line A',
            quantity: 1,
            unitPrice: 50,
            gstApplicable: true,
            sourcePurchaseOrderLineItemId: poLineAId,
          },
        ],
      },
    });
    expect(editFinalisedLinkedBillRes.statusCode).toBe(409);

    const linkedSupplierBillHtmlRes = await app.inject({
      method: 'GET',
      url: `/supplier-bills/${linkedBill1.id}/html`,
    });
    expect(linkedSupplierBillHtmlRes.statusCode).toBe(200);
    expect(linkedSupplierBillHtmlRes.body).toContain('Source PO');

    const linkedSupplierBillPdfRes = await app.inject({
      method: 'GET',
      url: `/supplier-bills/${linkedBill1.id}/pdf`,
    });
    expect(linkedSupplierBillPdfRes.statusCode).toBe(200);
    expect(linkedSupplierBillPdfRes.headers['content-type']).toContain('application/pdf');

    const linkedPoHtmlRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${poDraft.id}/html`,
    });
    expect(linkedPoHtmlRes.statusCode).toBe(200);
    expect(linkedPoHtmlRes.body).toContain('Linked Supplier Bills');
    expect(linkedPoHtmlRes.body).toContain('Billing Status');

    const linkedPoPdfRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${poDraft.id}/pdf`,
    });
    expect(linkedPoPdfRes.statusCode).toBe(200);
    expect(linkedPoPdfRes.headers['content-type']).toContain('application/pdf');

    await app.close();
  });
});
