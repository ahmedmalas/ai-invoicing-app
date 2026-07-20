import type { JournalLineInput } from './types.js';

const MONEY_EPSILON = 0.005;

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function sumDebits(lines: JournalLineInput[]): number {
  return roundMoney(lines.reduce((sum, line) => sum + Number(line.debit || 0), 0));
}

export function sumCredits(lines: JournalLineInput[]): number {
  return roundMoney(lines.reduce((sum, line) => sum + Number(line.credit || 0), 0));
}

export function assertJournalBalanced(lines: JournalLineInput[]): void {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new Error('JOURNAL_REQUIRES_TWO_LINES');
  }
  for (const line of lines) {
    const debit = Number(line.debit || 0);
    const credit = Number(line.credit || 0);
    if (!Number.isFinite(debit) || !Number.isFinite(credit)) {
      throw new Error('JOURNAL_INVALID_AMOUNT');
    }
    if (debit < 0 || credit < 0) {
      throw new Error('JOURNAL_NEGATIVE_AMOUNT');
    }
    if (debit > 0 && credit > 0) {
      throw new Error('JOURNAL_LINE_BOTH_SIDES');
    }
    if (debit === 0 && credit === 0) {
      throw new Error('JOURNAL_LINE_EMPTY');
    }
    if (!line.accountId) {
      throw new Error('JOURNAL_LINE_ACCOUNT_REQUIRED');
    }
  }
  const debits = sumDebits(lines);
  const credits = sumCredits(lines);
  if (Math.abs(debits - credits) > MONEY_EPSILON) {
    throw new Error('JOURNAL_OUT_OF_BALANCE');
  }
}

export function invertJournalLines(lines: JournalLineInput[]): JournalLineInput[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    description: line.description ?? null,
    debit: Number(line.credit || 0),
    credit: Number(line.debit || 0),
    gstAmount: line.gstAmount == null ? null : -Number(line.gstAmount),
    gstCode: line.gstCode ?? null,
  }));
}
