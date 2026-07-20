import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

const accountSchema = z
  .object({
    id: z.string().uuid(),
    accountNumber: z.string(),
    name: z.string(),
    accountType: z.string(),
    category: z.string(),
    gstDefault: z.string(),
    isActive: z.boolean(),
    isArchived: z.boolean(),
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
    lines: z
      .array(
        z
          .object({
            debit: z.number(),
            credit: z.number(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const financialYearSchema = z
  .object({
    id: z.string().uuid(),
    label: z.string(),
    status: z.enum(['Open', 'Closed']),
  })
  .passthrough();

function accountByName(accounts: z.infer<typeof accountSchema>[], name: string) {
  const account = accounts.find((item) => item.name === name);
  if (!account) throw new Error(`Missing account ${name}`);
  return account;
}

async function postBalancedJournal(
  app: Awaited<ReturnType<typeof buildApp>>,
  payload: {
    journalDate: string;
    narration: string;
    lines: Array<{
      accountId: string;
      debit: number;
      credit: number;
      gstAmount?: number;
      gstCode?: 'GST' | 'GST_FREE' | 'INPUT' | 'CAPITAL' | 'NONE';
    }>;
  },
) {
  const createRes = await app.inject({
    method: 'POST',
    url: '/accounting/journals',
    payload,
  });
  expect(createRes.statusCode).toBe(201);
  const journal = journalSchema.parse(createRes.json());

  const approveRes = await app.inject({
    method: 'POST',
    url: `/accounting/journals/${journal.id}/approve`,
  });
  expect(approveRes.statusCode).toBe(200);

  const postRes = await app.inject({
    method: 'POST',
    url: `/accounting/journals/${journal.id}/post`,
  });
  expect(postRes.statusCode).toBe(200);
  return journalSchema.parse(postRes.json());
}

describe('accounting route coverage integration', () => {
  it('covers account mutations, year actions, journal lifecycle, ledger, reports, exports, and audit', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    try {
      const accountsRes = await app.inject({ method: 'GET', url: '/accounting/accounts' });
      expect(accountsRes.statusCode).toBe(200);
      const accounts = z
        .object({ accounts: z.array(accountSchema) })
        .parse(accountsRes.json()).accounts;
      const cash = accountByName(accounts, 'Cash at Bank');
      const sales = accountByName(accounts, 'Sales');
      const serviceIncome = accountByName(accounts, 'Service Income');

      const createAccountRes = await app.inject({
        method: 'POST',
        url: '/accounting/accounts',
        payload: {
          accountNumber: '6-9900',
          name: 'Route Coverage Expense',
          accountType: 'Expense',
          category: 'Expense',
          gstDefault: 'INPUT',
          isActive: true,
          description: 'Temporary route coverage fixture',
        },
      });
      expect(createAccountRes.statusCode).toBe(201);
      const createdAccount = accountSchema.parse(createAccountRes.json());
      expect(createdAccount.isSystem).toBe(false);

      const updateAccountRes = await app.inject({
        method: 'PUT',
        url: `/accounting/accounts/${createdAccount.id}`,
        payload: {
          accountNumber: '6-9901',
          name: 'Route Coverage Expense Updated',
          accountType: 'Expense',
          category: 'Expense',
          gstDefault: 'INPUT',
          isActive: true,
          description: 'Updated route coverage fixture',
        },
      });
      expect(updateAccountRes.statusCode).toBe(200);
      expect(accountSchema.parse(updateAccountRes.json())).toMatchObject({
        id: createdAccount.id,
        accountNumber: '6-9901',
        name: 'Route Coverage Expense Updated',
      });

      const archiveAccountRes = await app.inject({
        method: 'POST',
        url: `/accounting/accounts/${createdAccount.id}/archive`,
      });
      expect(archiveAccountRes.statusCode).toBe(200);
      expect(accountSchema.parse(archiveAccountRes.json())).toMatchObject({
        id: createdAccount.id,
        isActive: false,
        isArchived: true,
      });

      const createYearRes = await app.inject({
        method: 'POST',
        url: '/accounting/financial-years',
        payload: {
          label: 'FY2031 Route Coverage',
          startDate: '2030-07-01',
          endDate: '2031-06-30',
        },
      });
      expect(createYearRes.statusCode).toBe(201);
      const financialYear = financialYearSchema.parse(createYearRes.json());

      const closeYearRes = await app.inject({
        method: 'POST',
        url: `/accounting/financial-years/${financialYear.id}/close`,
      });
      expect(closeYearRes.statusCode).toBe(200);
      expect(financialYearSchema.parse(closeYearRes.json()).status).toBe('Closed');

      const openYearRes = await app.inject({
        method: 'POST',
        url: `/accounting/financial-years/${financialYear.id}/open`,
      });
      expect(openYearRes.statusCode).toBe(200);
      expect(financialYearSchema.parse(openYearRes.json()).status).toBe('Open');

      const draftJournalRes = await app.inject({
        method: 'POST',
        url: '/accounting/journals',
        payload: {
          journalDate: '2025-07-10',
          narration: 'Draft before update',
          lines: [
            { accountId: cash.id, debit: 40, credit: 0 },
            { accountId: sales.id, debit: 0, credit: 40 },
          ],
        },
      });
      expect(draftJournalRes.statusCode).toBe(201);
      const draftJournal = journalSchema.parse(draftJournalRes.json());

      const updateJournalRes = await app.inject({
        method: 'PUT',
        url: `/accounting/journals/${draftJournal.id}`,
        payload: {
          journalDate: '2025-07-11',
          narration: 'Updated draft route fixture',
          notes: 'Draft journal was updated before approval.',
          reference: 'ROUTE-COVERAGE-DRAFT',
          lines: [
            { accountId: cash.id, debit: 44, credit: 0 },
            { accountId: serviceIncome.id, debit: 0, credit: 44 },
          ],
        },
      });
      expect(updateJournalRes.statusCode).toBe(200);
      expect(journalSchema.parse(updateJournalRes.json())).toMatchObject({
        id: draftJournal.id,
        status: 'Draft',
        narration: 'Updated draft route fixture',
        reference: 'ROUTE-COVERAGE-DRAFT',
      });

      const attachmentRes = await app.inject({
        method: 'POST',
        url: `/accounting/journals/${draftJournal.id}/attachments`,
        payload: {
          fileName: 'journal-support.txt',
          contentType: 'text/plain',
          contentBase64: Buffer.from('journal attachment fixture').toString('base64'),
        },
      });
      expect(attachmentRes.statusCode).toBe(201);
      expect(
        z
          .object({
            id: z.string().uuid(),
            journalId: z.string().uuid(),
            fileName: z.string(),
          })
          .parse(attachmentRes.json()),
      ).toMatchObject({
        journalId: draftJournal.id,
        fileName: 'journal-support.txt',
      });

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

      const ledgerRes = await app.inject({
        method: 'GET',
        url: `/accounting/ledger/${cash.id}?from=2025-07-01&to=2025-07-31&format=json`,
      });
      expect(ledgerRes.statusCode).toBe(200);
      const ledger = z
        .object({
          account: accountSchema,
          entries: z.array(
            z
              .object({
                journalId: z.string().uuid(),
                debit: z.number(),
                credit: z.number(),
                runningBalance: z.number(),
              })
              .passthrough(),
          ),
        })
        .parse(ledgerRes.json());
      expect(ledger.account.id).toBe(cash.id);
      expect(ledger.entries).toEqual([
        expect.objectContaining({ journalId: postedJournal.id, debit: 44, runningBalance: 44 }),
      ]);

      const reverseJournalRes = await app.inject({
        method: 'POST',
        url: `/accounting/journals/${postedJournal.id}/reverse`,
      });
      expect(reverseJournalRes.statusCode).toBe(200);
      const reversalJournal = journalSchema.parse(reverseJournalRes.json());
      expect(reversalJournal).toMatchObject({
        status: 'Posted',
        source: 'Reversal',
        reference: 'ROUTE-COVERAGE-DRAFT',
      });

      const reversedOriginalRes = await app.inject({
        method: 'GET',
        url: `/accounting/journals/${postedJournal.id}`,
      });
      expect(reversedOriginalRes.statusCode).toBe(200);
      expect(journalSchema.parse(reversedOriginalRes.json()).status).toBe('Reversed');

      const cleanSaleJournal = await postBalancedJournal(app, {
        journalDate: '2026-07-15',
        narration: 'Clean GST sale for report routes',
        lines: [
          { accountId: cash.id, debit: 110, credit: 0 },
          { accountId: sales.id, debit: 0, credit: 110, gstAmount: 10, gstCode: 'GST' },
        ],
      });

      const exceptionJournal = await postBalancedJournal(app, {
        journalDate: '2026-07-16',
        narration: 'GST exception for report routes',
        lines: [
          { accountId: cash.id, debit: 105, credit: 0 },
          { accountId: sales.id, debit: 0, credit: 105, gstAmount: 9, gstCode: 'GST' },
        ],
      });

      const customerRes = await app.inject({
        method: 'POST',
        url: '/customers',
        payload: {
          displayName: 'Route Coverage Customer',
          email: 'route-coverage@example.test',
        },
      });
      expect(customerRes.statusCode).toBe(201);
      const customer = idSchema.parse(customerRes.json());

      const invoiceRes = await app.inject({
        method: 'POST',
        url: '/invoices',
        payload: {
          customerId: customer.id,
          title: 'Route coverage invoice',
          issueDate: '2026-08-01',
          dueDate: '2026-08-31',
          lineItems: [
            {
              description: 'Accounting route coverage consulting',
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
          invoiceNumber: z.string(),
          status: z.literal('Finalised'),
          totals: z.object({ total: z.number() }),
        })
        .passthrough()
        .parse(finaliseRes.json());
      expect(finalisedInvoice.totals.total).toBe(220);

      const reportExpectations = [
        {
          url: '/accounting/reports/trial-balance?asAt=2026-12-31&format=json',
          validate: (body: unknown) => {
            const report = z.object({ rows: z.array(z.object({ name: z.string() })) }).parse(body);
            expect(report.rows.map((row) => row.name)).toEqual(expect.arrayContaining(['Sales']));
          },
        },
        {
          url: '/accounting/reports/profit-and-loss?from=2026-07-01&to=2026-12-31&format=json',
          validate: (body: unknown) => {
            const report = z
              .object({ income: z.object({ total: z.number() }), netProfit: z.number() })
              .parse(body);
            expect(report.income.total).toBeGreaterThan(0);
          },
        },
        {
          url: '/accounting/reports/balance-sheet?asAt=2026-12-31&format=json',
          validate: (body: unknown) => {
            const report = z.object({ assets: z.object({ total: z.number() }) }).parse(body);
            expect(report.assets.total).toBeGreaterThan(0);
          },
        },
        {
          url: '/accounting/reports/gst-detail?from=2026-07-01&to=2026-12-31&format=json',
          validate: (body: unknown) => {
            const report = z
              .object({
                rows: z.array(z.object({ journalId: z.string().uuid(), gstAmount: z.number() })),
              })
              .parse(body);
            expect(report.rows).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ journalId: cleanSaleJournal.id, gstAmount: 10 }),
              ]),
            );
          },
        },
        {
          url: '/accounting/reports/gst-summary?from=2026-07-01&to=2026-12-31&format=json',
          validate: (body: unknown) => {
            const report = z.object({ salesGst: z.number(), netGst: z.number() }).parse(body);
            expect(report.salesGst).toBeGreaterThanOrEqual(19);
          },
        },
        {
          url: '/accounting/reports/gst-exceptions?from=2026-07-01&to=2026-12-31&format=json',
          validate: (body: unknown) => {
            const report = z
              .object({ rows: z.array(z.object({ journalId: z.string().uuid() })) })
              .parse(body);
            expect(report.rows).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ journalId: exceptionJournal.id }),
              ]),
            );
          },
        },
        {
          url: '/accounting/reports/bas?from=2026-07-01&to=2026-12-31&format=json',
          validate: (body: unknown) => {
            const report = z.object({ G1: z.number(), '1A': z.number() }).parse(body);
            expect(report.G1).toBeGreaterThan(0);
            expect(report['1A']).toBeGreaterThan(0);
          },
        },
        {
          url: '/accounting/reports/aged-receivables?asAt=2026-09-30&format=json',
          validate: (body: unknown) => {
            const report = z
              .object({
                total: z.number(),
                rows: z.array(z.object({ documentNumber: z.string(), outstanding: z.number() })),
              })
              .parse(body);
            expect(report.total).toBe(220);
            expect(report.rows).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  documentNumber: finalisedInvoice.invoiceNumber,
                  outstanding: 220,
                }),
              ]),
            );
          },
        },
        {
          url: '/accounting/reports/aged-payables?asAt=2026-09-30&format=json',
          validate: (body: unknown) => {
            const report = z.object({ total: z.number(), rows: z.array(z.unknown()) }).parse(body);
            expect(report).toMatchObject({ total: 0, rows: [] });
          },
        },
        {
          url: '/accounting/reports/journals?from=2026-07-01&to=2026-12-31&format=json',
          validate: (body: unknown) => {
            const report = z
              .object({ journals: z.array(z.object({ id: z.string().uuid(), status: z.string() })) })
              .parse(body);
            expect(report.journals).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ id: cleanSaleJournal.id, status: 'Posted' }),
              ]),
            );
          },
        },
      ];

      for (const { url, validate } of reportExpectations) {
        const reportRes = await app.inject({ method: 'GET', url });
        expect(reportRes.statusCode, url).toBe(200);
        validate(reportRes.json());
      }

      const csvRes = await app.inject({
        method: 'GET',
        url: '/accounting/reports/trial-balance?asAt=2026-12-31&format=csv',
      });
      expect(csvRes.statusCode).toBe(200);
      expect(csvRes.headers['content-type']).toContain('text/csv');
      expect(csvRes.body).toContain('accountNumber,name,type,debit,credit');

      const excelRes = await app.inject({
        method: 'GET',
        url: '/accounting/reports/profit-and-loss?from=2026-07-01&to=2026-12-31&format=excel',
      });
      expect(excelRes.statusCode).toBe(200);
      expect(excelRes.headers['content-type']).toContain('application/vnd.ms-excel');
      expect(excelRes.body).toContain('<Workbook');

      const pdfRes = await app.inject({
        method: 'GET',
        url: '/accounting/reports/balance-sheet?asAt=2026-12-31&format=pdf',
      });
      expect(pdfRes.statusCode).toBe(200);
      expect(pdfRes.headers['content-type']).toContain('application/pdf');
      expect(pdfRes.body.length).toBeGreaterThan(100);

      const auditRes = await app.inject({
        method: 'GET',
        url: `/accounting/audit?entityType=journal&entityId=${postedJournal.id}`,
      });
      expect(auditRes.statusCode).toBe(200);
      const audit = z
        .object({
          events: z.array(z.object({ action: z.string(), entityId: z.string().uuid() })),
        })
        .parse(auditRes.json());
      expect(audit.events.map((event) => event.action)).toEqual(
        expect.arrayContaining(['created', 'updated', 'approved', 'posted', 'reversed']),
      );
    } finally {
      await app.close();
    }
  });
});
