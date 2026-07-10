import { describe, expect, it } from 'vitest';

import { createCustomerPaymentSchema } from '../../src/domain/payments/validation.js';

describe('payment validation', () => {
  it('accepts valid payment allocations', () => {
    const parsed = createCustomerPaymentSchema.parse({
      customerId: '550e8400-e29b-41d4-a716-446655440000',
      paymentDate: '2026-07-07',
      paymentMethod: 'Bank Transfer',
      reference: 'PMT-001',
      amount: 150,
      allocations: [
        { invoiceId: '550e8400-e29b-41d4-a716-446655440001', amount: 100 },
        { invoiceId: '550e8400-e29b-41d4-a716-446655440002', amount: 50 },
      ],
    });
    expect(parsed.allocations.length).toBe(2);
  });

  it('rejects allocations above payment amount', () => {
    expect(() =>
      createCustomerPaymentSchema.parse({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        paymentDate: '2026-07-07',
        paymentMethod: 'Card',
        reference: 'PMT-002',
        amount: 100,
        allocations: [{ invoiceId: '550e8400-e29b-41d4-a716-446655440001', amount: 101 }],
      }),
    ).toThrow('allocation total must be less than or equal to payment amount');
  });
});
