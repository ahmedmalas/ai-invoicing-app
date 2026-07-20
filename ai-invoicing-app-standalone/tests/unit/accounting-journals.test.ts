import { describe, expect, it } from 'vitest';

import { assertJournalBalanced, invertJournalLines } from '../../src/domain/accounting/journals.js';

describe('accounting journals', () => {
  it('accepts balanced journal lines', () => {
    expect(() =>
      assertJournalBalanced([
        { accountId: 'cash', debit: 110, credit: 0 },
        { accountId: 'sales', debit: 0, credit: 100 },
        { accountId: 'gst-payable', debit: 0, credit: 10 },
      ]),
    ).not.toThrow();
  });

  it('throws when journal lines are unbalanced', () => {
    expect(() =>
      assertJournalBalanced([
        { accountId: 'cash', debit: 110, credit: 0 },
        { accountId: 'sales', debit: 0, credit: 100 },
      ]),
    ).toThrow('JOURNAL_OUT_OF_BALANCE');
  });

  it('inverts debit and credit sides', () => {
    const inverted = invertJournalLines([
      {
        accountId: 'cash',
        description: 'Receipt',
        debit: 110,
        credit: 0,
        gstAmount: null,
        gstCode: null,
      },
      {
        accountId: 'sales',
        description: 'Sale',
        debit: 0,
        credit: 110,
        gstAmount: 10,
        gstCode: 'GST',
      },
    ]);

    expect(inverted).toEqual([
      {
        accountId: 'cash',
        description: 'Receipt',
        debit: 0,
        credit: 110,
        gstAmount: null,
        gstCode: null,
      },
      {
        accountId: 'sales',
        description: 'Sale',
        debit: 110,
        credit: 0,
        gstAmount: -10,
        gstCode: 'GST',
      },
    ]);
  });
});
