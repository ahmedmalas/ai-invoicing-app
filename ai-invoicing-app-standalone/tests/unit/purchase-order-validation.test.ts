import { describe, expect, it } from 'vitest';

import {
  closePurchaseOrderSchema,
  createPurchaseOrderDraftSchema,
  createSupplierBillFromPurchaseOrderSchema,
} from '../../src/domain/purchase-orders/validation.js';

describe('purchase order validation', () => {
  it('accepts valid purchase order draft payload', () => {
    const parsed = createPurchaseOrderDraftSchema.parse({
      supplierId: '550e8400-e29b-41d4-a716-446655440000',
      issueDate: '2026-07-07',
      expectedDeliveryDate: '2026-07-14',
      currency: 'AUD',
      lineItems: [{ description: 'Material', quantity: 1, unitPrice: 10, gstApplicable: true }],
    });
    expect(parsed.lineItems.length).toBe(1);
  });

  it('rejects empty line items', () => {
    expect(() =>
      createPurchaseOrderDraftSchema.parse({
        supplierId: '550e8400-e29b-41d4-a716-446655440000',
        issueDate: '2026-07-07',
        currency: 'AUD',
        lineItems: [],
      }),
    ).toThrow();
  });

  it('accepts valid partial conversion payload', () => {
    const parsed = createSupplierBillFromPurchaseOrderSchema.parse({
      lineItems: [{ purchaseOrderLineItemId: '550e8400-e29b-41d4-a716-446655440010', quantity: 1.5 }],
    });
    expect(parsed.lineItems?.[0]?.quantity).toBe(1.5);
  });

  it('rejects non-positive partial conversion quantities', () => {
    expect(() =>
      createSupplierBillFromPurchaseOrderSchema.parse({
        lineItems: [{ purchaseOrderLineItemId: '550e8400-e29b-41d4-a716-446655440010', quantity: 0 }],
      }),
    ).toThrow();
  });

  it('accepts valid close payload with reason and date', () => {
    const parsed = closePurchaseOrderSchema.parse({
      closeReason: 'Supplier ceased operation',
      closedDate: '2026-07-08',
      closedBy: 'system',
    });
    expect(parsed.closedDate).toBe('2026-07-08');
  });

  it('rejects invalid close date', () => {
    expect(() =>
      closePurchaseOrderSchema.parse({
        closeReason: 'Invalid date',
        closedDate: '2026-13-99',
      }),
    ).toThrow();
  });
});
