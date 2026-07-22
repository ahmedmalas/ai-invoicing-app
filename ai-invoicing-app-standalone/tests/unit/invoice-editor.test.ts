import { describe, expect, it } from 'vitest';

import {
  buildEditorHtml,
  buildPayloadFromForm,
  INVOICE_EDITOR_STORAGE_KEY,
  lineRowHtml,
} from '../../public/invoice-editor.js';

describe('invoice editor rebuild', () => {
  it('renders one canonical title field and no FormData-dependent markup', () => {
    const html = buildEditorHtml({
      profile: { companyName: 'Aleya Demo' },
      customers: [{ id: '11111111-1111-4111-8111-111111111111', displayName: 'Acme' }],
      record: {
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        title: 'Site visit',
        lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
      },
    });
    expect(html).toContain('data-invoice-editor');
    expect(html).toContain('id="invoice-editor-form"');
    expect(html).toContain('data-invoice-field="title"');
    expect(html).toContain('value="Site visit"');
    expect(html).toContain('data-invoice-field="description"');
    expect(html).toContain('data-invoice-drag-handle');
    expect(html).not.toMatch(/data-invoice-line[^>]*draggable="true"/);
    expect(html.match(/data-invoice-field="title"/g)?.length).toBe(1);
  });

  it('builds payloads from live control values even when inputs are disabled', () => {
    const title = {
      value: 'Visible Bound Title',
      disabled: true,
    };
    const form = {
      querySelector(selector: string) {
        if (selector.includes('data-invoice-field="title"')) return title;
        if (selector.includes('data-invoice-field="customerId"'))
          return { value: '11111111-1111-4111-8111-111111111111' };
        if (selector.includes('data-invoice-field="issueDate"')) return { value: '2026-07-22' };
        if (selector.includes('data-invoice-field="dueDate"')) return { value: '2026-08-05' };
        if (selector.includes('data-invoice-field="notes"')) return { value: '' };
        if (selector.includes('data-invoice-field="paymentTerms"')) return { value: '' };
        return null;
      },
      querySelectorAll(selector: string) {
        if (selector === '[data-invoice-line]') {
          return [
            {
              querySelector(inner: string) {
                if (inner.includes('description')) return { value: 'Roof work' };
                if (inner.includes('quantity')) return { value: '2' };
                if (inner.includes('unitPrice')) return { value: '150' };
                if (inner.includes('gstApplicable')) return { value: 'true' };
                return null;
              },
            },
          ];
        }
        return [];
      },
    };

    // FormData would omit disabled title; canonical builder must not.
    const formDataTitle = title.disabled ? undefined : title.value;
    expect(formDataTitle).toBeUndefined();
    const payload = buildPayloadFromForm(form) as {
      title: string;
      lineItems: Array<{ description: string }>;
    };
    expect(payload.title).toBe('Visible Bound Title');
    expect(payload.lineItems[0]?.description).toBe('Roof work');
  });

  it('keeps line rows non-draggable by default', () => {
    const html = lineRowHtml({ description: 'Paint', quantity: 1, unitPrice: 40 }, 0);
    expect(html).toContain('data-invoice-drag-handle');
    expect(html).not.toMatch(/data-invoice-line[^>]*draggable="true"/);
  });

  it('exports a dedicated storage key for the rebuilt editor', () => {
    expect(INVOICE_EDITOR_STORAGE_KEY).toBe('aleya-invoice-editor-v2');
  });
});
