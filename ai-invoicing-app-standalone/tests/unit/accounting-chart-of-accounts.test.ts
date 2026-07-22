import { describe, expect, it } from 'vitest';

import { AUSTRALIAN_CHART_OF_ACCOUNTS } from '../../src/domain/accounting/chart-of-accounts.js';

describe('accounting chart of accounts', () => {
  it('includes required Australian accounting accounts', () => {
    const names = AUSTRALIAN_CHART_OF_ACCOUNTS.map((account) => account.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'Cash at Bank',
        'Accounts Receivable',
        'Inventory',
        'GST Receivable',
        'Accounts Payable',
        'GST Payable',
        'Owner Capital',
        'Retained Earnings',
        'Current Year Earnings',
        'Sales',
        'Service Income',
        'Purchases',
        'Office Expenses',
        'Wages',
      ]),
    );
  });

  it('uses unique account numbers', () => {
    const accountNumbers = AUSTRALIAN_CHART_OF_ACCOUNTS.map((account) => account.accountNumber);

    expect(new Set(accountNumbers).size).toBe(accountNumbers.length);
  });

  it('defines required metadata on every seed', () => {
    for (const account of AUSTRALIAN_CHART_OF_ACCOUNTS) {
      expect(account.accountType).toBeTruthy();
      expect(account.category).toBeTruthy();
      expect(account.gstDefault).toBeTruthy();
      expect(typeof account.isSystem).toBe('boolean');
    }
  });
});
