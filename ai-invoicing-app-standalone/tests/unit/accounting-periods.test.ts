import { describe, expect, it } from 'vitest';

import {
  buildMonthlyPeriods,
  defaultAustralianFinancialYear,
} from '../../src/domain/accounting/periods.js';

describe('accounting periods', () => {
  it('defaults to the Australian financial year around June and July', () => {
    expect(defaultAustralianFinancialYear(new Date('2026-06-30T12:00:00.000Z'))).toEqual({
      label: 'FY2026',
      startDate: '2025-07-01',
      endDate: '2026-06-30',
    });

    expect(defaultAustralianFinancialYear(new Date('2026-07-01T00:00:00.000Z'))).toEqual({
      label: 'FY2027',
      startDate: '2026-07-01',
      endDate: '2027-06-30',
    });
  });

  it('builds twelve monthly periods from July to June', () => {
    const periods = buildMonthlyPeriods('2026-07-01', '2027-06-30');

    expect(periods).toHaveLength(12);
    expect(periods.map((period) => period.periodNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(periods[0]).toEqual({
      periodNumber: 1,
      label: '2026-07',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    });
    expect(periods[11]).toEqual({
      periodNumber: 12,
      label: '2027-06',
      startDate: '2027-06-01',
      endDate: '2027-06-30',
    });
  });
});
