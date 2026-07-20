import { roundMoney } from './journals.js';
import type {
  AccountType,
  AgeingBucket,
  AgeingReport,
  AgeingRow,
  BalanceSheetReport,
  BasReport,
  ChartAccount,
  GstDetailRow,
  GstSummaryReport,
  JournalLine,
  LedgerEntry,
  ProfitAndLossReport,
  TrialBalanceRow,
} from './types.js';

export interface PostedLine extends JournalLine {
  journalDate: string;
  journalNumber: string | null;
  narration: string;
  status: 'Posted';
  accountType: AccountType;
  accountNumber: string;
  accountName: string;
}

function normalBalanceSign(accountType: AccountType): 1 | -1 {
  return accountType === 'Asset' ||
    accountType === 'Expense' ||
    accountType === 'CostOfSales'
    ? 1
    : -1;
}

export function buildLedgerEntries(lines: PostedLine[]): LedgerEntry[] {
  const ordered = [...lines].sort((a, b) => {
    if (a.journalDate !== b.journalDate) return a.journalDate.localeCompare(b.journalDate);
    return (a.journalNumber || '').localeCompare(b.journalNumber || '');
  });
  let running = 0;
  const sign = ordered[0] ? normalBalanceSign(ordered[0].accountType) : 1;
  return ordered.map((line) => {
    running = roundMoney(running + sign * (line.debit - line.credit));
    return {
      journalId: line.journalId,
      journalNumber: line.journalNumber,
      journalDate: line.journalDate,
      narration: line.narration,
      lineDescription: line.description ?? null,
      debit: line.debit,
      credit: line.credit,
      runningBalance: running,
      status: 'Posted',
    };
  });
}

export function buildTrialBalance(accounts: ChartAccount[], lines: PostedLine[]): TrialBalanceRow[] {
  const byAccount = new Map<string, TrialBalanceRow>();
  for (const account of accounts.filter((item) => item.isActive && !item.isArchived)) {
    byAccount.set(account.id, {
      accountId: account.id,
      accountNumber: account.accountNumber,
      name: account.name,
      accountType: account.accountType,
      debit: 0,
      credit: 0,
    });
  }
  for (const line of lines) {
    const row = byAccount.get(line.accountId);
    if (!row) continue;
    row.debit = roundMoney(row.debit + line.debit);
    row.credit = roundMoney(row.credit + line.credit);
  }
  return [...byAccount.values()]
    .map((row) => {
      const net = roundMoney(row.debit - row.credit);
      if (net >= 0) return { ...row, debit: net, credit: 0 };
      return { ...row, debit: 0, credit: roundMoney(-net) };
    })
    .filter((row) => row.debit !== 0 || row.credit !== 0)
    .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
}

function sectionFromTypes(
  label: string,
  types: AccountType[],
  accounts: ChartAccount[],
  lines: PostedLine[],
): { label: string; rows: Array<{ accountNumber: string; name: string; amount: number }>; total: number } {
  const wanted = new Set(types);
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!wanted.has(line.accountType)) continue;
    const sign = normalBalanceSign(line.accountType);
    const delta = sign * (line.debit - line.credit);
    totals.set(line.accountId, roundMoney((totals.get(line.accountId) || 0) + delta));
  }
  const rows = accounts
    .filter((account) => wanted.has(account.accountType) && (totals.get(account.id) || 0) !== 0)
    .map((account) => ({
      accountNumber: account.accountNumber,
      name: account.name,
      amount: totals.get(account.id) || 0,
    }))
    .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
  return {
    label,
    rows,
    total: roundMoney(rows.reduce((sum, row) => sum + row.amount, 0)),
  };
}

export function buildProfitAndLoss(
  from: string,
  to: string,
  accounts: ChartAccount[],
  lines: PostedLine[],
): ProfitAndLossReport {
  const inRange = lines.filter((line) => line.journalDate >= from && line.journalDate <= to);
  const income = sectionFromTypes('Income', ['Income'], accounts, inRange);
  const costOfSales = sectionFromTypes('Cost of Sales', ['CostOfSales'], accounts, inRange);
  const expenses = sectionFromTypes('Expenses', ['Expense'], accounts, inRange);
  const grossProfit = roundMoney(income.total - costOfSales.total);
  const netProfit = roundMoney(grossProfit - expenses.total);
  return { from, to, income, costOfSales, grossProfit, expenses, netProfit };
}

export function buildBalanceSheet(
  asAt: string,
  accounts: ChartAccount[],
  lines: PostedLine[],
): BalanceSheetReport {
  const toDate = lines.filter((line) => line.journalDate <= asAt);
  const assets = sectionFromTypes('Assets', ['Asset'], accounts, toDate);
  const liabilities = sectionFromTypes('Liabilities', ['Liability'], accounts, toDate);
  const equityBase = sectionFromTypes('Equity', ['Equity'], accounts, toDate);
  const pnl = buildProfitAndLoss('0000-01-01', asAt, accounts, toDate);
  const equityRows = [
    ...equityBase.rows.filter((row) => row.accountNumber !== '3-1200'),
    {
      accountNumber: '3-1200',
      name: 'Current Year Earnings',
      amount: pnl.netProfit,
    },
  ].filter((row) => row.amount !== 0);
  const equityTotal = roundMoney(equityRows.reduce((sum, row) => sum + row.amount, 0));
  return {
    asAt,
    assets,
    liabilities,
    equity: { label: 'Equity', rows: equityRows, total: equityTotal },
    netAssets: roundMoney(assets.total - liabilities.total),
  };
}

