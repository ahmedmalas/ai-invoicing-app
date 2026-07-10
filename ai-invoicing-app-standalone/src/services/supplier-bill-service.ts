import type { Supplier, SupplierBill } from '../types/entities.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderSupplierBillHtml(input: {
  bill: SupplierBill & { lineItems: Array<{ description: string; quantity: number; unitPrice: number }> };
  supplier: Supplier;
  sourcePurchaseOrderNumber?: string | null;
}): string {
  const { bill, supplier } = input;
  const rows = bill.lineItems
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.description)}</td><td style="text-align:right">${item.quantity.toFixed(2)}</td><td style="text-align:right">${item.unitPrice.toFixed(2)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Supplier Bill</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; font-size: 14px; }
    th { background: #f3f4f6; text-align: left; }
  </style>
</head>
<body>
  <h1>Supplier Bill</h1>
  <div><strong>Bill #:</strong> ${escapeHtml(bill.billNumber ?? 'Draft')}</div>
  <div><strong>Status:</strong> ${escapeHtml(bill.status)}</div>
  <div><strong>Bill Date:</strong> ${escapeHtml(bill.billDate)}</div>
  <div><strong>Due Date:</strong> ${escapeHtml(bill.dueDate)}</div>
  <div><strong>Currency:</strong> ${escapeHtml(bill.currency)}</div>
  <div><strong>Supplier:</strong> ${escapeHtml(supplier.displayName)}</div>
  <div><strong>Supplier Ref:</strong> ${escapeHtml(bill.supplierReference ?? '')}</div>
  <div><strong>Source PO:</strong> ${escapeHtml(input.sourcePurchaseOrderNumber ?? '')}</div>
  <table>
    <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top: 16px;"><strong>Total:</strong> ${bill.totals.total.toFixed(2)}</div>
</body>
</html>`;
}
