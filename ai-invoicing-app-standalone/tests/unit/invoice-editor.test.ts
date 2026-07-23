import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import {
  buildEditorHtml,
  buildInvoicePayload,
  createEmptyEditorState,
  hydrateEditorState,
  INVOICE_EDITOR_STORAGE_KEY,
  lineRowHtml,
} from '../../public/invoice-editor.js';

describe('invoice editor canonical pathway', () => {
  it('renders one canonical title field from editor state', () => {
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

  it('builds payloads from editor state even when UI would be disabled', () => {
    const state = hydrateEditorState({
      customerId: '11111111-1111-4111-8111-111111111111',
      title: 'Visible Bound Title',
      issueDate: '2026-07-22',
      dueDate: '2026-08-05',
      lineItems: [{ description: 'Roof work', quantity: 2, unitPrice: 150, gstApplicable: true }],
    });
    // FormData would omit disabled title; canonical state builder must not care.
    const payload = buildInvoicePayload(state);
    expect(payload.title).toBe('Visible Bound Title');
    expect(payload.lineItems[0]?.description).toBe('Roof work');
  });

  it('keeps a field-level Invoice title error slot and custom validation', () => {
    const html = buildEditorHtml({
      profile: { companyName: 'Aleya Demo' },
      customers: [{ id: '11111111-1111-4111-8111-111111111111', displayName: 'Acme' }],
      state: createEmptyEditorState({
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        title: '',
        lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
      }),
    });
    expect(html).toContain('novalidate');
    expect(html).toContain('data-invoice-field-error="title"');
    expect(html).toContain('id="invoice-title-input"');
    expect(html).toMatch(/Invoice title/);
    expect(html).not.toMatch(/nvoice title is required/);
  });

  it('trims whitespace-only titles out of the canonical payload', () => {
    const state = createEmptyEditorState({
      customerId: '11111111-1111-4111-8111-111111111111',
      title: '   ',
      issueDate: '2026-07-22',
      dueDate: '2026-08-05',
      lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
    });
    expect(buildInvoicePayload(state).title).toBe('');
  });

  it('never disables invoice fields while busy — only action buttons', () => {
    const source = fs.readFileSync(new URL('../../public/invoice-editor.js', import.meta.url), 'utf8');
    expect(source).toMatch(/Only toolbar actions may disable/);
    expect(source).toMatch(/querySelectorAll\('\[data-invoice-action\]'\)/);
    expect(source).toMatch(/Never FormData/);
    expect(source).not.toMatch(
      /querySelectorAll\(\s*'\[data-invoice-action\], button, input, select, textarea'/,
    );
    expect(source).toContain('createInvoiceApiClient');
    expect(source).toContain('buildInvoicePayload(state)');
  });

  it('keeps line rows non-draggable by default', () => {
    const html = lineRowHtml({ description: 'Paint', quantity: 1, unitPrice: 40 }, 0);
    expect(html).toContain('data-invoice-drag-handle');
    expect(html).not.toMatch(/data-invoice-line[^>]*draggable="true"/);
  });

  it('exports a dedicated storage key for the canonical editor', () => {
    expect(INVOICE_EDITOR_STORAGE_KEY).toBe('aleya-invoice-editor-v3');
  });
});
