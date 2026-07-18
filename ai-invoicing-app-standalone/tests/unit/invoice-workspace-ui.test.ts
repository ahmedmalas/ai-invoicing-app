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

  it('shows a customer select for new invoices even when date defaults are provided', () => {
    const html = buildInvoiceWorkspaceHtml({
      profile: { companyName: 'Aleya Hire Co' },
      customers: [
        { id: 'c1', displayName: 'Site Co', email: 'site@example.com' },
        { id: 'c2', displayName: 'PDF Site Co' },
      ],
      record: { issueDate: '2026-07-18', dueDate: '2026-08-01' },
    });

    expect(html).toContain('data-customer-select');
    expect(html).toContain('Select customer');
    expect(html).toContain('Site Co');
    expect(html).not.toContain('invoice-billto-static');
  });

  it('locks the customer control when editing an existing draft', () => {
    const html = buildInvoiceWorkspaceHtml({
      profile: { companyName: 'Aleya Hire Co' },
      customers: [{ id: 'c1', displayName: 'Site Co', email: 'site@example.com' }],
      record: {
        id: 'inv-1',
        customerId: 'c1',
        issueDate: '2026-07-18',
        dueDate: '2026-08-01',
        status: 'Draft',
      },
    });

    expect(html).toContain('invoice-billto-static');
    expect(html).toContain('Site Co');
    expect(html).not.toContain('data-customer-select');
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
