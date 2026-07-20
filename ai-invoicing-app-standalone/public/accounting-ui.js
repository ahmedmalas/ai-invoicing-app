/** Accounting workspace UI helpers for Aleya Invoicing. */

export function accountingNavItems() {
  return [
    ['/workspace/accounting', 'AC', 'Accounting'],
    ['/workspace/accounting/journals', 'JL', 'Journals'],
    ['/workspace/accounting/reports', 'AR', 'Accountant'],
  ];
}

export function accountingDashboardWidgetsHtml(dashboard, money) {
  if (!dashboard) {
    return '<section class="metric-grid accounting-metrics"><article class="metric"><span>Accounting</span><strong>—</strong><small>Loading ledger…</small></article></section>';
  }
  return (
    '<section class="metric-grid accounting-metrics">' +
    [
      ['Bank balance', money(dashboard.bankBalance), dashboard.financialYearLabel || 'Cash at bank'],
      ['GST payable', money(dashboard.gstPayable), 'ATO liability'],
      ['GST receivable', money(dashboard.gstReceivable), 'Input credits'],
      ['Receivables', money(dashboard.receivables), 'Aged AR total'],
      ['Payables', money(dashboard.payables), 'Aged AP total'],
      ['Net profit', money(dashboard.netProfit), 'Year to date'],
      ['Cash flow', money(dashboard.cashFlow), 'Bank movement proxy'],
      [
        'Overdue',
        String(dashboard.overdueInvoices || 0) + ' / ' + String(dashboard.overdueSupplierBills || 0),
        'Invoices / supplier bills',
      ],
    ]
      .map(
        ([label, value, hint]) =>
          '<article class="metric"><span>' +
          label +
          '</span><strong>' +
          value +
          '</strong><small>' +
          hint +
          '</small></article>',
      )
      .join('') +
    '</section>'
  );
}

