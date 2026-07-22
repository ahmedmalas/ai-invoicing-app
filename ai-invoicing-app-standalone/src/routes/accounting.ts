import { z } from 'zod';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import PDFDocument from 'pdfkit';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const journalLineSchema = z.object({
  accountId: z.string().uuid(),
  description: z.string().optional().nullable(),
  debit: z.number().nonnegative(),
  credit: z.number().nonnegative(),
  gstAmount: z.number().optional().nullable(),
  gstCode: z.enum(['GST', 'GST_FREE', 'INPUT', 'CAPITAL', 'NONE']).optional().nullable(),
});

const accountBodySchema = z.object({
  accountNumber: z.string().min(1),
  name: z.string().min(1),
  accountType: z.enum(['Asset', 'Liability', 'Equity', 'Income', 'CostOfSales', 'Expense']),
  category: z.enum([
    'Current Asset',
    'Non-Current Asset',
    'Current Liability',
    'Non-Current Liability',
    'Equity',
    'Income',
    'Cost of Sales',
    'Expense',
  ]),
  gstDefault: z.enum(['GST', 'GST_FREE', 'INPUT', 'CAPITAL', 'NONE']),
  isActive: z.boolean().optional(),
  description: z.string().optional().nullable(),
});

function periodQuery(requestQuery: unknown) {
  return z
    .object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      asAt: isoDate.optional(),
      format: z.enum(['json', 'csv', 'excel', 'pdf']).optional(),
    })
    .parse(requestQuery);
}

async function pdfTable(
  title: string,
  rows: Array<Record<string, string | number | null | undefined>>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).text(title, { underline: true });
    doc.moveDown();
    doc.fontSize(9);
    if (!rows.length) {
      doc.text('No rows');
    } else {
      const headers = Object.keys(rows[0]!);
      doc.text(headers.join(' | '));
      doc.moveDown(0.3);
      for (const row of rows.slice(0, 80)) {
        doc.text(headers.map((header) => String(row[header] ?? '')).join(' | '));
      }
      if (rows.length > 80) doc.text(`…and ${rows.length - 80} more rows`);
    }
    doc.end();
  });
}

async function sendExport(
  reply: FastifyReply,
  format: 'json' | 'csv' | 'excel' | 'pdf' | undefined,
  title: string,
  payload: unknown,
  rows: Array<Record<string, string | number | null | undefined>>,
  app: {
    db: {
      exportAccountingCsv: (
        rows: Array<Record<string, string | number | null | undefined>>,
      ) => Promise<string> | string;
      exportAccountingExcel: (
        sheetName: string,
        rows: Array<Record<string, string | number | null | undefined>>,
      ) => Promise<string> | string;
    };
  },
) {
  if (format === 'csv') {
    const csv = await app.db.exportAccountingCsv(rows);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${title}.csv"`)
      .send(csv);
  }
  if (format === 'excel') {
    const excel = await app.db.exportAccountingExcel(title, rows);
    return reply
      .header('Content-Type', 'application/vnd.ms-excel')
      .header('Content-Disposition', `attachment; filename="${title}.xls"`)
      .send(excel);
  }
  if (format === 'pdf') {
    const pdf = await pdfTable(title, rows);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${title}.pdf"`)
      .send(pdf);
  }
  return reply.code(200).send(payload);
}

function actorId(request: { auth?: { userId?: string } | null }): string | null | undefined {
  return request.auth?.userId;
}

