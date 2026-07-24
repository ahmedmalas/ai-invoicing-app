import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import {
  applyLinePaste,
  blankLineItem,
  ensureLineClientKeys,
  normalizeNumericText,
  parseLineNumericInput,
  parseSpreadsheetPaste,
  shouldHandleLinePaste,
} from '../../public/invoice-line-keyboard.js';
import { calculateInvoiceTotals, calculateLineItem } from '../../public/invoice-totals.js';
import {
  buildInvoicePayload,
  createEmptyEditorState,
  withRecalculatedTotals,
} from '../../public/invoice-model.js';
import { generateInvoicePdfBuffer } from '../../src/services/pdf-service.js';
import { extractPdfText } from '../helpers/pdf-text.js';

function priceTarget() {
  return {
    getAttribute: (name: string) => (name === 'data-invoice-field' ? 'unitPrice' : null),
  };
}

describe('invoice line paste commit helpers', () => {
  it('parses currency, spaces, commas and EU decimals safely', () => {
    expect(normalizeNumericText('$350')).toBe('350');
    expect(normalizeNumericText('$ 350.00')).toBe('350.00');
    expect(normalizeNumericText(' 350 ')).toBe('350');
    expect(normalizeNumericText('1,250.50')).toBe('1250.50');
    expect(normalizeNumericText('350,00')).toBe('350.00');
    expect(normalizeNumericText('AUD 350')).toBe('350');

    expect(parseLineNumericInput('$350', 0)).toBe(350);
    expect(parseLineNumericInput('350.00', 0)).toBe(350);
    expect(parseLineNumericInput('350,00', 0)).toBe(350);
    expect(parseLineNumericInput(' 350 ', 0)).toBe(350);
    expect(parseLineNumericInput('1,250.50', 0)).toBe(1250.5);
    expect(parseLineNumericInput('', 350)).toBe(350);
  });

  it('commits a single pasted Unit Price into line state immediately', () => {
    const lines = ensureLineClientKeys([
      { description: 'Labour', quantity: 1, unitPrice: 0, gstApplicable: true },
    ]);
    const result = applyLinePaste({
      lineItems: lines,
      startIndex: 0,
      startField: 'unitPrice',
      pastedText: '$350',
    });
    expect(result.handled).toBe(true);
    expect(result.lineItems[0]?.unitPrice).toBe(350);
    const calc = calculateLineItem({
      description: String(result.lineItems[0]?.description ?? ''),
      quantity: Number(result.lineItems[0]?.quantity),
      unitPrice: Number(result.lineItems[0]?.unitPrice),
      gstApplicable: result.lineItems[0]?.gstApplicable !== false,
    });
    expect(calc.lineTotal).toBe(385);
  });

  it('pastes the same price into several Unit Price rows', () => {
    const lines = ensureLineClientKeys([
      { description: 'A', quantity: 1, unitPrice: 0, gstApplicable: true },
      { description: 'B', quantity: 1, unitPrice: 0, gstApplicable: true },
      { description: 'C', quantity: 1, unitPrice: 0, gstApplicable: true },
    ]);
    const result = applyLinePaste({
      lineItems: lines,
      startIndex: 0,
      startField: 'unitPrice',
      pastedText: '350\n350\n350',
    });
    expect(result.lineItems).toHaveLength(3);
    for (const line of result.lineItems) {
      expect(line.unitPrice).toBe(350);
      expect(
        calculateLineItem({
          description: String(line.description ?? ''),
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          gstApplicable: line.gstApplicable !== false,
        }).lineTotal,
      ).toBe(385);
    }
    const totals = calculateInvoiceTotals(result.lineItems).totals;
    expect(totals.subtotal).toBe(1050);
    expect(totals.gstTotal).toBe(105);
    expect(totals.total).toBe(1155);
  });

  it('pastes tab-separated spreadsheet values across multiple rows', () => {
    const lines = ensureLineClientKeys([blankLineItem()]);
    const result = applyLinePaste({
      lineItems: lines,
      startIndex: 0,
      startField: 'description',
      pastedText: 'Labour\t1\t350\ttrue\nParts\t1\t350\tyes',
    });
    expect(result.handled).toBe(true);
    expect(result.lineItems).toHaveLength(2);
    expect(result.lineItems[0]).toMatchObject({
      description: 'Labour',
      quantity: 1,
      unitPrice: 350,
      gstApplicable: true,
    });
    expect(result.lineItems[1]).toMatchObject({
      description: 'Parts',
      quantity: 1,
      unitPrice: 350,
      gstApplicable: true,
    });
    expect(parseSpreadsheetPaste('Labour\t1\t350')[0]).toEqual(['Labour', '1', '350']);
  });

  it('preserves pasted prices through Enter/blur/save payload without retyping', () => {
    const seeded = ensureLineClientKeys([
      { description: 'Labour', quantity: 1, unitPrice: 0, gstApplicable: true },
      { description: 'Travel', quantity: 1, unitPrice: 0, gstApplicable: true },
    ]);
    const pasted = applyLinePaste({
      lineItems: seeded,
      startIndex: 0,
      startField: 'unitPrice',
      pastedText: '350\n350',
    });
    // Simulate Enter/blur commit: values already in canonical state.
    const state = withRecalculatedTotals(
      createEmptyEditorState({
        customerId: '11111111-1111-4111-8111-111111111111',
        title: 'Paste Commit Invoice',
        issueDate: '2026-07-24',
        dueDate: '2026-08-07',
        lineItems: pasted.lineItems,
      }),
    );
    expect(state.totals.total).toBe(770);
    const payload = buildInvoicePayload(state);
    expect(payload.lineItems.map((item) => item.unitPrice)).toEqual([350, 350]);
    expect(payload.lineItems.every((item) => item.quantity === 1)).toBe(true);
  });

  it('marks quantity/unitPrice pastes as handled, including formatted values', () => {
    expect(shouldHandleLinePaste(priceTarget(), '350')).toBe(true);
    expect(shouldHandleLinePaste(priceTarget(), '$350')).toBe(true);
    expect(shouldHandleLinePaste(priceTarget(), '350,00')).toBe(true);
    expect(
      shouldHandleLinePaste(
        { getAttribute: () => 'description' },
        'Labour\t1\t350',
      ),
    ).toBe(true);
    expect(
      shouldHandleLinePaste({ getAttribute: () => 'description' }, 'Labour only'),
    ).toBe(false);
  });

  it('wires immediate paste commit into the canonical invoice editor', () => {
    const source = fs.readFileSync(new URL('../../public/invoice-editor.js', import.meta.url), 'utf8');
    expect(source).toContain('applyLinePaste');
    expect(source).toContain('shouldHandleLinePaste');
    expect(source).toContain("addEventListener('paste'");
    expect(source).toContain('applyPasteCommit');
    expect(source).toContain('syncLineControlsFromState');
    expect(source).toContain("'focusout'");
    expect(source).toContain('commitLineControl');
  });

  it('keeps pasted unit prices in editor payload, reopen hydration and PDF', async () => {
    const pasted = applyLinePaste({
      lineItems: [
        { description: 'Labour', quantity: 1, unitPrice: 0, gstApplicable: true },
        { description: 'Travel', quantity: 1, unitPrice: 0, gstApplicable: true },
      ],
      startIndex: 0,
      startField: 'unitPrice',
      pastedText: '$350\n350,00',
    });
    const state = withRecalculatedTotals(
      createEmptyEditorState({
        customerId: '11111111-1111-4111-8111-111111111111',
        title: 'Pasted Prices',
        issueDate: '2026-07-24',
        dueDate: '2026-08-07',
        lineItems: pasted.lineItems,
      }),
    );
    const payload = buildInvoicePayload(state);
    expect(payload.lineItems.map((item) => item.unitPrice)).toEqual([350, 350]);

    const reopened = createEmptyEditorState(payload);
    expect(reopened.lineItems.map((item) => item.unitPrice)).toEqual([350, 350]);
    expect(reopened.totals.total).toBe(770);

    const pdf = await generateInvoicePdfBuffer({
      invoice: {
        id: 'inv-paste',
        customerId: payload.customerId,
        title: payload.title,
        issueDate: payload.issueDate,
        dueDate: payload.dueDate,
        notes: '',
        paymentTerms: payload.paymentTerms || 'Net 14',
        invoiceNumber: 'PASTE-1',
        status: 'Draft',
        paymentState: 'Draft',
        reminderState: 'None',
        totals: reopened.totals,
        createdAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
      lineItems: payload.lineItems,
      customer: {
        id: payload.customerId,
        displayName: 'Paste Cust',
        email: 'paste@example.test',
        phone: null,
        address: null,
        abnTaxId: null,
        notes: null,
        createdAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
      businessProfile: {
        id: 'bp',
        companyName: 'Paste Co',
        legalName: 'Paste Co Pty Ltd',
        abnTaxId: '51824753556',
        address: '1 Paste St',
        email: 'billing@paste.test',
        phone: '0400000000',
        logoReference: null,
        primaryColor: '#173f35',
        secondaryColor: '#c4f36b',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
    });
    const text = extractPdfText(pdf);
    expect(text).toMatch(/350/);
    expect(text).toMatch(/385|770/);
  });
});