export function buildAccountingHubHtml({
  pageHead,
  escapeHtml,
  money,
  readableDate,
  accounts,
  years,
  periods,
  journals,
  dashboard,
  activeTab,
}) {
  const tabs = [
    ['overview', 'Overview', '/workspace/accounting'],
    ['accounts', 'Chart of accounts', '/workspace/accounting?tab=accounts'],
    ['periods', 'Financial years', '/workspace/accounting?tab=periods'],
    ['journals', 'Journals', '/workspace/accounting/journals'],
    ['reports', 'Reports', '/workspace/accounting/reports'],
    ['audit', 'Audit trail', '/workspace/accounting?tab=audit'],
  ];
  const tabBar =
    '<nav class="accounting-tabs">' +
    tabs
      .map(
        ([id, label, href]) =>
          '<a class="accounting-tab' +
          (activeTab === id ? ' active' : '') +
          '" href="' +
          href +
          '" data-route>' +
          label +
          '</a>',
      )
      .join('') +
    '</nav>';

  let body = '';
  if (activeTab === 'accounts') {
    const rows = (accounts || [])
      .map(
        (account) =>
          '<tr><td class="primary-cell">' +
          escapeHtml(account.accountNumber) +
          '</td><td>' +
          escapeHtml(account.name) +
          '</td><td>' +
          escapeHtml(account.accountType) +
          '</td><td>' +
          escapeHtml(account.category) +
          '</td><td>' +
          escapeHtml(account.gstDefault) +
          '</td><td>' +
          (account.isSystem ? 'System' : account.isArchived ? 'Archived' : account.isActive ? 'Active' : 'Inactive') +
          '</td></tr>',
      )
      .join('');
    body =
      '<section class="panel"><header class="panel-head"><h2>Australian chart of accounts</h2><span class="muted">' +
      (accounts || []).length +
      ' accounts</span></header><div class="table-wrap"><table><thead><tr><th>Number</th><th>Name</th><th>Type</th><th>Category</th><th>GST</th><th>Status</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6">No accounts seeded.</td></tr>') +
      '</tbody></table></div></section>';
  } else if (activeTab === 'periods') {
    const yearRows = (years || [])
      .map(
        (year) =>
          '<tr><td class="primary-cell">' +
          escapeHtml(year.label) +
          '</td><td>' +
          readableDate(year.startDate) +
          '</td><td>' +
          readableDate(year.endDate) +
          '</td><td><span class="status">' +
          escapeHtml(year.status) +
          '</span></td><td><button class="button ghost small" data-fy-close="' +
          year.id +
          '"' +
          (year.status === 'Closed' ? ' disabled' : '') +
          '>Close year</button> <button class="button ghost small" data-fy-open="' +
          year.id +
          '"' +
          (year.status === 'Open' ? ' disabled' : '') +
          '>Re-open</button></td></tr>',
      )
      .join('');
    const periodRows = (periods || [])
      .map(
        (period) =>
          '<tr><td>' +
          escapeHtml(period.label) +
          '</td><td>' +
          readableDate(period.startDate) +
          ' – ' +
          readableDate(period.endDate) +
          '</td><td><span class="status">' +
          escapeHtml(period.status) +
          '</span></td><td><button class="button ghost small" data-period-lock="' +
          period.id +
          '">Lock</button> <button class="button ghost small" data-period-unlock="' +
          period.id +
          '">Unlock</button> <button class="button ghost small" data-period-reopen="' +
          period.id +
          '">Re-open</button></td></tr>',
      )
      .join('');
    body =
      '<section class="panel"><header class="panel-head"><h2>Financial years</h2><button class="button small" data-fy-ensure>Ensure current FY</button></header><div class="table-wrap"><table><thead><tr><th>Year</th><th>Start</th><th>End</th><th>Status</th><th></th></tr></thead><tbody>' +
      (yearRows || '<tr><td colspan="5">No financial years yet.</td></tr>') +
      '</tbody></table></div></section><section class="panel section-gap"><header class="panel-head"><h2>Monthly periods</h2></header><div class="table-wrap"><table><thead><tr><th>Period</th><th>Dates</th><th>Status</th><th></th></tr></thead><tbody>' +
      (periodRows || '<tr><td colspan="4">Open a financial year to manage periods.</td></tr>') +
      '</tbody></table></div></section>';
  } else if (activeTab === 'audit') {
    body =
      '<section class="panel"><header class="panel-head"><h2>Accounting audit trail</h2></header><div id="accounting-audit-root"><p class="muted">Loading audit events…</p></div></section>';
  } else {
    body =
      accountingDashboardWidgetsHtml(dashboard, money) +
      '<section class="grid-2 section-gap"><article class="panel"><header class="panel-head"><h2>Recent journals</h2><a href="/workspace/accounting/journals" data-route>Open journals</a></header>' +
      ((journals || []).length
        ? '<div class="table-wrap"><table><thead><tr><th>Number</th><th>Date</th><th>Status</th><th>Narration</th></tr></thead><tbody>' +
          journals
            .slice(0, 8)
            .map(
              (journal) =>
                '<tr><td class="primary-cell">' +
                escapeHtml(journal.journalNumber || 'Draft') +
                '</td><td>' +
                readableDate(journal.journalDate) +
                '</td><td>' +
                escapeHtml(journal.status) +
                '</td><td>' +
                escapeHtml(journal.narration) +
                '</td></tr>',
            )
            .join('') +
          '</tbody></table></div>'
        : '<div class="panel-body"><p class="muted">Posted journals appear here after approval.</p></div>') +
      '</article><article class="panel"><header class="panel-head"><h2>Accountant reports</h2></header><div class="panel-body accounting-report-links">' +
      [
        ['Trial Balance', '/api/accounting/reports/trial-balance'],
        ['Profit & Loss', '/api/accounting/reports/profit-and-loss'],
        ['Balance Sheet', '/api/accounting/reports/balance-sheet'],
        ['GST Summary', '/api/accounting/reports/gst-summary'],
        ['BAS Report', '/api/accounting/reports/bas'],
        ['Aged Receivables', '/api/accounting/reports/aged-receivables'],
        ['Aged Payables', '/api/accounting/reports/aged-payables'],
      ]
        .map(
          ([label, href]) =>
            '<a class="summary-chip" href="/workspace/accounting/reports" data-route>' +
            escapeHtml(label) +
            '</a>',
        )
        .join('') +
      '<p class="muted">Export PDF, CSV or Excel from the Accountant reports page.</p></div></article></section>';
  }

  return (
    '<main class="page accounting-page">' +
    pageHead(
      'Accounting',
      'General ledger',
      'Australian chart of accounts, financial years, journals, GST and BAS reporting.',
      '<a class="button" href="/workspace/accounting/journals" data-route>New journal</a><a class="button secondary" href="/workspace/accounting/reports" data-route>Reports</a>',
    ) +
    tabBar +
    body +
    '</main>'
  );
}

