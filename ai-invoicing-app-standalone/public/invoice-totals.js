/** Client-side GST totals matching src/domain/invoices/gst.ts */

const GST_RATE = 0.1;

export function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function calculateLineItem(item) {
  const quantity = Number(item.quantity) || 0;
  const unitPrice = Number(item.unitPrice) || 0;
  const gstApplicable = item.gstApplicable !== false && item.gstApplicable !== 'false';
  const lineSubtotal = roundCurrency(quantity * unitPrice);
  const lineGst = gstApplicable ? roundCurrency(lineSubtotal * GST_RATE) : 0;
  const lineTotal = roundCurrency(lineSubtotal + lineGst);
  return {
    description: String(item.description || ''),
    quantity,
    unitPrice,
    gstApplicable,
    lineSubtotal,
    lineGst,
    lineTotal,
  };
}

export function calculateInvoiceTotals(items) {
  const calculatedItems = (items || []).map(calculateLineItem);
  const subtotal = roundCurrency(
    calculatedItems.reduce((sum, item) => sum + item.lineSubtotal, 0),
  );
  const gstTotal = roundCurrency(calculatedItems.reduce((sum, item) => sum + item.lineGst, 0));
  const total = roundCurrency(subtotal + gstTotal);
  return {
    calculatedItems,
    totals: { subtotal, gstTotal, total },
  };
}
