import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import {
  blankLineItem,
  ensureLineClientKeys,
  LINE_FIELD_ORDER,
  parseLineNumericInput,
  resolveEnterNavigation,
  resolveTabNavigation,
  shouldHandleLineEnter,
  shouldHandleLineTab,
} from '../../public/invoice-line-keyboard.js';
import { calculateLineItem } from '../../public/invoice-totals.js';
import { lineRowHtml } from '../../public/invoice-editor.js';

describe('invoice line keyboard navigation helpers', () => {
  it('keeps stable client keys across reorder and duplicate descriptions', () => {
    const lines = ensureLineClientKeys([
      { description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true },
      { description: 'Labour', quantity: 1, unitPrice: 200, gstApplicable: true },
    ]);
    expect(lines[0]?.clientKey).toBeTruthy();
    expect(lines[1]?.clientKey).toBeTruthy();
    expect(lines[0]?.clientKey).not.toBe(lines[1]?.clientKey);

    const first = lines[0]!;
    const second = lines[1]!;
    const reordered = ensureLineClientKeys([second, first]);
    expect(reordered[0]?.clientKey).toBe(second.clientKey);
    expect(reordered[1]?.clientKey).toBe(first.clientKey);
  });

  it('parses unit price without resetting typed values to zero', () => {
    expect(parseLineNumericInput('350', 0)).toBe(350);
    expect(parseLineNumericInput('350.', 0)).toBe(350);
    expect(parseLineNumericInput('1,250.50', 0)).toBe(1250.5);
    expect(parseLineNumericInput('', 350)).toBe(350);
    expect(parseLineNumericInput('abc', 350)).toBe(350);
  });

  it('recalculates line total for qty 1 @ 350 with GST to $385.00', () => {
    const line = calculateLineItem({
      description: 'Labour',
      quantity: 1,
      unitPrice: parseLineNumericInput('350', 0),
      gstApplicable: true,
    });
    expect(line.lineTotal).toBe(385);
  });

  it('moves Enter from unit price to the next row unit price', () => {
    expect(
      resolveEnterNavigation({ field: 'unitPrice', lineIndex: 0, lineCount: 2 }),
    ).toEqual({ action: 'focus', field: 'unitPrice', lineIndex: 1 });
  });

  it('adds a row when Enter is pressed on the final unit price', () => {
    expect(
      resolveEnterNavigation({ field: 'unitPrice', lineIndex: 1, lineCount: 2 }),
    ).toEqual({ action: 'add-row', field: 'unitPrice', lineIndex: 2 });
  });

  it('moves Enter vertically for other editable fields', () => {
    expect(
      resolveEnterNavigation({ field: 'description', lineIndex: 0, lineCount: 2 }),
    ).toEqual({ action: 'focus', field: 'description', lineIndex: 1 });
    expect(
      resolveEnterNavigation({ field: 'quantity', lineIndex: 0, lineCount: 1 }),
    ).toEqual({ action: 'add-row', field: 'quantity', lineIndex: 1 });
  });

  it('moves Tab horizontally Description → Quantity → Unit Price → GST', () => {
    expect(LINE_FIELD_ORDER).toEqual([
      'description',
      'quantity',
      'unitPrice',
      'gstApplicable',
    ]);
    expect(
      resolveTabNavigation({ field: 'description', lineIndex: 0, lineCount: 1, shiftKey: false }),
    ).toEqual({ action: 'focus', field: 'quantity', lineIndex: 0 });
    expect(
      resolveTabNavigation({ field: 'quantity', lineIndex: 0, lineCount: 1, shiftKey: false }),
    ).toEqual({ action: 'focus', field: 'unitPrice', lineIndex: 0 });
    expect(
      resolveTabNavigation({ field: 'unitPrice', lineIndex: 0, lineCount: 1, shiftKey: false }),
    ).toEqual({ action: 'focus', field: 'gstApplicable', lineIndex: 0 });
  });

  it('moves Tab from GST to the next row description (creating a row if needed)', () => {
    expect(
      resolveTabNavigation({ field: 'gstApplicable', lineIndex: 0, lineCount: 2, shiftKey: false }),
    ).toEqual({ action: 'focus', field: 'description', lineIndex: 1 });
    expect(
      resolveTabNavigation({ field: 'gstApplicable', lineIndex: 1, lineCount: 2, shiftKey: false }),
    ).toEqual({ action: 'add-row', field: 'description', lineIndex: 2 });
  });

  it('moves Shift+Tab backward through the same sequence', () => {
    expect(
      resolveTabNavigation({ field: 'unitPrice', lineIndex: 0, lineCount: 2, shiftKey: true }),
    ).toEqual({ action: 'focus', field: 'quantity', lineIndex: 0 });
    expect(
      resolveTabNavigation({ field: 'description', lineIndex: 1, lineCount: 2, shiftKey: true }),
    ).toEqual({ action: 'focus', field: 'gstApplicable', lineIndex: 0 });
  });

  it('does not hijack Enter in textarea notes fields', () => {
    const textarea = { tagName: 'TEXTAREA', getAttribute: () => 'notes', isContentEditable: false };
    expect(shouldHandleLineEnter(textarea)).toBe(false);
    const unitPrice = {
      tagName: 'INPUT',
      getAttribute: (name: string) => (name === 'data-invoice-field' ? 'unitPrice' : null),
      isContentEditable: false,
    };
    expect(shouldHandleLineEnter(unitPrice)).toBe(true);
    expect(shouldHandleLineTab(unitPrice)).toBe(true);
  });

  it('renders stable data-line-id and keeps action buttons out of tab order', () => {
    const html = lineRowHtml(
      { ...blankLineItem(), description: 'Paint', quantity: 1, unitPrice: 40, clientKey: 'stable-key-1' },
      0,
    );
    expect(html).toContain('data-line-id="stable-key-1"');
    expect(html).toContain('data-invoice-drag-handle');
    expect(html).toMatch(/data-invoice-drag-handle[^>]*tabindex="-1"/);
    expect(html).toMatch(/data-line-up[^>]*tabindex="-1"/);
    expect(html).toMatch(/data-remove-line[^>]*tabindex="-1"/);
  });

  it('wires Enter/Tab handlers into the canonical invoice editor', () => {
    const source = fs.readFileSync(new URL('../../public/invoice-editor.js', import.meta.url), 'utf8');
    expect(source).toContain("from './invoice-line-keyboard.js'");
    expect(source).toContain('shouldHandleLineEnter');
    expect(source).toContain('resolveEnterNavigation');
    expect(source).toContain('resolveTabNavigation');
    expect(source).toContain('commitLineControl');
    expect(source).toContain("event.key === 'Enter'");
    expect(source).toContain("event.key === 'Tab'");
    expect(source).toContain('preventDefault()');
    expect(source).toContain('data-line-id');
  });
});
