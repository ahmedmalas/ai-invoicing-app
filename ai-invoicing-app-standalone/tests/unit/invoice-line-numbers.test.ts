import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

import {
  blankLineItem,
  displayLineNumber,
  ensureLineClientKeys,
  formatLineItemCountLabel,
} from '../../public/invoice-line-keyboard.js';
import { buildEditorHtml, lineRowHtml } from '../../public/invoice-editor.js';
import {
  displayLineNumber as pdfDisplayLineNumber,
  formatLineItemCountLabel as pdfFormatLineItemCountLabel,
} from '../../src/services/invoice-pdf-layout.js';
import { generateInvoicePdfBuffer } from '../../src/services/pdf-service.js';
import { extractPdfText } from '../helpers/pdf-text.js';

const profile = {
  id: 'business-profile',
  companyName: 'Line Number Co',
  legalName: 'Line Number Co Pty Ltd',
  abnTaxId: '51824753556',
  address: '1 Number St',
  email: 'lines@example.test',
  phone: '0400000000',
  logoReference: null,
  primaryColor: '#173f35',
  secondaryColor: '#c4f36b',
  updatedAt: '2026-07-24T00:00:00.000Z',
};

describe('invoice line number presentation', () => {
  it('computes sequential presentation numbers from visible order only', () => {
    expect(displayLineNumber(0)).toBe(1);
    expect(displayLineNumber(6)).toBe(7);
    expect(displayLineNumber(99)).toBe(100);
    expect(pdfDisplayLineNumber(99)).toBe(100);
  });

  it('formats singular and plural line-count labels', () => {
    expect(formatLineItemCountLabel(1)).toBe('1 line item');
    expect(formatLineItemCountLabel(12)).toBe('12 line items');
    expect(pdfFormatLineItemCountLabel(0)).toBe('0 line items');
  });

  it('renders a non-editable # column and removes square/dot drag glyphs', () => {
    const html = lineRowHtml(
      { ...blankLineItem(), description: 'Labour Hire 06-07-26', clientKey: 'stable-a' },
      0,
    );
    expect(html).toContain('data-line-number');
    expect(html).toContain('>1<');
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain('⋮⋮');
    expect(html).not.toContain('□');
    expect(html).not.toContain('•');
    expect(html).toContain('data-line-id="stable-a"');
    expect(html).not.toMatch(/data-line-number[^>]*contenteditable/);
  });

  it('renumbers from visible order after delete/reorder while keeping stable ids', () => {
    const lines = ensureLineClientKeys([
      { description: 'A', quantity: 1, unitPrice: 10, gstApplicable: true },
      { description: 'B', quantity: 1, unitPrice: 20, gstApplicable: true },
      { description: 'C', quantity: 1, unitPrice: 30, gstApplicable: true },
    ]);
    const keyB = lines[1]!.clientKey;
    const afterDelete = [lines[0]!, lines[2]!];
    const html = afterDelete.map((item, index) => lineRowHtml(item, index)).join('\n');
    expect(html).toMatch(/data-line-number[^>]*>1</);
    expect(html).toMatch(/data-line-number[^>]*>2</);
    expect(html).not.toMatch(/data-line-number[^>]*>3</);
    expect(html).not.toContain(`data-line-id="${keyB}"`);

    const reordered = [afterDelete[1]!, afterDelete[0]!];
    const reorderedHtml = reordered.map((item, index) => lineRowHtml(item, index)).join('\n');
    expect(reorderedHtml.indexOf('>1<')).toBeLessThan(reorderedHtml.indexOf('>2<'));
    expect(reorderedHtml).toContain(`data-line-id="${reordered[0]!.clientKey}"`);
    expect(reorderedHtml).toContain(`data-line-id="${reordered[1]!.clientKey}"`);
  });

  it('shows line-count summary and # header in the editor shell', () => {
    const html = buildEditorHtml({
      profile,
      customers: [{ id: '11111111-1111-4111-8111-111111111111', displayName: 'Acme' }],
      record: {
        issueDate: '2026-07-24',
        dueDate: '2026-08-07',
        title: 'Numbered invoice',
        lineItems: [
          { description: 'One', quantity: 1, unitPrice: 10, gstApplicable: true },
          { description: 'Two', quantity: 1, unitPrice: 10, gstApplicable: true },
        ],
      },
    });
    expect(html).toContain('data-line-count');
    expect(html).toContain('2 line items');
    expect(html).toContain('invoice-line-number-col');
    expect(html).toContain('>#</th>');
    expect(html).not.toContain('⋮⋮');
  });

  it('keeps editor keyboard field order free of the number column', () => {
    const source = fs.readFileSync(
      new URL('../../public/invoice-line-keyboard.js', import.meta.url),
      'utf8',
    );
    expect(source).toContain("LINE_FIELD_ORDER = ['description', 'quantity', 'unitPrice', 'gstApplicable']");
    expect(source).toContain('displayLineNumber');
    expect(source).not.toMatch(/LINE_FIELD_ORDER = \[[^\]]*lineNumber/);
  });

  it('prints matching sequential numbers in single and multi-page PDFs', async () => {
    const manyLines = Array.from({ length: 45 }, (_, index) => ({
      description: `Labour Hire ${String(index + 1).padStart(2, '0')}-07-26 wide enough to wrap`,
      quantity: 1,
      unitPrice: 10,
      gstApplicable: true,
    }));
    const pdf = await generateInvoicePdfBuffer({
      invoice: {
        id: 'inv-lines',
        customerId: 'cus-1',
        title: 'Numbered lines',
        issueDate: '2026-07-24',
        dueDate: '2026-08-07',
        notes: '',
        paymentTerms: 'Net 14',
        invoiceNumber: 'LN-1',
        status: 'Draft',
        paymentState: 'Draft',
        reminderState: 'None',
        totals: {
          subtotal: manyLines.length * 10,
          gstTotal: manyLines.length,
          total: manyLines.length * 11,
        },
        createdAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
      lineItems: manyLines,
      customer: {
        id: 'cus-1',
        displayName: 'Site Co',
        email: 'site@example.test',
        phone: null,
        address: null,
        abnTaxId: null,
        notes: null,
        createdAt: '2026-07-24T00:00:00.000Z',
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
      businessProfile: profile,
      pageSize: 'A4',
    });

    const text = extractPdfText(pdf);
    expect(text).toContain('45 line items');
    expect(text).toMatch(/#\s*Description|Description/);
    // Sequence continues across pages — late numbers must appear.
    expect(text).toContain('1');
    expect(text).toContain('20');
    expect(text).toContain('45');
    expect(text).toContain('Labour Hire 01-07-26');
    expect(text).toContain('Labour Hire 45-07-26');
    // No square/dot markers in the PDF text stream.
    expect(text).not.toContain('□');
    expect(text).not.toContain('•');
  });
});
