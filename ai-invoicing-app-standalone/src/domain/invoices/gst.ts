import type { InvoiceTotals, LineItemInput } from '../../types/entities.js';

export interface CalculatedLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  gstApplicable: boolean;
  lineSubtotal: number;
  lineGst: number;
  lineTotal: number;
}

const GST_RATE = 0.1;

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateLineItem(item: LineItemInput): CalculatedLineItem {
  const lineSubtotal = roundCurrency(item.quantity * item.unitPrice);
  const lineGst = item.gstApplicable ? roundCurrency(lineSubtotal * GST_RATE) : 0;
  const lineTotal = roundCurrency(lineSubtotal + lineGst);

  return {
    ...item,
    lineSubtotal,
    lineGst,
    lineTotal,
  };
}

export function calculateTotals(items: LineItemInput[]): {
  calculatedItems: CalculatedLineItem[];
  totals: InvoiceTotals;
} {
  const calculatedItems = items.map(calculateLineItem);
  const subtotal = roundCurrency(
    calculatedItems.reduce((sum, item) => sum + item.lineSubtotal, 0),
  );
  const gstTotal = roundCurrency(
    calculatedItems.reduce((sum, item) => sum + item.lineGst, 0),
  );
  const total = roundCurrency(subtotal + gstTotal);

  return {
    calculatedItems,
    totals: {
      subtotal,
      gstTotal,
      total,
    },
  };
}
