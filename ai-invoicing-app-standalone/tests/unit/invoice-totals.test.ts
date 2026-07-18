import { describe, expect, it } from 'vitest';

import {
  calculateInvoiceTotals,
  calculateLineItem,
  roundCurrency,
} from '../../public/invoice-totals.js';

describe('invoice workspace totals', () => {
  it('matches GST line math used by the full-page editor', () => {
    const line = calculateLineItem({
      description: 'Scaffold hire',
      quantity: 2,
      unitPrice: 125,
      gstApplicable: true,
    });
    expect(line.lineSubtotal).toBe(250);
    expect(line.lineGst).toBe(25);
    expect(line.lineTotal).toBe(275);
  });

  it('updates live grand totals across mixed GST rows', () => {
    const result = calculateInvoiceTotals([
      { description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true },
      { description: 'Exempt', quantity: 1, unitPrice: 50, gstApplicable: false },
    ]);
    expect(result.totals).toEqual({
      subtotal: 150,
      gstTotal: 10,
      total: 160,
    });
    expect(roundCurrency(result.calculatedItems[0]!.lineTotal)).toBe(110);
  });

  it('treats string gst flags from form controls correctly', () => {
    expect(
      calculateLineItem({
        description: 'No GST',
        quantity: '3',
        unitPrice: '10',
        gstApplicable: 'false',
      }).lineTotal,
    ).toBe(30);
  });
});
