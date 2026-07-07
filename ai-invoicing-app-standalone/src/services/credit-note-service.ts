import type { CreditNote, Customer } from '../types/entities.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderCreditNoteHtml(input: { creditNote: CreditNote; customer: Customer }): string {
  const { creditNote, customer } = input;
  const rows = creditNote.lineItems
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.description)}</td><td style="text-align:right">${item.amount.toFixed(2)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Credit Note</title>
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
  <h1>Credit Note</h1>
  <div class="meta">
    <div><strong>Credit Note #:</strong> ${escapeHtml(creditNote.creditNoteNumber)}</div>
    <div><strong>Issue Date:</strong> ${escapeHtml(creditNote.issueDate)}</div>
    <div><strong>Linked Invoice:</strong> ${escapeHtml(creditNote.linkedInvoiceId)}</div>
    <div><strong>Customer:</strong> ${escapeHtml(customer.displayName)}</div>
    <div><strong>Reason:</strong> ${escapeHtml(creditNote.reason)}</div>
  </div>

  <table>
    <thead>
      <tr><th>Description</th><th style="text-align:right">Amount</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div style="margin-top: 16px;"><strong>Total Credit:</strong> ${creditNote.totalCredit.toFixed(2)}</div>
</body>
</html>`;
}
