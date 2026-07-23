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
import { buildEditorHtml, buildInvoicePayload, hydrateEditorState } from '../../public/invoice-editor.js';

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
    const state = hydrateEditorState({
      invoiceNumber: 'INV-2026-000042',
      title: 'Issued job',
      customerId: '11111111-1111-4111-8111-111111111111',
      issueDate: '2026-07-22',
      dueDate: '2026-08-05',
      lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
    });
    const payload = buildInvoicePayload(state);
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

  it('keeps draft payload invoiceNumber null and still surfaces missing-title validation', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const editorSource = readFileSync(join(process.cwd(), 'public/invoice-editor.js'), 'utf8');
    expect(editorSource).not.toMatch(/new FormData\s*\(/);
    expect(editorSource).toMatch(/buildInvoicePayload\(state\)/);
    expect(editorSource).toMatch(/validateInvoiceForSave\(state\)/);
    expect(editorSource).toMatch(/assertPayloadMatchesVisibleInvoiceNumber/);
    const modelSource = readFileSync(join(process.cwd(), 'public/invoice-model.js'), 'utf8');
    expect(modelSource).toMatch(/Invoice title is required\./);
    // Preview validates from state before disabling action buttons.
    const previewIdx = editorSource.indexOf("if (action === 'preview' || action === 'download')");
    const validateIdx = editorSource.indexOf('validateInvoiceForSave(state)', previewIdx);
    const busyIdx = editorSource.indexOf('setActionsBusy(true)', previewIdx);
    expect(previewIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeGreaterThan(previewIdx);
    expect(busyIdx).toBeGreaterThan(validateIdx);

    const draftHtml = buildEditorHtml({
      profile: { companyName: 'Aleya Demo' },
      customers: [{ id: '11111111-1111-4111-8111-111111111111', displayName: 'Acme' }],
      record: {
        id: '33333333-3333-4333-8333-333333333333',
        invoiceNumber: null,
        status: 'Draft',
        title: 'Draft job',
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
      },
    });
    expect(draftHtml).toContain('data-invoice-number=""');
    expect(draftHtml).toContain('>Draft<');
  });
});
