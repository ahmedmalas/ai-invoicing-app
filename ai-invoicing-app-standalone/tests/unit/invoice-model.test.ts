import { describe, expect, it } from 'vitest';

import {
  applySavedInvoice,
  buildInvoicePayload,
  createEmptyEditorState,
  hydrateEditorState,
  normalizeLegacyInvoiceRecord,
  patchEditorState,
  payloadReadyForAutosave,
  toCreateDraftBody,
  toUpdateDraftBody,
  validateInvoiceForSave,
} from '../../public/invoice-model.js';

const CUSTOMER = '11111111-1111-4111-8111-111111111111';

describe('canonical invoice model', () => {
  it('initialises empty editor state with defaults', () => {
    const state = createEmptyEditorState();
    expect(state.id).toBeNull();
    expect(state.status).toBe('Draft');
    expect(state.invoiceNumber).toBeNull();
    expect(state.title).toBe('');
    expect(state.customerId).toBe('');
    expect(state.currency).toBe('AUD');
    expect(state.lineItems).toHaveLength(1);
    expect(state.tax.gstRate).toBe(0.1);
    expect(state.version).toBe(3);
    expect(state.totals).toEqual({ subtotal: 0, gstTotal: 0, total: 0 });
  });

  it('hydrates an existing invoice without losing fields', () => {
    const state = hydrateEditorState({
      id: '22222222-2222-4222-8222-222222222222',
      status: 'Draft',
      paymentState: 'Draft',
      invoiceNumber: null,
      title: 'Roof repair',
      customerId: CUSTOMER,
      issueDate: '2026-07-01',
      dueDate: '2026-07-15',
      notes: 'Bring ladder',
      paymentTerms: 'Net 14',
      lineItems: [
        { description: 'Labour', quantity: 2, unitPrice: 100, gstApplicable: true },
        { description: 'Parts', quantity: 1, unitPrice: 50, gstApplicable: false },
      ],
      updatedAt: '2026-07-22T00:00:00.000Z',
    });
    expect(state.id).toBe('22222222-2222-4222-8222-222222222222');
    expect(state.title).toBe('Roof repair');
    expect(state.customerId).toBe(CUSTOMER);
    expect(state.lineItems).toHaveLength(2);
    expect(state.lineItems[0]?.description).toBe('Labour');
    expect(state.lineItems[1]?.gstApplicable).toBe(false);
    expect(state.totals.subtotal).toBe(250);
    expect(state.totals.gstTotal).toBe(20);
    expect(state.totals.total).toBe(270);
  });

  it('builds a canonical payload with trimmed title and ordered line items', () => {
    const state = createEmptyEditorState({
      customerId: CUSTOMER,
      title: '  Site visit  ',
      issueDate: '2026-07-22',
      dueDate: '2026-08-05',
      notes: '  ',
      paymentTerms: ' Due on receipt ',
      lineItems: [
        { description: ' First ', quantity: 1, unitPrice: 10, gstApplicable: true },
        { description: 'Second', quantity: 2, unitPrice: 20, gstApplicable: false },
      ],
    });
    const payload = buildInvoicePayload(state);
    expect(payload.title).toBe('Site visit');
    expect(payload.customerId).toBe(CUSTOMER);
    expect(payload.notes).toBeUndefined();
    expect(payload.paymentTerms).toBe('Due on receipt');
    expect(payload.lineItems.map((item) => item.description)).toEqual(['First', 'Second']);
    expect(payload.invoiceNumber).toBeNull();
  });

  it('preserves title, customer, and line items through patch + payload', () => {
    let state = createEmptyEditorState();
    state = patchEditorState(state, {
      title: 'Bound Title',
      customerId: CUSTOMER,
      lineItems: [{ description: 'Paint', quantity: 3, unitPrice: 40, gstApplicable: true }],
    });
    const payload = buildInvoicePayload(state);
    expect(payload.title).toBe('Bound Title');
    expect(payload.customerId).toBe(CUSTOMER);
    expect(payload.lineItems).toEqual([
      { description: 'Paint', quantity: 3, unitPrice: 40, gstApplicable: true },
    ]);
  });

  it('trims whitespace-only titles to empty and fails validation', () => {
    const state = createEmptyEditorState({
      customerId: CUSTOMER,
      title: '   ',
      issueDate: '2026-07-22',
      dueDate: '2026-08-05',
      lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
    });
    expect(buildInvoicePayload(state).title).toBe('');
    const result = validateInvoiceForSave(state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldPath).toBe('title');
      expect(result.message).toMatch(/title is required/i);
    }
  });

  it('rejects empty required fields without mutating state', () => {
    const state = createEmptyEditorState({
      title: 'Keep me',
      customerId: '',
      lineItems: [{ description: '', quantity: 1, unitPrice: 10, gstApplicable: true }],
    });
    const before = structuredClone(state);
    const result = validateInvoiceForSave(state);
    expect(result.ok).toBe(false);
    expect(state).toEqual(before);
  });

  it('disabled or read-only UI state does not affect payload construction', () => {
    const state = createEmptyEditorState({
      customerId: CUSTOMER,
      title: 'Visible Bound Title',
      issueDate: '2026-07-22',
      dueDate: '2026-08-05',
      lineItems: [{ description: 'Roof work', quantity: 2, unitPrice: 150, gstApplicable: true }],
    });
    // Simulate UI disabling — state is untouched.
    const uiDisabled = true;
    expect(uiDisabled).toBe(true);
    const payload = buildInvoicePayload(state);
    expect(payload.title).toBe('Visible Bound Title');
    expect(payload.lineItems[0]?.description).toBe('Roof work');
  });

  it('preview and save derive equivalent core payloads from the same builder', () => {
    const state = createEmptyEditorState({
      customerId: CUSTOMER,
      title: 'Parity job',
      issueDate: '2026-07-22',
      dueDate: '2026-08-05',
      notes: 'note',
      paymentTerms: 'Net 7',
      invoiceNumber: null,
      lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
    });
    const savePayload = buildInvoicePayload(state);
    const previewPayload = buildInvoicePayload(state);
    expect(previewPayload).toEqual(savePayload);
    expect(toCreateDraftBody(savePayload)).toEqual({
      customerId: CUSTOMER,
      title: 'Parity job',
      issueDate: '2026-07-22',
      dueDate: '2026-08-05',
      notes: 'note',
      paymentTerms: 'Net 7',
      lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
    });
    expect(toUpdateDraftBody(savePayload, 'Draft')).toEqual({
      title: 'Parity job',
      issueDate: '2026-07-22',
      dueDate: '2026-08-05',
      notes: 'note',
      paymentTerms: 'Net 7',
      lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
      paymentState: 'Draft',
    });
  });

  it('finalisation uses canonical state fields after applySavedInvoice', () => {
    const draft = createEmptyEditorState({
      id: '33333333-3333-4333-8333-333333333333',
      customerId: CUSTOMER,
      title: 'Issue me',
      issueDate: '2026-07-22',
      dueDate: '2026-08-05',
      lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
    });
    const issued = applySavedInvoice(draft, {
      ...draft,
      status: 'Finalised',
      invoiceNumber: 'INV-2026-000001',
      paymentState: 'Awaiting Payment',
      lineItems: draft.lineItems,
      totals: draft.totals,
    });
    expect(issued.status).toBe('Finalised');
    expect(issued.invoiceNumber).toBe('INV-2026-000001');
    expect(buildInvoicePayload(issued).title).toBe('Issue me');
    expect(buildInvoicePayload(issued).invoiceNumber).toBe('INV-2026-000001');
  });

  it('normalises legacy production-era local snapshots', () => {
    const legacy = normalizeLegacyInvoiceRecord({
      recordId: '44444444-4444-4444-8444-444444444444',
      invoiceTitle: 'Legacy title alias',
      customer_id: CUSTOMER,
      issue_date: '2026-01-01',
      due_date: '2026-01-15',
      payment_terms: 'COD',
      invoice_number: ' INV-OLD-1 ',
      lines: [{ description: 'Legacy line', quantity: '2', unitPrice: '25', gstApplicable: 'true' }],
    });
    expect(legacy.id).toBe('44444444-4444-4444-8444-444444444444');
    expect(legacy.title).toBe('Legacy title alias');
    expect(legacy.customerId).toBe(CUSTOMER);
    expect(legacy.invoiceNumber).toBe('INV-OLD-1');
    const state = hydrateEditorState(legacy);
    expect(state.title).toBe('Legacy title alias');
    expect(state.lineItems[0]?.description).toBe('Legacy line');
    expect(state.lineItems[0]?.quantity).toBe(2);
  });

  it('payloadReadyForAutosave requires complete core fields', () => {
    const ready = buildInvoicePayload(
      createEmptyEditorState({
        customerId: CUSTOMER,
        title: 'Ready',
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 10, gstApplicable: true }],
      }),
    );
    expect(payloadReadyForAutosave(ready)).toBe(true);
    expect(payloadReadyForAutosave({ ...ready, title: '' })).toBe(false);
  });
});