export const accountingRoutes: FastifyPluginAsync = async (app) => {
  app.get('/accounting/dashboard', async () => app.db.getAccountingDashboard());

  app.get('/accounting/accounts', async (request) => {
    const query = z
      .object({
        includeArchived: z.coerce.boolean().optional(),
        accountType: z.string().optional(),
      })
      .parse(request.query);
    return {
      accounts: await app.db.listChartAccounts({
        ...(query.includeArchived !== undefined ? { includeArchived: query.includeArchived } : {}),
        ...(query.accountType !== undefined ? { accountType: query.accountType } : {}),
      }),
    };
  });

  app.post('/accounting/accounts', async (request, reply) => {
    const body = accountBodySchema.parse(request.body);
    const account = await app.db.upsertChartAccount({
      accountNumber: body.accountNumber,
      name: body.name,
      accountType: body.accountType,
      category: body.category,
      gstDefault: body.gstDefault,
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(actorId(request) !== undefined ? { actorUserId: actorId(request) ?? null } : {}),
    });
    return reply.code(201).send(account);
  });

  app.put('/accounting/accounts/:accountId', async (request) => {
    const params = z.object({ accountId: z.string().uuid() }).parse(request.params);
    const body = accountBodySchema.parse(request.body);
    return app.db.upsertChartAccount({
      id: params.accountId,
      accountNumber: body.accountNumber,
      name: body.name,
      accountType: body.accountType,
      category: body.category,
      gstDefault: body.gstDefault,
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(actorId(request) !== undefined ? { actorUserId: actorId(request) ?? null } : {}),
    });
  });

  app.post('/accounting/accounts/:accountId/archive', async (request) => {
    const params = z.object({ accountId: z.string().uuid() }).parse(request.params);
    return app.db.archiveChartAccount(params.accountId, actorId(request) ?? null);
  });

  app.get('/accounting/financial-years', async () => ({
    financialYears: await app.db.listFinancialYears(),
  }));

  app.post('/accounting/financial-years', async (request, reply) => {
    const body = z
      .object({
        label: z.string().optional(),
        startDate: isoDate.optional(),
        endDate: isoDate.optional(),
      })
      .parse(request.body ?? {});
    const year = await app.db.createFinancialYear({
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.startDate !== undefined ? { startDate: body.startDate } : {}),
      ...(body.endDate !== undefined ? { endDate: body.endDate } : {}),
      ...(actorId(request) !== undefined ? { actorUserId: actorId(request) ?? null } : {}),
    });
    return reply.code(201).send(year);
  });

  app.post('/accounting/financial-years/ensure-current', async () =>
    app.db.ensureCurrentFinancialYear(),
  );

  app.post('/accounting/financial-years/:yearId/:action', async (request) => {
    const params = z
      .object({
        yearId: z.string().uuid(),
        action: z.enum(['open', 'close']),
      })
      .parse(request.params);
    return app.db.setFinancialYearStatus(
      params.yearId,
      params.action === 'close' ? 'Closed' : 'Open',
      actorId(request) ?? null,
    );
  });

  app.get('/accounting/periods', async (request) => {
    const query = z.object({ financialYearId: z.string().uuid().optional() }).parse(request.query);
    return {
      periods: await app.db.listAccountingPeriods(
        query.financialYearId !== undefined ? query.financialYearId : undefined,
      ),
    };
  });

  app.post('/accounting/periods/:periodId/:action', async (request) => {
    const params = z
      .object({
        periodId: z.string().uuid(),
        action: z.enum(['lock', 'unlock', 'reopen', 'close']),
      })
      .parse(request.params);
    const status =
      params.action === 'lock' ? 'Locked' : params.action === 'close' ? 'Closed' : 'Open';
    return app.db.setAccountingPeriodStatus(params.periodId, status, actorId(request) ?? null);
  });

  app.get('/accounting/journals', async (request) => {
    const query = z
      .object({
        status: z.enum(['Draft', 'Approved', 'Posted', 'Reversed']).optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
      })
      .parse(request.query);
    return {
      journals: await app.db.listJournals({
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
      }),
    };
  });

  app.get('/accounting/journals/:journalId', async (request, reply) => {
    const params = z.object({ journalId: z.string().uuid() }).parse(request.params);
    const journal = await app.db.getJournalById(params.journalId);
    if (!journal) return reply.code(404).send({ message: 'Journal not found' });
    return journal;
  });

  app.post('/accounting/journals', async (request, reply) => {
    const body = z
      .object({
        journalDate: isoDate,
        narration: z.string().min(1),
        notes: z.string().optional().nullable(),
        reference: z.string().optional().nullable(),
        source: z.enum(['Manual', 'Auto']).optional(),
        status: z.enum(['Draft', 'Approved']).optional(),
        lines: z.array(journalLineSchema).min(2),
      })
      .parse(request.body);
    const journal = await app.db.createJournal({
      journalDate: body.journalDate,
      narration: body.narration,
      lines: body.lines,
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.reference !== undefined ? { reference: body.reference } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(actorId(request) !== undefined ? { actorUserId: actorId(request) ?? null } : {}),
    });
    return reply.code(201).send(journal);
  });

  app.put('/accounting/journals/:journalId', async (request) => {
    const params = z.object({ journalId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        journalDate: isoDate.optional(),
        narration: z.string().min(1).optional(),
        notes: z.string().optional().nullable(),
        reference: z.string().optional().nullable(),
        lines: z.array(journalLineSchema).min(2).optional(),
      })
      .parse(request.body);
    return app.db.updateDraftJournal(params.journalId, {
      ...(body.journalDate !== undefined ? { journalDate: body.journalDate } : {}),
      ...(body.narration !== undefined ? { narration: body.narration } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.reference !== undefined ? { reference: body.reference } : {}),
      ...(body.lines !== undefined ? { lines: body.lines } : {}),
      ...(actorId(request) !== undefined ? { actorUserId: actorId(request) ?? null } : {}),
    });
  });

  app.post('/accounting/journals/:journalId/approve', async (request) => {
    const params = z.object({ journalId: z.string().uuid() }).parse(request.params);
    return app.db.approveJournal(params.journalId, actorId(request) ?? null);
  });

  app.post('/accounting/journals/:journalId/post', async (request) => {
    const params = z.object({ journalId: z.string().uuid() }).parse(request.params);
    return app.db.postJournal(params.journalId, actorId(request) ?? null);
  });

  app.post('/accounting/journals/:journalId/reverse', async (request) => {
    const params = z.object({ journalId: z.string().uuid() }).parse(request.params);
    return app.db.reverseJournal(params.journalId, actorId(request) ?? null);
  });

  app.post('/accounting/journals/:journalId/attachments', async (request, reply) => {
    const params = z.object({ journalId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        fileName: z.string().min(1),
        contentType: z.string().min(1),
        contentBase64: z.string().min(1),
      })
      .parse(request.body);
    const attachment = await app.db.addJournalAttachment({
      journalId: params.journalId,
      ...body,
    });
    return reply.code(201).send(attachment);
  });

  app.get('/accounting/ledger/:accountId', async (request) => {
    const params = z.object({ accountId: z.string().uuid() }).parse(request.params);
    const query = periodQuery(request.query);
    return app.db.getGeneralLedger(params.accountId, query.from, query.to);
  });

  app.get('/accounting/reports/trial-balance', async (request, reply) => {
    const query = periodQuery(request.query);
    const rows = await app.db.getTrialBalance(query.asAt);
    return sendExport(
      reply,
      query.format,
      'trial-balance',
      { asAt: query.asAt ?? null, rows },
      rows.map((row) => ({
        accountNumber: row.accountNumber,
        name: row.name,
        type: row.accountType,
        debit: row.debit,
        credit: row.credit,
      })),
      app,
    );
  });

  app.get('/accounting/reports/profit-and-loss', async (request, reply) => {
    const query = periodQuery(request.query);
    const from = query.from ?? `${new Date().getUTCFullYear()}-07-01`;
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    const report = await app.db.getProfitAndLoss(from, to);
    const flat = [
      ...report.income.rows.map((row) => ({ section: 'Income', ...row })),
      ...report.costOfSales.rows.map((row) => ({ section: 'Cost of Sales', ...row })),
      ...report.expenses.rows.map((row) => ({ section: 'Expenses', ...row })),
      { section: 'Summary', accountNumber: '', name: 'Gross Profit', amount: report.grossProfit },
      { section: 'Summary', accountNumber: '', name: 'Net Profit', amount: report.netProfit },
    ];
    return sendExport(reply, query.format, 'profit-and-loss', report, flat, app);
  });

  app.get('/accounting/reports/balance-sheet', async (request, reply) => {
    const query = periodQuery(request.query);
    const asAt = query.asAt ?? new Date().toISOString().slice(0, 10);
    const report = await app.db.getBalanceSheet(asAt);
    const flat = [
      ...report.assets.rows.map((row) => ({ section: 'Assets', ...row })),
      ...report.liabilities.rows.map((row) => ({ section: 'Liabilities', ...row })),
      ...report.equity.rows.map((row) => ({ section: 'Equity', ...row })),
      { section: 'Summary', accountNumber: '', name: 'Net Assets', amount: report.netAssets },
    ];
    return sendExport(reply, query.format, 'balance-sheet', report, flat, app);
  });

  app.get('/accounting/reports/gst-detail', async (request, reply) => {
    const query = periodQuery(request.query);
    const from = query.from ?? `${new Date().getUTCFullYear()}-07-01`;
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    const rows = await app.db.getGstDetail(from, to);
    return sendExport(
      reply,
      query.format,
      'gst-detail',
      { from, to, rows },
      rows.map((row) => ({
        date: row.journalDate,
        journal: row.journalNumber,
        account: row.accountNumber,
        gstCode: row.gstCode,
        net: row.netAmount,
        gst: row.gstAmount,
        gross: row.grossAmount,
      })),
      app,
    );
  });

  app.get('/accounting/reports/gst-summary', async (request, reply) => {
    const query = periodQuery(request.query);
    const from = query.from ?? `${new Date().getUTCFullYear()}-07-01`;
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    const report = await app.db.getGstSummary(from, to);
    return sendExport(
      reply,
      query.format,
      'gst-summary',
      report,
      [
        { label: 'GST on sales', amount: report.salesGst },
        { label: 'GST on purchases', amount: report.purchasesGst },
        { label: 'Net GST', amount: report.netGst },
        { label: 'GST-free sales', amount: report.gstFreeSales },
      ],
      app,
    );
  });

  app.get('/accounting/reports/gst-exceptions', async (request) => {
    const query = periodQuery(request.query);
    const from = query.from ?? `${new Date().getUTCFullYear()}-07-01`;
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    return { from, to, rows: await app.db.getGstExceptions(from, to) };
  });

  app.get('/accounting/reports/bas', async (request, reply) => {
    const query = periodQuery(request.query);
    const from = query.from ?? `${new Date().getUTCFullYear()}-07-01`;
    const to = query.to ?? new Date().toISOString().slice(0, 10);
    const report = await app.db.getBasReport(from, to);
    return sendExport(
      reply,
      query.format,
      'bas-report',
      report,
      [
        { label: 'G1 Total sales', amount: report.G1 },
        { label: 'G2 Export sales', amount: report.G2 },
        { label: 'G3 Other GST-free sales', amount: report.G3 },
        { label: '1A GST on sales', amount: report['1A'] },
        { label: '1B GST on purchases', amount: report['1B'] },
        { label: 'Net GST', amount: report.netGst },
      ],
      app,
    );
  });

  app.get('/accounting/reports/aged-receivables', async (request, reply) => {
    const query = periodQuery(request.query);
    const asAt = query.asAt ?? new Date().toISOString().slice(0, 10);
    const report = await app.db.getAgedReceivables(asAt);
    return sendExport(
      reply,
      query.format,
      'aged-receivables',
      report,
      report.rows.map((row) => ({
        party: row.partyName,
        document: row.documentNumber,
        dueDate: row.dueDate,
        bucket: row.bucket,
        outstanding: row.outstanding,
      })),
      app,
    );
  });

  app.get('/accounting/reports/aged-payables', async (request, reply) => {
    const query = periodQuery(request.query);
    const asAt = query.asAt ?? new Date().toISOString().slice(0, 10);
    const report = await app.db.getAgedPayables(asAt);
    return sendExport(
      reply,
      query.format,
      'aged-payables',
      report,
      report.rows.map((row) => ({
        party: row.partyName,
        document: row.documentNumber,
        dueDate: row.dueDate,
        bucket: row.bucket,
        outstanding: row.outstanding,
      })),
      app,
    );
  });

  app.get('/accounting/reports/journals', async (request, reply) => {
    const query = periodQuery(request.query);
    const journals = await app.db.listJournals({
      ...(query.from !== undefined ? { from: query.from } : {}),
      ...(query.to !== undefined ? { to: query.to } : {}),
    });
    const rows = journals.map((journal) => ({
      number: journal.journalNumber,
      date: journal.journalDate,
      status: journal.status,
      source: journal.source,
      narration: journal.narration,
    }));
    return sendExport(reply, query.format, 'journal-report', { journals }, rows, app);
  });

  app.get('/accounting/audit', async (request) => {
    const query = z
      .object({
        entityType: z.string().optional(),
        entityId: z.string().optional(),
      })
      .parse(request.query);
    return {
      events: await app.db.listAccountingAuditEvents(query.entityType, query.entityId),
    };
  });
};
