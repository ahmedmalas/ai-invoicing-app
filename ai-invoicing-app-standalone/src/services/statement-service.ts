import type { CustomerStatementReport } from '../db/database.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderCustomerStatementHtml(statement: CustomerStatementReport): string {
  const rows =
    statement.entries.length === 0
      ? '<tr><td colspan="5">No finalised invoices in selected period.</td></tr>'
      : statement.entries
          .map(
            (entry) =>
              `<tr><td>${escapeHtml(entry.invoiceNumber)}</td><td>${escapeHtml(entry.issueDate)}</td><td>${escapeHtml(entry.dueDate)}</td><td>${escapeHtml(entry.title)}</td><td style="text-align:right">${entry.total.toFixed(2)}</td></tr>`,
          )
          .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Customer Statement</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
    h1 { margin-bottom: 8px; }
    .meta { margin-bottom: 18px; }
    .summary { margin: 16px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; font-size: 14px; }
    th { background: #f3f4f6; text-align: left; }
  </style>
</head>
<body>
  <h1>Customer Statement</h1>
  <div class="meta">
    <div><strong>Customer:</strong> ${escapeHtml(statement.customer.displayName)}</div>
    <div><strong>Generated:</strong> ${escapeHtml(statement.generatedAt)}</div>
    <div><strong>Period:</strong> ${escapeHtml(statement.period.from ?? 'Beginning')} to ${escapeHtml(statement.period.to ?? 'Now')}</div>
  </div>

  <div class="summary">
    <div><strong>Opening Balance:</strong> ${statement.openingBalance.toFixed(2)}</div>
    <div><strong>Period Activity:</strong> ${statement.periodTotal.toFixed(2)}</div>
    <div><strong>Closing Balance:</strong> ${statement.closingBalance.toFixed(2)}</div>
    <div><strong>Credits:</strong> omitted (not supported by current invoice architecture)</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Invoice #</th>
        <th>Issue Date</th>
        <th>Due Date</th>
        <th>Title</th>
        <th style="text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}
