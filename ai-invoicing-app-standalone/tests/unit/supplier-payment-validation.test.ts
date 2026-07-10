import { describe, expect, it } from 'vitest';

import { createSupplierPaymentSchema } from '../../src/domain/supplier-payments/validation.js';

describe('supplier payment validation', () => {
  it('accepts valid supplier payment allocations', () => {
    const parsed = createSupplierPaymentSchema.parse({
      supplierId: '550e8400-e29b-41d4-a716-446655440000',
      paymentDate: '2026-07-07',
      paymentMethod: 'Bank Transfer',
      reference: 'SPAY-001',
      amount: 100,
      allocations: [{ supplierBillId: '550e8400-e29b-41d4-a716-446655440001', amount: 100 }],
    });
    expect(parsed.allocations.length).toBe(1);
  });

  it('rejects allocation totals above payment amount', () => {
    expect(() =>
      createSupplierPaymentSchema.parse({
        supplierId: '550e8400-e29b-41d4-a716-446655440000',
        paymentDate: '2026-07-07',
        paymentMethod: 'Card',
        reference: 'SPAY-002',
        amount: 50,
        allocations: [{ supplierBillId: '550e8400-e29b-41d4-a716-446655440001', amount: 51 }],
      }),
    ).toThrow('allocation total must be less than or equal to payment amount');
  });
});