export function buildGstDetail(lines: PostedLine[]): GstDetailRow[] {
  return lines
    .filter((line) => line.gstCode && line.gstCode !== 'NONE' && Number(line.gstAmount || 0) !== 0)
    .map((line) => {
      const net = roundMoney(Math.abs(line.debit - line.credit) - Math.abs(Number(line.gstAmount || 0)));
      const gst = roundMoney(Number(line.gstAmount || 0));
      return {
        journalId: line.journalId,
        journalNumber: line.journalNumber,
        journalDate: line.journalDate,
        accountNumber: line.accountNumber,
        accountName: line.accountName,
        gstCode: line.gstCode!,
        netAmount: net,
        gstAmount: gst,
        grossAmount: roundMoney(net + gst),
      };
    })
    .sort((a, b) => a.journalDate.localeCompare(b.journalDate));
}

export function buildGstSummary(from: string, to: string, detail: GstDetailRow[]): GstSummaryReport {
  const inRange = detail.filter((row) => row.journalDate >= from && row.journalDate <= to);
  let salesGst = 0;
  let purchasesGst = 0;
  let gstFreeSales = 0;
  for (const row of inRange) {
    if (row.gstCode === 'GST' && row.gstAmount > 0) salesGst = roundMoney(salesGst + row.gstAmount);
    if ((row.gstCode === 'INPUT' || row.gstCode === 'CAPITAL') && row.gstAmount !== 0) {
      purchasesGst = roundMoney(purchasesGst + Math.abs(row.gstAmount));
    }
    if (row.gstCode === 'GST_FREE') gstFreeSales = roundMoney(gstFreeSales + row.netAmount);
  }
  return {
    from,
    to,
    salesGst,
    purchasesGst,
    netGst: roundMoney(salesGst - purchasesGst),
    gstFreeSales,
    detailCount: inRange.length,
  };
}

export function buildBasReport(from: string, to: string, detail: GstDetailRow[]): BasReport {
  const inRange = detail.filter((row) => row.journalDate >= from && row.journalDate <= to);
  let G1 = 0;
  const G2 = 0;
  let G3 = 0;
  let box1A = 0;
  let box1B = 0;
  for (const row of inRange) {
    if (row.gstCode === 'GST' && row.gstAmount > 0) {
      G1 = roundMoney(G1 + row.grossAmount);
      box1A = roundMoney(box1A + row.gstAmount);
    } else if (row.gstCode === 'GST_FREE') {
      G3 = roundMoney(G3 + row.netAmount);
      G1 = roundMoney(G1 + row.netAmount);
    }
    if (row.gstCode === 'INPUT' || row.gstCode === 'CAPITAL') {
      box1B = roundMoney(box1B + Math.abs(row.gstAmount));
    }
  }
  return {
    from,
    to,
    G1,
    G2,
    G3,
    '1A': box1A,
    '1B': box1B,
    netGst: roundMoney(box1A - box1B),
  };
}

function bucketForDueDate(dueDate: string, asAt: string): AgeingBucket {
  const due = new Date(`${dueDate}T00:00:00.000Z`).getTime();
  const at = new Date(`${asAt}T00:00:00.000Z`).getTime();
  const days = Math.floor((at - due) / 86_400_000);
  if (days <= 0) return 'Current';
  if (days <= 30) return '30';
  if (days <= 60) return '60';
  if (days <= 90) return '90';
  return '120+';
}

export function buildAgeingReport(
  asAt: string,
  rows: Array<{
    partyId: string;
    partyName: string;
    documentId: string;
    documentNumber: string;
    dueDate: string;
    outstanding: number;
  }>,
): AgeingReport {
  const mapped: AgeingRow[] = rows
    .filter((row) => row.outstanding > 0.0001)
    .map((row) => ({
      ...row,
      outstanding: roundMoney(row.outstanding),
      bucket: bucketForDueDate(row.dueDate, asAt),
    }));
  const buckets: Record<AgeingBucket, number> = {
    Current: 0,
    '30': 0,
    '60': 0,
    '90': 0,
    '120+': 0,
  };
  for (const row of mapped) {
    buckets[row.bucket] = roundMoney(buckets[row.bucket] + row.outstanding);
  }
  return {
    asAt,
    buckets,
    rows: mapped.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    total: roundMoney(mapped.reduce((sum, row) => sum + row.outstanding, 0)),
  };
}

export function toCsv(rows: Array<Record<string, string | number | null | undefined>>): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]!);
  const escape = (value: string | number | null | undefined) => {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((key) => escape(row[key])).join(','))].join(
    '\n',
  );
}

/** Minimal SpreadsheetML workbook Excel can open. */
export function toExcelXml(
  sheetName: string,
  rows: Array<Record<string, string | number | null | undefined>>,
): string {
  const headers = rows.length ? Object.keys(rows[0]!) : ['Empty'];
  const cell = (value: string | number | null | undefined) => {
    const text = value == null ? '' : String(value);
    const escaped = text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
    const type = typeof value === 'number' ? 'Number' : 'String';
    return `<Cell><Data ss:Type="${type}">${escaped}</Data></Cell>`;
  };
  const headerRow = `<Row>${headers.map((header) => cell(header)).join('')}</Row>`;
  const body = rows
    .map((row) => `<Row>${headers.map((header) => cell(row[header])).join('')}</Row>`)
    .join('');
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${sheetName.replaceAll('"', '')}"><Table>
${headerRow}
${body}
</Table></Worksheet></Workbook>`;
}
