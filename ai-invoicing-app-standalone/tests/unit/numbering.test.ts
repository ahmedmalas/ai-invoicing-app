import { describe, expect, it } from 'vitest';

import { formatInvoiceNumber } from '../../src/domain/invoices/numbering.js';

describe('invoice numbering', () => {
  it('formats invoice number with zero padded sequence', () => {
    const invoiceNumber = formatInvoiceNumber('INV', 2026, 42);
    expect(invoiceNumber).toBe('INV-2026-000042');
  });
});
