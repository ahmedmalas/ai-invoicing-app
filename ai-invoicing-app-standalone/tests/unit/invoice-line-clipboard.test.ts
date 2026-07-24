import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import {
  cloneLineItem,
  cloneLineItems,
  formatLinesAsTsv,
  formatSelectedCountLabel,
  insertLinesAfter,
  isMultiRowClipboardText,
  linesFromSelectedIndexes,
  parseClipboardRows,
  resolveRowSelection,
  resolveSelectAll,
  serializeLineForClipboard,
  shouldHandleBulkRowCopy,
} from '../../public/invoice-line-clipboard.js';
import { calculateLineItem } from '../../public/invoice-totals.js';
import {
  buildInvoicePayload,
  createEmptyEditorState,
  withRecalculatedTotals,
} from '../../public/invoice-model.js';
import { generateInvoicePdfBuffer } from '../../src/services/pdf-service.js';
import { extractPdfText } from '../helpers/pdf-text.js';
import { lineRowHtml, buildEditorHtml } from '../../public/invoice-editor.js';

describe('invoice multi-row clipboard', () => {
  const sample = [
    { description: 'Labour Hire 08-07-26', quantity: 1, unitPrice: 350, gstApplicable: true, clientKey: 'a' },
    { description: 'Labour Hire 09-07-26', quantity: 1, unitPrice: 350, gstApplicable: true, clientKey: 'b' },
    { description: 'Labour Hire 10-07-26', quantity: 1, unitPrice: 350, gstApplicable: true, clientKey: 'c' },
  ];

  it('serializes editable fields without ids or display numbers', () => {
    const row = serializeLineForClipboard({
      ...sample[0],
      id: 'db-1',
      clientKey: 'client-1',
      lineTotal: 385,
    });
    expect(row).toEqual({
      description: 'Labour Hire 08-07-26',
      quantity: 1,
      unitPrice: 350,
      gstApplicable: true,
    });
    expect(row).not.toHaveProperty('id');
    expect(row).not.toHaveProperty('clientKey');
  });

  it('clones rows with fresh stable client keys', () => {
    const clones = cloneLineItems(sample);
    expect(clones).toHaveLength(3);
    expect(clones[0]?.clientKey).not.toBe('a');
    expect(new Set(clones.map((item) => item.clientKey)).size).toBe(3);
    expect(clones[0]?.unitPrice).toBe(350);
  });

  it('supports shift-range and ctrl toggle selection', () => {
    const range = resolveRowSelection({
      selectedIndexes: [0],
      clickedIndex: 2,
      shiftKey: true,
      anchorIndex: 0,
      lineCount: 3,
    });
    expect(range.selectedIndexes).toEqual([0, 1, 2]);

    const toggled = resolveRowSelection({
      selectedIndexes: [0, 1, 2],
      clickedIndex: 1,
      ctrlKey: true,
      anchorIndex: 0,
      lineCount: 3,
    });
    expect(toggled.selectedIndexes).toEqual([0, 2]);
  });

  it('select-all toggles between all and none', () => {
    expect(resolveSelectAll({ lineCount: 4, currentlySelectedCount: 0 })).toEqual([0, 1, 2, 3]);
    expect(resolveSelectAll({ lineCount: 4, currentlySelectedCount: 4 })).toEqual([]);
  });

  it('formats spreadsheet TSV and parses it back with GST', () => {
    const tsv = formatLinesAsTsv(sample);
    expect(tsv.split('\n')[0]).toBe('Description\tQty\tUnit Price\tGST');
    expect(tsv).toContain('Labour Hire 08-07-26\t1\t350.00\t10%');
    expect(isMultiRowClipboardText(tsv)).toBe(true);

    const parsed = parseClipboardRows(tsv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines).toHaveLength(3);
    expect(parsed.lines[0]).toMatchObject({
      description: 'Labour Hire 08-07-26',
      quantity: 1,
      unitPrice: 350,
      gstApplicable: true,
    });
    expect(calculateLineItem(parsed.lines[0]!).lineTotal).toBe(385);
  });

  it('reports invalid spreadsheet cells without discarding the paste block', () => {
    const parsed = parseClipboardRows('Bad row\tabc\txyz\tmaybe');
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.errors[0]?.message).toMatch(/quantity/i);
  });

  it('inserts pasted rows below the active row and renumbers by visible order', () => {
    const inserted = insertLinesAfter({
      lineItems: sample,
      insertAfterIndex: 0,
      newLines: linesFromSelectedIndexes(sample, [1, 2]),
    });
    expect(inserted.lineItems).toHaveLength(5);
    expect(inserted.insertedIndexes).toEqual([1, 2]);
    expect(inserted.lineItems[1]?.description).toBe('Labour Hire 09-07-26');
    expect(inserted.lineItems[1]?.clientKey).not.toBe('b');
    expect(inserted.lineItems[3]?.clientKey).toBe('b');
  });

  it('keeps bulk copy from stealing text selection inside inputs', () => {
    expect(
      shouldHandleBulkRowCopy({
        selectedCount: 2,
        target: { tagName: 'INPUT' },
        textSelected: true,
      }),
    ).toBe(false);
    expect(
      shouldHandleBulkRowCopy({
        selectedCount: 2,
        target: { tagName: 'INPUT' },
        textSelected: false,
      }),
    ).toBe(true);
    expect(formatSelectedCountLabel(8)).toBe('8 lines selected');
  });

  it('preserves pasted rows through payload, reopen hydration and PDF', async () => {
    const pasted = insertLinesAfter({
      lineItems: [sample[0]!],
      insertAfterIndex: 0,
      newLines: cloneLineItems(sample.slice(1)),
    });
    const state = withRecalculatedTotals(
      createEmptyEditorState({
        customerId: '11111111-1111-4111-8111-111111111111',
        title: 'Multi copy invoice',
        issueDate: '2026-07-24',
        dueDate: '2026-08-07',
        lineItems: pasted.lineItems,
      }),
    );
    expect(state.lineItems).toHaveLength(3);
    expect(state.totals.total).toBe(1155);
    const payload = buildInvoicePayload(state);
    expect(payload.lineItems.map((item) => item.unitPrice)).toEqual([350, 350, 350]);

    const pdf = await generateInvoicePdfBuffer({
      invoice: {
        id: 'inv-multi',
        customerId: payload.customerId,
        title: payload.title,
        issueDate: payload.issueDate,
        dueDate: payload.dueDate,
        notes: '',
        paymentTerms: 'Net 14',
        invoiceNumber: 'MC-1',
        status: 'Draft',
        paymentState: 'Draft',
        reminderState: 'None',
        totals: state.totals,
        createdAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
      lineItems: payload.lineItems,
      customer: {
        id: payload.customerId,
        displayName: 'Multi Cust',
        email: 'multi@example.test',
        phone: null,
        address: null,
        abnTaxId: null,
        notes: null,
        createdAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
      businessProfile: {
        id: 'bp',
        companyName: 'Multi Co',
        legalName: 'Multi Co Pty Ltd',
        abnTaxId: '51824753556',
        address: '1 Multi St',
        email: 'billing@multi.test',
        phone: '0400000000',
        logoReference: null,
        primaryColor: '#173f35',
        secondaryColor: '#c4f36b',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
    });
    const text = extractPdfText(pdf);
    expect(text).toContain('Labour Hire 08-07-26');
    expect(text).toContain('Labour Hire 10-07-26');
    expect(text).toMatch(/385/);
  });

  it('renders selection checkbox column and duplicate controls in the editor', () => {
    const row = lineRowHtml(cloneLineItem(sample[0]!), 0, { selected: true });
    expect(row).toContain('data-line-select');
    expect(row).toContain('is-selected');
    expect(row).toContain('data-line-duplicate');
    expect(row).toContain('data-line-number');

    const html = buildEditorHtml({
      profile: { companyName: 'Multi' },
      customers: [{ id: '11111111-1111-4111-8111-111111111111', displayName: 'Acme' }],
      record: {
        issueDate: '2026-07-24',
        dueDate: '2026-08-07',
        title: 'Select rows',
        lineItems: sample,
      },
    });
    expect(html).toContain('data-select-all-lines');
    expect(html).toContain('data-duplicate-selected');
    expect(html).toContain('data-selection-count');
  });

  it('wires clipboard helpers into the canonical editor', () => {
    const source = fs.readFileSync(new URL('../../public/invoice-editor.js', import.meta.url), 'utf8');
    expect(source).toContain("from './invoice-line-clipboard.js'");
    expect(source).toContain('copySelectedRowsToClipboard');
    expect(source).toContain('duplicateSelectedRows');
    expect(source).toContain("addEventListener('copy'");
    expect(source).toContain('formatLinesAsTsv');
  });
});
