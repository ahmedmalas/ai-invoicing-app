import { describe, expect, it } from 'vitest';

import { invoiceWorkspaceLineRow } from '../../public/invoice-workspace.js';
import { shouldAllowInvoiceLineDragStart } from '../../public/form-interaction-guards.js';

describe('invoice workspace selection and drag markup', () => {
  it('does not make the entire line row draggable by default', () => {
    const html = invoiceWorkspaceLineRow(
      { description: 'Roof flashing repair', quantity: 1, unitPrice: 120, gstApplicable: true },
      0,
    );
    expect(html).toContain('data-invoice-line');
    expect(html).not.toMatch(/data-invoice-line[^>]*draggable="true"/);
    expect(html).toContain('data-line-drag');
    expect(html).toContain('name="description"');
    expect(html).toContain('draggable="false"');
  });

  it('keeps title and description as native editable inputs in the workspace markup', async () => {
    const { buildInvoiceWorkspaceHtml } = await import('../../public/invoice-workspace.js');
    const html = buildInvoiceWorkspaceHtml({
      profile: { companyName: 'Aleya Demo' },
      customers: [{ id: '11111111-1111-4111-8111-111111111111', displayName: 'Acme' }],
      record: {
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        title: 'Site visit',
        lineItems: [
          { description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true },
        ],
      },
    });
    expect(html).toContain('name="title"');
    expect(html).toContain('value="Site visit"');
    expect(html).toContain('name="description"');
    expect(html).not.toMatch(/name="title"[^>]*readonly/);
    expect(html).not.toMatch(/name="description"[^>]*readonly/);
    expect(html).not.toMatch(/name="title"[^>]*disabled/);
  });

  it('rejects dragstart that originates inside the description field', () => {
    const description = {
      closest(selector: string) {
        if (selector.includes('input')) return this;
        if (selector.includes('data-line-drag')) return null;
        return null;
      },
    };
    expect(shouldAllowInvoiceLineDragStart({ target: description })).toBe(false);
  });
});
