import { describe, expect, it } from 'vitest';

import { buildInvoiceWorkspaceHtml } from '../../public/invoice-workspace.js';
import { calculateInvoiceTotals } from '../../public/invoice-totals.js';

describe('invoice workspace UI builder', () => {
  it('renders the full-page curtain workspace instead of a drawer', () => {
    const html = buildInvoiceWorkspaceHtml({
      profile: {
        companyName: 'Quantum Hire Services',
        abnTaxId: '12 345 678 901',
        email: 'accounts@quantum.example',
        phone: '0400 000 000',
        address: '1 Scaffold Way',
      },
      customers: [{ id: 'c1', displayName: 'Acme Builders', email: 'a@acme.test' }],
      record: null,
    });

    expect(html).toContain('data-invoice-curtain');
    expect(html).toContain('TAX INVOICE');
    expect(html).toContain('Bill To');
    expect(html).toContain('Save Draft');
    expect(html).toContain('Preview PDF');
    expect(html).toContain('Download PDF');
    expect(html).toContain('Bank details');
    expect(html).toContain('Quantum Hire Services');
    expect(html).not.toContain('data-drawer-backdrop');
    expect(html).not.toContain('id="sales-form"');
  });

  it('keeps live totals aligned with saved invoice line math', () => {
    const lines = [
      { description: 'Tower', quantity: 2, unitPrice: 200, gstApplicable: true },
      { description: 'Delivery', quantity: 1, unitPrice: 40, gstApplicable: false },
    ];
    expect(calculateInvoiceTotals(lines).totals).toEqual({
      subtotal: 440,
      gstTotal: 40,
      total: 480,
    });
  });
});
