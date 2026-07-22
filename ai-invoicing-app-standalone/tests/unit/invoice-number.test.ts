import { describe, expect, it } from 'vitest';

import {
  assertPayloadMatchesVisibleInvoiceNumber,
  formatInvoiceNumberDisplay,
  normalizeInvoiceNumber,
} from '../../public/invoice-number.js';
import {
  assertCreateInvoiceNumber,
  assertUpdateInvoiceNumber,
} from '../../src/domain/invoices/invoice-number.js';
import { buildEditorHtml, buildPayloadFromForm } from '../../public/invoice-editor.js';

describe('canonical invoice number pathway', () => {
  it('normalizes empty values to null and formats display from that single value', () => {
    expect(normalizeInvoiceNumber(null)).toBeNull();
    expect(normalizeInvoiceNumber('')).toBeNull();
    expect(normalizeInvoiceNumber('  INV-2026-000001  ')).toBe('INV-2026-000001');
    expect(formatInvoiceNumberDisplay(null)).toBe('Draft');
    expect(formatInvoiceNumberDisplay('INV-2026-000001')).toBe('INV-2026-000001');
  });

  it('renders existing invoice numbers into canonical editor state, not a second input', () => {
    const html = buildEditorHtml({
      profile: { companyName: 'Aleya Demo' },
      customers: [{ id: '11111111-1111-4111-8111-111111111111', displayName: 'Acme' }],
      record: {
        id: '22222222-2222-4222-8222-222222222222',
        invoiceNumber: 'INV-2026-000042',
        status: 'Finalised',
        title: 'Issued job',
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
      },
    });
    expect(html).toContain('data-invoice-number="INV-2026-000042"');
    expect(html).toContain('data-invoice-number-display');
    expect(html).toContain('INV-2026-000042');
    expect(html).not.toMatch(/data-invoice-field="invoiceNumber"/);
    expect(html).not.toMatch(/name="invoiceNumber"/);
  });

  it('includes the visible invoice number in the canonical payload builder', () => {
    const form = {
      dataset: { invoiceNumber: 'INV-2026-000042' },
      querySelector(selector: string) {
        if (selector.includes('data-invoice-field="title"')) return { value: 'Issued job' };
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
                if (inner.includes('description')) return { value: 'Labour' };
                if (inner.includes('quantity')) return { value: '1' };
                if (inner.includes('unitPrice')) return { value: '100' };
                if (inner.includes('gstApplicable')) return { value: 'true' };
                return null;
              },
            },
          ];
        }
        return [];
      },
    };
    const payload = buildPayloadFromForm(form) as { invoiceNumber: string | null; title: string };
    expect(payload.invoiceNumber).toBe('INV-2026-000042');
    expect(payload.title).toBe('Issued job');
    expect(() =>
      assertPayloadMatchesVisibleInvoiceNumber(payload, 'INV-2026-000042'),
    ).not.toThrow();
    expect(() => assertPayloadMatchesVisibleInvoiceNumber(payload, null)).toThrow(
      /does not match the visible invoice number/,
    );
  });

  it('rejects inventing a number on create and mutating one on update', () => {
    expect(() => assertCreateInvoiceNumber(null)).not.toThrow();
    expect(() => assertCreateInvoiceNumber(undefined)).not.toThrow();
    expect(() => assertCreateInvoiceNumber('INV-2026-000001')).toThrow(
      'INVOICE_NUMBER_NOT_ASSIGNABLE_ON_CREATE',
    );
    expect(() => assertUpdateInvoiceNumber('INV-2026-000001', 'INV-2026-000001')).not.toThrow();
    expect(() => assertUpdateInvoiceNumber(null, null)).not.toThrow();
    expect(() => assertUpdateInvoiceNumber('INV-2026-000002', 'INV-2026-000001')).toThrow(
      'INVOICE_NUMBER_IMMUTABLE',
    );
  });
});
