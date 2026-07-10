import { describe, expect, it } from 'vitest';

import { calculateLineItem, calculateTotals } from '../../src/domain/invoices/gst.js';

describe('gst calculations', () => {
  it('calculates GST per line item', () => {
    const line = calculateLineItem({
      description: 'Service',
      quantity: 2,
      unitPrice: 125,
      gstApplicable: true,
    });

    expect(line.lineSubtotal).toBe(250);
    expect(line.lineGst).toBe(25);
    expect(line.lineTotal).toBe(275);
  });

  it('aggregates totals for mixed GST items', () => {
    const result = calculateTotals([
      { description: 'Taxed', quantity: 1, unitPrice: 100, gstApplicable: true },
      { description: 'Untaxed', quantity: 1, unitPrice: 50, gstApplicable: false },
    ]);

    expect(result.totals).toEqual({
      subtotal: 150,
      gstTotal: 10,
      total: 160,
    });
  });
});
