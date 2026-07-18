import { describe, expect, it } from 'vitest';

import { generateInvoicePdfBuffer } from '../../src/services/pdf-service.js';

const baseInput = {
  invoice: {
    id: 'inv-1',
    customerId: 'cus-1',
    title: 'Scaffold hire',
    issueDate: '2026-07-18',
    dueDate: '2026-08-01',
    notes: 'Thanks for your business.',
    paymentTerms: 'Payment due within 14 days',
    invoiceNumber: 'INV-1001',
    status: 'Finalised' as const,
    paymentState: 'Awaiting Payment' as const,
    reminderState: 'None' as const,
    totals: { subtotal: 100, gstTotal: 10, total: 110 },
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  },
  lineItems: [
    {
      description: 'Tower section',
      quantity: 1,
      unitPrice: 100,
      gstApplicable: true,
    },
  ],
  customer: {
    id: 'cus-1',
    displayName: 'Site Co',
    email: 'site@example.com',
    phone: null,
    address: '9 Build St',
    abnTaxId: null,
    notes: null,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  },
};

describe('invoice PDF business identity', () => {
  it('generates a valid PDF when a complete Aleya business profile is supplied', async () => {
    const withProfile = await generateInvoicePdfBuffer({
      ...baseInput,
      businessProfile: {
        id: 'business-profile',
        companyName: 'Quantum Hire Services',
        legalName: 'Quantum Hire Services Pty Ltd',
        abnTaxId: '12345678901',
        address: '1 Scaffold Way Sydney',
        email: 'accounts@quantum.example',
        phone: '0400000000',
        logoReference: null,
        primaryColor: '#173f35',
        secondaryColor: '#c4f36b',
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
    });
    const withoutProfile = await generateInvoicePdfBuffer({
      ...baseInput,
      businessProfile: null,
    });

    expect(withProfile.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(withoutProfile.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(withProfile.length).toBeGreaterThan(800);
    // Profile-backed PDFs include ABN/payment/footer blocks and are larger than empty-profile stubs.
    expect(withProfile.length).toBeGreaterThan(withoutProfile.length);
  });
});
