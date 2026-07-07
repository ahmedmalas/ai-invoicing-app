import type { CustomerPayment, Customer } from '../types/entities.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderPaymentReceiptHtml(input: {
  payment: CustomerPayment;
  customer: Customer;
}): string {
  const { payment, customer } = input;
  const allocationRows = payment.allocations
    .map(
      (allocation) =>
        `<tr><td>${escapeHtml(allocation.invoiceId)}</td><td style="text-align:right">${allocation.amount.toFixed(2)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Payment Receipt</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
    h1 { margin-bottom: 8px; }
    .meta { margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; font-size: 14px; }
    th { background: #f3f4f6; text-align: left; }
  </style>
</head>
<body>
  <h1>Payment Receipt</h1>
  <div class="meta">
    <div><strong>Payment #:</strong> ${escapeHtml(payment.paymentNumber)}</div>
    <div><strong>Customer:</strong> ${escapeHtml(customer.displayName)}</div>
    <div><strong>Payment Date:</strong> ${escapeHtml(payment.paymentDate)}</div>
    <div><strong>Method:</strong> ${escapeHtml(payment.paymentMethod)}</div>
    <div><strong>Reference:</strong> ${escapeHtml(payment.reference)}</div>
    <div><strong>Notes:</strong> ${escapeHtml(payment.notes ?? '')}</div>
  </div>
  <table>
    <thead>
      <tr><th>Invoice ID</th><th style="text-align:right">Allocated</th></tr>
    </thead>
    <tbody>${allocationRows}</tbody>
  </table>
  <div style="margin-top: 16px;"><strong>Total Payment:</strong> ${payment.amount.toFixed(2)}</div>
</body>
</html>`;
}
