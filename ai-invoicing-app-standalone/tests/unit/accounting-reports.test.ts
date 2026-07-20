import { describe, expect, it } from 'vitest';

import {
  buildAgeingReport,
  buildBalanceSheet,
  buildBasReport,
  buildProfitAndLoss,
  buildTrialBalance,
  toCsv,
  toExcelXml,
} from '../../src/domain/accounting/reports.js';
import type { ChartAccount } from '../../src/domain/accounting/types.js';
import type { PostedLine } from '../../src/domain/accounting/reports.js';

const baseTimestamp = '2026-07-01T00:00:00.000Z';

function account(input: {
  id: string;
  accountNumber: string;
  name: string;
  accountType: ChartAccount['accountType'];
  category: ChartAccount['category'];
}): ChartAccount {
  return {
    ...input,
    gstDefault: 'NONE',
    isActive: true,
    isArchived: false,
    isSystem: false,
    description: null,
    createdAt: baseTimestamp,
    updatedAt: baseTimestamp,
  };
}

const accounts = [
  account({
    id: 'cash',
    accountNumber: '1-1000',
    name: 'Cash at Bank',
    accountType: 'Asset',
    category: 'Current Asset',
  }),
  account({
    id: 'gst-payable',
    accountNumber: '2-1100',
    name: 'GST Payable',
    accountType: 'Liability',
    category: 'Current Liability',
  }),
  account({
    id: 'owner-capital',
    accountNumber: '3-1000',
    name: 'Owner Capital',
    accountType: 'Equity',
    category: 'Equity',
  }),
  account({
    id: 'current-year-earnings',
    accountNumber: '3-1200',
    name: 'Current Year Earnings',
    accountType: 'Equity',
    category: 'Equity',
  }),
  account({
    id: 'sales',
    accountNumber: '4-1000',
    name: 'Sales',
    accountType: 'Income',
    category: 'Income',
  }),
  account({
    id: 'office-expenses',
    accountNumber: '6-1050',
    name: 'Office Expenses',
    accountType: 'Expense',
    category: 'Expense',
  }),
];

function postedLine(input: {
  journalId: string;
  lineNumber: number;
  accountId: string;
  debit: number;
  credit: number;
  journalDate?: string;
}): PostedLine {
  const found = accounts.find((item) => item.id === input.accountId);
  if (!found) throw new Error(`Missing test account ${input.accountId}`);

  return {
    id: `${input.journalId}-${input.lineNumber}`,
    journalId: input.journalId,
    lineNumber: input.lineNumber,
    accountId: input.accountId,
    description: null,
    debit: input.debit,
    credit: input.credit,
    gstAmount: null,
    gstCode: null,
    journalDate: input.journalDate ?? '2026-07-15',
    journalNumber: input.journalId,
    narration: 'Fixture journal',
    status: 'Posted',
    accountType: found.accountType,
    accountNumber: found.accountNumber,
    accountName: found.name,
  };
}

const postedLines = [
  postedLine({ journalId: 'JNL-1', lineNumber: 1, accountId: 'cash', debit: 110, credit: 0 }),
  postedLine({ journalId: 'JNL-1', lineNumber: 2, accountId: 'sales', debit: 0, credit: 110 }),
  postedLine({
    journalId: 'JNL-2',
    lineNumber: 1,
    accountId: 'office-expenses',
    debit: 33,
    credit: 0,
  }),
  postedLine({ journalId: 'JNL-2', lineNumber: 2, accountId: 'cash', debit: 0, credit: 33 }),
  postedLine({ journalId: 'JNL-3', lineNumber: 1, accountId: 'cash', debit: 50, credit: 0 }),
  postedLine({
    journalId: 'JNL-3',
    lineNumber: 2,
    accountId: 'owner-capital',
    debit: 0,
    credit: 50,
  }),
];

function rowByName<T extends { name: string }>(rows: T[], name: string): T {
  const row = rows.find((item) => item.name === name);
  if (!row) throw new Error(`Missing row ${name}`);
  return row;
}

