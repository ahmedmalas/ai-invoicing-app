import type { PurchaseOrder, Supplier } from '../types/entities.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderPurchaseOrderHtml(input: {
  purchaseOrder: PurchaseOrder & { lineItems: Array<{ description: string; quantity: number; unitPrice: number }> };
  supplier: Supplier;
  linkedSupplierBills?: Array<{ billNumber: string | null; status: string; total: number }>;
}): string {
  const { purchaseOrder, supplier } = input;
  const rows = purchaseOrder.lineItems
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
  <title>Purchase Order</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; font-size: 14px; }
    th { background: #f3f4f6; text-align: left; }
  </style>
</head>
<body>
  <h1>Purchase Order</h1>
  <div><strong>PO #:</strong> ${escapeHtml(purchaseOrder.purchaseOrderNumber)}</div>
  <div><strong>Status:</strong> ${escapeHtml(purchaseOrder.status)}</div>
  <div><strong>Billing Status:</strong> ${escapeHtml(purchaseOrder.billingStatus)}</div>
  <div><strong>Total Billed:</strong> ${purchaseOrder.totalBilledAmount.toFixed(2)}</div>
  <div><strong>Remaining Unbilled:</strong> ${purchaseOrder.remainingUnbilledAmount.toFixed(2)}</div>
  <div><strong>Issue Date:</strong> ${escapeHtml(purchaseOrder.issueDate)}</div>
  <div><strong>Expected Delivery:</strong> ${escapeHtml(purchaseOrder.expectedDeliveryDate ?? '')}</div>
  <div><strong>Currency:</strong> ${escapeHtml(purchaseOrder.currency)}</div>
  <div><strong>Supplier:</strong> ${escapeHtml(supplier.displayName)}</div>
  <div><strong>Supplier Ref:</strong> ${escapeHtml(purchaseOrder.supplierReference ?? '')}</div>
  <table>
    <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top: 16px;"><strong>Total:</strong> ${purchaseOrder.totals.total.toFixed(2)}</div>
  <div style="margin-top: 16px;"><strong>Linked Supplier Bills:</strong> ${
    (input.linkedSupplierBills ?? [])
      .map((bill) => `${escapeHtml(bill.billNumber ?? 'Draft')} (${escapeHtml(bill.status)})`)
      .join(', ') || 'None'
  }</div>
</body>
</html>`;
}
