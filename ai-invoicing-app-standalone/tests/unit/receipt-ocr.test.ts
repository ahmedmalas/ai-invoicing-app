import { describe, expect, it } from 'vitest';

import { extractReceiptFields } from '../../src/domain/attachments/receipt-ocr.js';
import { canPerformAttachmentAction } from '../../src/domain/attachments/permissions.js';

describe('receipt OCR heuristics', () => {
  it('extracts editable merchant, date, total and GST fields', () => {
    const ocr = extractReceiptFields(`
      Bunnings Warehouse
      Date: 12/03/2026
      Invoice No: INV-4455
      GST: $10.00
      Total: $110.00
      Ref: TXN-99
    `);
    expect(ocr.merchant).toMatch(/Bunnings/i);
    expect(ocr.date).toBe('12/03/2026');
    expect(ocr.total).toBe(110);
    expect(ocr.gst).toBe(10);
    expect(ocr.invoiceNumber).toMatch(/4455/);
    expect(ocr.confidence).toBeGreaterThan(0.5);
  });
});

describe('attachment permissions', () => {
  it('allows read-only users to view and download only', () => {
    const readOnly = { isAdmin: false, canWrite: false, isReadOnly: true };
    expect(canPerformAttachmentAction(readOnly, 'view')).toBe(true);
    expect(canPerformAttachmentAction(readOnly, 'download')).toBe(true);
    expect(canPerformAttachmentAction(readOnly, 'upload')).toBe(false);
    expect(canPerformAttachmentAction(readOnly, 'delete')).toBe(false);
  });

  it('allows staff writers to upload and soft-delete', () => {
    const staff = { isAdmin: false, canWrite: true, isReadOnly: false };
    expect(canPerformAttachmentAction(staff, 'upload')).toBe(true);
    expect(canPerformAttachmentAction(staff, 'delete')).toBe(true);
    expect(canPerformAttachmentAction(staff, 'restore')).toBe(true);
  });
});