export function buildJournalsPageHtml({ pageHead, escapeHtml, readableDate, money, journals, accounts }) {
  const rows = (journals || [])
    .map(
      (journal) =>
        '<tr><td class="primary-cell">' +
        escapeHtml(journal.journalNumber || 'Draft') +
        '</td><td>' +
        readableDate(journal.journalDate) +
        '</td><td>' +
        escapeHtml(journal.status) +
        '</td><td>' +
        escapeHtml(journal.source) +
        '</td><td>' +
        escapeHtml(journal.narration) +
        '</td><td><button class="button ghost small" data-journal-open="' +
        journal.id +
        '">Open</button></td></tr>',
    )
    .join('');
  const accountOptions = (accounts || [])
    .filter((account) => account.isActive && !account.isArchived)
    .map(
      (account) =>
        '<option value="' +
        account.id +
        '">' +
        escapeHtml(account.accountNumber + ' · ' + account.name) +
        '</option>',
    )
    .join('');
  return (
    '<main class="page accounting-page">' +
    pageHead(
      'Journals',
      'Journal engine',
      'Draft, approve, post and reverse double-entry journals. Debits must equal credits.',
      '<button class="button" data-journal-new>Manual journal</button>',
    ) +
    '<section class="panel"><header class="panel-head"><h2>Journals</h2></header><div class="table-wrap"><table><thead><tr><th>Number</th><th>Date</th><th>Status</th><th>Source</th><th>Narration</th><th></th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="6">No journals yet.</td></tr>') +
    '</tbody></table></div></section>' +
    '<template id="journal-account-options">' +
    accountOptions +
    '</template></main>'
  );
}

export function buildAccountantReportsHtml({ pageHead, escapeHtml, today }) {
  const reports = [
    ['trial-balance', 'Trial Balance', 'asAt'],
    ['profit-and-loss', 'Profit & Loss', 'range'],
    ['balance-sheet', 'Balance Sheet', 'asAt'],
    ['general-ledger', 'General Ledger', 'ledger'],
    ['gst-summary', 'GST Summary', 'range'],
    ['gst-detail', 'GST Detail', 'range'],
    ['bas', 'BAS Report', 'range'],
    ['journals', 'Journal Report', 'range'],
    ['aged-receivables', 'AR Ageing', 'asAt'],
    ['aged-payables', 'AP Ageing', 'asAt'],
  ];
  const cards = reports
    .map(
      ([id, label, mode]) =>
        '<article class="panel accounting-report-card" data-report="' +
        id +
        '" data-mode="' +
        mode +
        '"><header class="panel-head"><h2>' +
        escapeHtml(label) +
        '</h2></header><div class="panel-body"><div class="row-actions">' +
        '<button class="button small" data-report-run="json">View</button>' +
        '<button class="button secondary small" data-report-run="csv">CSV</button>' +
        '<button class="button secondary small" data-report-run="excel">Excel</button>' +
        '<button class="button ghost small" data-report-run="pdf">PDF</button>' +
        '</div></div></article>',
    )
    .join('');
  return (
    '<main class="page accounting-page">' +
    pageHead(
      'Accountant',
      'Reports pack',
      'Trial balance, ledger, P&amp;L, balance sheet, GST, BAS and ageing — exportable to PDF, CSV and Excel.',
      '',
    ) +
    '<form class="filter-bar report-filter" id="accounting-report-filter"><label>From<input type="date" name="from" value="' +
    escapeHtml(today.slice(0, 4) + '-07-01') +
    '"></label><label>To / As at<input type="date" name="to" value="' +
    escapeHtml(today) +
    '"></label><label>Ledger account<select name="accountId" id="accounting-ledger-account"><option value="">Select account for GL</option></select></label></form>' +
    '<section class="accounting-report-grid">' +
    cards +
    '</section><section class="panel section-gap"><header class="panel-head"><h2>Report output</h2></header><pre class="accounting-report-output muted" id="accounting-report-output">Run a report to preview JSON here. File exports download directly.</pre></section></main>'
  );
}

export function journalDrawerHtml(accountsHtml, today) {
  return (
    '<form class="drawer-form" id="journal-form">' +
    '<label>Date<input type="date" name="journalDate" required value="' +
    today +
    '"></label>' +
    '<label>Narration<input name="narration" required placeholder="Month-end adjustment"></label>' +
    '<label>Reference<input name="reference" placeholder="Optional reference"></label>' +
    '<label>Notes<textarea name="notes" rows="2" placeholder="Optional notes"></textarea></label>' +
    '<div class="journal-lines" data-journal-lines>' +
    journalLineRowHtml(accountsHtml) +
    journalLineRowHtml(accountsHtml) +
    '</div>' +
    '<button type="button" class="button ghost small" data-add-journal-line>Add line</button>' +
    '<div class="drawer-actions"><button class="button secondary" type="submit" name="intent" value="draft">Save draft</button>' +
    '<button class="button" type="submit" name="intent" value="approve">Save &amp; approve</button></div></form>'
  );
}

export function journalLineRowHtml(accountsHtml) {
  return (
    '<div class="journal-line-row">' +
    '<label>Account<select name="accountId" required>' +
    accountsHtml +
    '</select></label>' +
    '<label>Debit<input type="number" min="0" step="0.01" name="debit" value="0"></label>' +
    '<label>Credit<input type="number" min="0" step="0.01" name="credit" value="0"></label>' +
    '<label>Description<input name="description" placeholder="Line note"></label>' +
    '</div>'
  );
}
