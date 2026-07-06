import { describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/db/database.js';

describe('invoice flow integration', () => {
  it('creates, updates, finalises, snapshots and timelines an invoice', () => {
    const db = createDatabase(':memory:');

    const customer = db.createCustomer({
      displayName: 'Acme Pty Ltd',
      email: 'accounts@acme.test',
    });

    const draft = db.createInvoiceDraft({
      customerId: customer.id,
      title: 'Website build',
      issueDate: '2026-07-06',
      dueDate: '2026-07-20',
      lineItems: [
        { description: 'Design', quantity: 2, unitPrice: 100, gstApplicable: true },
      ],
    });

    const updated = db.updateInvoiceDraft(draft.id, {
      title: 'Website build - updated',
      issueDate: '2026-07-06',
      dueDate: '2026-07-20',
      paymentState: 'Sent',
      lineItems: [
        { description: 'Design', quantity: 2, unitPrice: 100, gstApplicable: true },
        { description: 'Hosting', quantity: 1, unitPrice: 50, gstApplicable: false },
      ],
    });

    expect(updated.status).toBe('Draft');
    expect(updated.totals.total).toBe(270);

    const finalised = db.finaliseInvoice(draft.id);
    expect(finalised.status).toBe('Finalised');
    expect(finalised.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(finalised.paymentState).toBe('Awaiting Payment');

    const timeline = db.getTimelineForEntity('invoice', draft.id);
    expect(timeline).toHaveLength(3);

    db.close();
  });
});
