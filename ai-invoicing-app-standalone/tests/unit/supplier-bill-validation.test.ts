import { describe, expect, it } from 'vitest';

import { createSupplierBillDraftSchema } from '../../src/domain/supplier-bills/validation.js';

describe('supplier bill validation', () => {
  it('accepts valid supplier bill draft payload', () => {
    const parsed = createSupplierBillDraftSchema.parse({
      supplierId: '550e8400-e29b-41d4-a716-446655440000',
      billDate: '2026-07-07',
      dueDate: '2026-07-14',
      currency: 'AUD',
      lineItems: [{ description: 'Material', quantity: 1, unitPrice: 10, gstApplicable: true }],
    });
    expect(parsed.lineItems.length).toBe(1);
  });

  it('rejects empty line items', () => {
    expect(() =>
      createSupplierBillDraftSchema.parse({
        supplierId: '550e8400-e29b-41d4-a716-446655440000',
        billDate: '2026-07-07',
        dueDate: '2026-07-14',
        currency: 'AUD',
        lineItems: [],
      }),
    ).toThrow();
  });
});
