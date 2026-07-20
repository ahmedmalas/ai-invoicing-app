export interface PeriodSeed {
  periodNumber: number;
  label: string;
  startDate: string;
  endDate: string;
}

function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Australian financial year typically 1 July – 30 June. */
export function defaultAustralianFinancialYear(referenceDate = new Date()): {
  label: string;
  startDate: string;
  endDate: string;
} {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth() + 1;
  const startYear = month >= 7 ? year : year - 1;
  return {
    label: `FY${startYear + 1}`,
    startDate: isoDate(startYear, 7, 1),
    endDate: isoDate(startYear + 1, 6, 30),
  };
}

export function buildMonthlyPeriods(startDate: string, endDate: string): PeriodSeed[] {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    throw new Error('INVALID_FINANCIAL_YEAR_DATES');
  }
  const periods: PeriodSeed[] = [];
  let cursor = new Date(start);
  let periodNumber = 1;
  while (cursor <= end) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth() + 1;
    const periodStart = isoDate(y, m, 1);
    const periodEnd = isoDate(y, m, lastDayOfMonth(y, m));
    const clampedEnd = periodEnd > endDate ? endDate : periodEnd;
    const clampedStart = periodStart < startDate ? startDate : periodStart;
    periods.push({
      periodNumber,
      label: `${y}-${String(m).padStart(2, '0')}`,
      startDate: clampedStart,
      endDate: clampedEnd,
    });
    periodNumber += 1;
    cursor = new Date(Date.UTC(y, m, 1));
  }
  return periods;
}

export function dateInRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}
