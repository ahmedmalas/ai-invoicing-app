import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';
import { AUSTRALIAN_CHART_OF_ACCOUNTS } from '../../src/domain/accounting/chart-of-accounts.js';

const idSchema = z.object({ id: z.string().uuid() });
const accountSchema = z
  .object({
    id: z.string().uuid(),
    accountNumber: z.string(),
    name: z.string(),
    isSystem: z.boolean(),
  })
  .passthrough();
const journalSchema = z
  .object({
    id: z.string().uuid(),
    status: z.string(),
    source: z.string(),
    narration: z.string(),
    journalNumber: z.string().nullable(),
    reference: z.string().nullable(),
  })
  .passthrough();

function accountByName(accounts: z.infer<typeof accountSchema>[], name: string) {
  const account = accounts.find((item) => item.name === name);
  if (!account) throw new Error(`Missing account ${name}`);
  return account;
}

function sum(rows: Array<{ debit: number; credit: number }>, side: 'debit' | 'credit') {
  return rows.reduce((total, row) => total + row[side], 0);
}

describe('accounting foundations integration', () => {
  it('covers seeded accounts, journals, reporting, locking, exports, invoice finalise, and audit', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    try {
      const accountsRes = await app.inject({ method: 'GET', url: '/accounting/accounts' });
      expect(accountsRes.statusCode).toBe(200);
      const accounts = z
        .object({ accounts: z.array(accountSchema) })
        .parse(accountsRes.json()).accounts;
      expect(accounts).toHaveLength(AUSTRALIAN_CHART_OF_ACCOUNTS.length);
      expect(accounts.map((account) => account.name)).toEqual(
        expect.arrayContaining([
          'Cash at Bank',
          'Accounts Receivable',
          'GST Payable',
          'Sales',
          'Service Income',
        ]),
      );

      const cash = accountByName(accounts, 'Cash at Bank');
      const sales = accountByName(accounts, 'Sales');
      const ownerCapital = accountByName(accounts, 'Owner Capital');

      const createJournalRes = await app.inject({
        method: 'POST',
        url: '/accounting/journals',
        payload: {
          journalDate: '2026-07-15',
          narration: 'GST sale fixture',
          lines: [
            { accountId: cash.id, debit: 110, credit: 0 },
            { accountId: sales.id, debit: 0, credit: 110, gstAmount: 10, gstCode: 'GST' },
          ],
        },
      });
      expect(createJournalRes.statusCode).toBe(201);
      const draftJournal = journalSchema.parse(createJournalRes.json());
      expect(draftJournal.status).toBe('Draft');

      const approveJournalRes = await app.inject({
        method: 'POST',
        url: `/accounting/journals/${draftJournal.id}/approve`,
      });
      expect(approveJournalRes.statusCode).toBe(200);
      expect(journalSchema.parse(approveJournalRes.json()).status).toBe('Approved');

      const postJournalRes = await app.inject({
        method: 'POST',
        url: `/accounting/journals/${draftJournal.id}/post`,
      });
      expect(postJournalRes.statusCode).toBe(200);
      const postedJournal = journalSchema.parse(postJournalRes.json());
      expect(postedJournal.status).toBe('Posted');
      expect(postedJournal.journalNumber).toMatch(/^JNL-\d{4}-\d{6}$/);

      const trialBalanceRes = await app.inject({
        method: 'GET',
        url: '/accounting/reports/trial-balance?asAt=2026-07-31',
      });
      expect(trialBalanceRes.statusCode).toBe(200);
      const trialBalance = z
        .object({
          rows: z.array(z.object({ name: z.string(), debit: z.number(), credit: z.number() })),
        })
        .parse(trialBalanceRes.json()).rows;
      expect(sum(trialBalance, 'debit')).toBe(sum(trialBalance, 'credit'));
      expect(trialBalance.some((row) => row.name === 'Sales' && row.credit === 110)).toBe(true);

      const unbalancedRes = await app.inject({
        method: 'POST',
        url: '/accounting/journals',
        payload: {
          journalDate: '2026-07-16',
          narration: 'Unbalanced fixture',
          lines: [
            { accountId: cash.id, debit: 110, credit: 0 },
            { accountId: sales.id, debit: 0, credit: 100 },
          ],
        },
      });
      expect(unbalancedRes.statusCode).toBeGreaterThanOrEqual(400);

      const lockJournalRes = await app.inject({
        method: 'POST',
        url: '/accounting/journals',
        payload: {
          journalDate: '2026-08-15',
          narration: 'Owner contribution fixture',
          lines: [
            { accountId: cash.id, debit: 50, credit: 0 },
            { accountId: ownerCapital.id, debit: 0, credit: 50 },
          ],
        },
      });
      expect(lockJournalRes.statusCode).toBe(201);
      const lockJournal = journalSchema.parse(lockJournalRes.json());
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/accounting/journals/${lockJournal.id}/approve`,
          })
        ).statusCode,
      ).toBe(200);

      const periodsRes = await app.inject({ method: 'GET', url: '/accounting/periods' });
      expect(periodsRes.statusCode).toBe(200);
      const periods = z
        .object({
          periods: z.array(
            z.object({
              id: z.string().uuid(),
              startDate: z.string(),
              endDate: z.string(),
              status: z.string(),
            }),
          ),
        })
        .parse(periodsRes.json()).periods;
      const augustPeriod = periods.find(
        (period) => period.startDate <= '2026-08-15' && period.endDate >= '2026-08-15',
      );
      if (!augustPeriod) throw new Error('Missing August 2026 accounting period');

      const lockPeriodRes = await app.inject({
        method: 'POST',
        url: `/accounting/periods/${augustPeriod.id}/lock`,
      });
      expect(lockPeriodRes.statusCode).toBe(200);
      expect(z.object({ status: z.string() }).parse(lockPeriodRes.json()).status).toBe('Locked');

      const lockedPostRes = await app.inject({
        method: 'POST',
        url: `/accounting/journals/${lockJournal.id}/post`,
      });
      expect(lockedPostRes.statusCode).toBeGreaterThanOrEqual(400);

      const unlockPeriodRes = await app.inject({
        method: 'POST',
        url: `/accounting/periods/${augustPeriod.id}/unlock`,
      });
      expect(unlockPeriodRes.statusCode).toBe(200);
      expect(z.object({ status: z.string() }).parse(unlockPeriodRes.json()).status).toBe('Open');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/accounting/periods/${augustPeriod.id}/lock`,
          })
        ).statusCode,
      ).toBe(200);
      const reopenPeriodRes = await app.inject({
        method: 'POST',
        url: `/accounting/periods/${augustPeriod.id}/reopen`,
      });
      expect(reopenPeriodRes.statusCode).toBe(200);
      expect(z.object({ status: z.string() }).parse(reopenPeriodRes.json()).status).toBe('Open');

      const reopenedPostRes = await app.inject({
        method: 'POST',
        url: `/accounting/journals/${lockJournal.id}/post`,
      });
      expect(reopenedPostRes.statusCode).toBe(200);
      expect(journalSchema.parse(reopenedPostRes.json()).status).toBe('Posted');

      const profitAndLossRes = await app.inject({
        method: 'GET',
        url: '/accounting/reports/profit-and-loss?from=2026-07-01&to=2026-12-31',
      });
      expect(profitAndLossRes.statusCode).toBe(200);
      const profitAndLoss = z
        .object({
          income: z.object({ total: z.number() }),
          netProfit: z.number(),
        })
        .parse(profitAndLossRes.json());
      expect(profitAndLoss.income.total).toBe(110);
      expect(profitAndLoss.netProfit).toBe(110);

      const balanceSheetRes = await app.inject({
        method: 'GET',
        url: '/accounting/reports/balance-sheet?asAt=2026-12-31',
      });
      expect(balanceSheetRes.statusCode).toBe(200);
      const balanceSheet = z
        .object({
          assets: z.object({ total: z.number() }),
          equity: z.object({ total: z.number() }),
          netAssets: z.number(),
        })
        .parse(balanceSheetRes.json());
      expect(balanceSheet.assets.total).toBe(160);
      expect(balanceSheet.equity.total).toBe(160);
      expect(balanceSheet.netAssets).toBe(160);

      const gstSummaryRes = await app.inject({
        method: 'GET',
        url: '/accounting/reports/gst-summary?from=2026-07-01&to=2026-07-31',
      });
      expect(gstSummaryRes.statusCode).toBe(200);
      const gstSummary = z
        .object({ salesGst: z.number(), purchasesGst: z.number(), netGst: z.number() })
        .parse(gstSummaryRes.json());
      expect(gstSummary).toMatchObject({ salesGst: 10, purchasesGst: 0, netGst: 10 });

      const basRes = await app.inject({
        method: 'GET',
        url: '/accounting/reports/bas?from=2026-07-01&to=2026-07-31',
      });
      expect(basRes.statusCode).toBe(200);
      expect(z.object({ G1: z.number(), '1A': z.number() }).parse(basRes.json())).toMatchObject({
        G1: 110,
        '1A': 10,
      });

      const customerRes = await app.inject({
        method: 'POST',
        url: '/customers',
        payload: {
          displayName: 'Accounting Customer',
          email: 'accounts@example.test',
        },
      });
      expect(customerRes.statusCode).toBe(201);
      const customer = idSchema.parse(customerRes.json());

      const invoiceRes = await app.inject({
        method: 'POST',
        url: '/invoices',
        payload: {
          customerId: customer.id,
          title: 'Accounting invoice',
          issueDate: '2026-07-20',
          dueDate: '2026-08-03',
          lineItems: [
            {
              description: 'Consulting',
              quantity: 1,
              unitPrice: 200,
              gstApplicable: true,
            },
          ],
        },
      });
      expect(invoiceRes.statusCode).toBe(201);
      const invoice = idSchema.parse(invoiceRes.json());

      const finaliseRes = await app.inject({
        method: 'POST',
        url: `/invoices/${invoice.id}/finalise`,
      });
      expect(finaliseRes.statusCode).toBe(200);
      const finalisedInvoice = z
        .object({
          id: z.string().uuid(),
          invoiceNumber: z.string(),
          status: z.literal('Finalised'),
          totals: z.object({ total: z.number() }),
        })
        .parse(finaliseRes.json());
      expect(finalisedInvoice.totals.total).toBe(220);

      const agedReceivablesRes = await app.inject({
        method: 'GET',
        url: '/accounting/reports/aged-receivables?asAt=2026-08-25',
      });
      expect(agedReceivablesRes.statusCode).toBe(200);
      const agedReceivables = z
        .object({
          total: z.number(),
          rows: z.array(
            z.object({
              partyName: z.string(),
              documentNumber: z.string(),
              outstanding: z.number(),
            }),
          ),
        })
        .parse(agedReceivablesRes.json());
      expect(agedReceivables.total).toBe(220);
      expect(agedReceivables.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            partyName: 'Accounting Customer',
            documentNumber: finalisedInvoice.invoiceNumber,
            outstanding: 220,
          }),
        ]),
      );

      const dashboardRes = await app.inject({ method: 'GET', url: '/accounting/dashboard' });
      expect(dashboardRes.statusCode).toBe(200);
      expect(
        z
          .object({
            bankBalance: z.number(),
            gstPayable: z.number(),
            receivables: z.number(),
            netProfit: z.number(),
            financialYearLabel: z.string(),
            overdueInvoices: z.number(),
          })
          .parse(dashboardRes.json()),
      ).toMatchObject({
        bankBalance: 160,
        receivables: 220,
        financialYearLabel: 'FY2027',
        overdueInvoices: 0,
      });

      const auditRes = await app.inject({
        method: 'GET',
        url: `/accounting/audit?entityType=journal&entityId=${postedJournal.id}`,
      });
      expect(auditRes.statusCode).toBe(200);
      const auditEvents = z
        .object({ events: z.array(z.object({ action: z.string(), entityId: z.string().uuid() })) })
        .parse(auditRes.json()).events;
      expect(auditEvents.map((event) => event.action)).toEqual(
        expect.arrayContaining(['created', 'approved', 'posted']),
      );

      const csvRes = await app.inject({
        method: 'GET',
        url: '/accounting/reports/trial-balance?asAt=2026-12-31&format=csv',
      });
      expect(csvRes.statusCode).toBe(200);
      expect(csvRes.headers['content-type']).toContain('text/csv');
      expect(csvRes.body).toContain('accountNumber,name,type,debit,credit');
      expect(csvRes.body).toContain('Cash at Bank');

      const journalsRes = await app.inject({ method: 'GET', url: '/accounting/journals' });
      expect(journalsRes.statusCode).toBe(200);
      const journals = z
        .object({ journals: z.array(journalSchema) })
        .parse(journalsRes.json()).journals;
      expect(journals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'Auto',
            status: 'Posted',
            reference: finalisedInvoice.id,
          }),
        ]),
      );
    } finally {
      await app.close();
    }
  });
});