describe('accounting reports', () => {
  it('builds a trial balance from posted lines', () => {
    const rows = buildTrialBalance(accounts, postedLines);

    expect(rowByName(rows, 'Cash at Bank')).toMatchObject({ debit: 127, credit: 0 });
    expect(rowByName(rows, 'Sales')).toMatchObject({ debit: 0, credit: 110 });
    expect(rowByName(rows, 'Office Expenses')).toMatchObject({ debit: 33, credit: 0 });
    expect(rowByName(rows, 'Owner Capital')).toMatchObject({ debit: 0, credit: 50 });
    expect(rows.reduce((sum, row) => sum + row.debit, 0)).toBe(160);
    expect(rows.reduce((sum, row) => sum + row.credit, 0)).toBe(160);
  });

  it('builds profit and loss and balance sheet reports', () => {
    const profitAndLoss = buildProfitAndLoss('2026-07-01', '2026-07-31', accounts, postedLines);

    expect(profitAndLoss.income.total).toBe(110);
    expect(profitAndLoss.expenses.total).toBe(33);
    expect(profitAndLoss.grossProfit).toBe(110);
    expect(profitAndLoss.netProfit).toBe(77);

    const balanceSheet = buildBalanceSheet('2026-07-31', accounts, postedLines);

    expect(balanceSheet.assets.total).toBe(127);
    expect(balanceSheet.liabilities.total).toBe(0);
    expect(balanceSheet.equity.total).toBe(127);
    expect(balanceSheet.netAssets).toBe(127);
    expect(rowByName(balanceSheet.equity.rows, 'Current Year Earnings').amount).toBe(77);
  });

  it('builds BAS and ageing reports', () => {
    const bas = buildBasReport('2026-07-01', '2026-09-30', [
      {
        journalId: 'JNL-GST',
        journalNumber: 'JNL-2026-000001',
        journalDate: '2026-07-15',
        accountNumber: '4-1000',
        accountName: 'Sales',
        gstCode: 'GST',
        netAmount: 100,
        gstAmount: 10,
        grossAmount: 110,
      },
      {
        journalId: 'JNL-FREE',
        journalNumber: 'JNL-2026-000002',
        journalDate: '2026-07-16',
        accountNumber: '4-1200',
        accountName: 'Interest Income',
        gstCode: 'GST_FREE',
        netAmount: 40,
        gstAmount: 0,
        grossAmount: 40,
      },
      {
        journalId: 'JNL-INPUT',
        journalNumber: 'JNL-2026-000003',
        journalDate: '2026-07-17',
        accountNumber: '6-1050',
        accountName: 'Office Expenses',
        gstCode: 'INPUT',
        netAmount: 50,
        gstAmount: -5,
        grossAmount: 55,
      },
    ]);

    expect(bas).toMatchObject({
      G1: 150,
      G2: 0,
      G3: 40,
      '1A': 10,
      '1B': 5,
      netGst: 5,
    });

    const ageing = buildAgeingReport('2026-09-30', [
      {
        partyId: 'customer-1',
        partyName: 'Acme Pty Ltd',
        documentId: 'invoice-1',
        documentNumber: 'INV-1',
        dueDate: '2026-10-01',
        outstanding: 100,
      },
      {
        partyId: 'customer-2',
        partyName: 'Beta Pty Ltd',
        documentId: 'invoice-2',
        documentNumber: 'INV-2',
        dueDate: '2026-09-15',
        outstanding: 50,
      },
      {
        partyId: 'customer-3',
        partyName: 'Closed Pty Ltd',
        documentId: 'invoice-3',
        documentNumber: 'INV-3',
        dueDate: '2026-08-15',
        outstanding: 0,
      },
    ]);

    expect(ageing.total).toBe(150);
    expect(ageing.buckets).toMatchObject({ Current: 100, '30': 50, '60': 0 });
    expect(ageing.rows.map((row) => row.documentNumber)).toEqual(['INV-2', 'INV-1']);
  });

  it('exports rows to CSV and Excel XML', () => {
    const rows = [
      { accountNumber: '1-1000', name: 'Cash at Bank', debit: 127, credit: 0 },
      { accountNumber: '4-1000', name: 'Sales, Services', debit: 0, credit: 110 },
      { accountNumber: '6-1050', name: 'A&B <Due>', debit: 33, credit: 0 },
    ];

    expect(toCsv(rows)).toContain('4-1000,"Sales, Services",0,110');

    const xml = toExcelXml('TrialBalance', rows);

    expect(xml).toContain('ss:Name="TrialBalance"');
    expect(xml).toContain('A&amp;B &lt;Due&gt;');
    expect(xml).toContain('ss:Type="Number">127</Data>');
  });
});
