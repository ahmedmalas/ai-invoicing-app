import { describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/db/database.js';

describe('database branch coverage', () => {
  it('covers error and sequence branches', () => {
    const db = createDatabase(':memory:');

    expect(db.getBusinessProfile()).toBeNull();
    expect(db.getPreference('invoice')).toBeNull();

    db.upsertPreference('invoice', { defaultTerms: '14 days' });
    expect(db.getPreference('invoice')).toEqual({ defaultTerms: '14 days' });

    expect(() =>
      db.updateCustomer('00000000-0000-0000-0000-000000000000', {
        displayName: 'Missing',
      }),
    ).toThrow('Customer not found');

    expect(() =>
      db.createInvoiceDraft({
        customerId: '00000000-0000-0000-0000-000000000000',
        title: 'Invalid',
        issueDate: '2026-07-06',
        dueDate: '2026-07-07',
        lineItems: [{ description: 'x', quantity: 1, unitPrice: 1, gstApplicable: false }],
      }),
    ).toThrow('Customer not found');

    const customer = db.createCustomer({ displayName: 'Sequence Customer' });

    const first = db.createInvoiceDraft({
      customerId: customer.id,
      title: 'First',
      issueDate: '2026-07-06',
      dueDate: '2026-07-07',
      lineItems: [{ description: 'a', quantity: 1, unitPrice: 100, gstApplicable: true }],
    });
    db.finaliseInvoice(first.id);

    const second = db.createInvoiceDraft({
      customerId: customer.id,
      title: 'Second',
      issueDate: '2026-07-06',
      dueDate: '2026-07-07',
      lineItems: [{ description: 'b', quantity: 1, unitPrice: 100, gstApplicable: true }],
    });
    const secondFinal = db.finaliseInvoice(second.id);
    expect(secondFinal.invoiceNumber).toMatch(/^INV-\d{4}-000002$/);

    expect(() =>
      db.updateInvoiceDraft(second.id, {
        title: 'Illegal update',
        issueDate: '2026-07-06',
        dueDate: '2026-07-07',
        lineItems: [{ description: 'x', quantity: 1, unitPrice: 1, gstApplicable: false }],
        paymentState: 'Sent',
      }),
    ).toThrow('Only draft invoices can be edited');

    expect(() => db.finaliseInvoice(second.id)).toThrow('Invoice already finalised');
    expect(db.getInvoiceById('00000000-0000-0000-0000-000000000000')).toBeNull();

    db.close();
  });
});
