import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const idSchema = z.object({ id: z.string().uuid() });

const reportSchema = z.object({
  generatedAt: z.string(),
  filters: z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
    limit: z.number(),
    offset: z.number(),
  }),
  accountsReceivable: z.object({
    totals: z.object({
      totalInvoiced: z.number(),
      totalCredited: z.number(),
      totalPaid: z.number(),
      outstanding: z.number(),
    }),
    invoices: z.array(
      z.object({
        invoiceId: z.string().uuid(),
        invoiceNumber: z.string(),
        customerId: z.string().uuid(),
        issueDate: z.string(),
        totalInvoiced: z.number(),
        totalCredited: z.number(),
        totalPaid: z.number(),
        outstanding: z.number(),
      }),
    ),
    customerStatements: z.array(
      z.object({
        customerId: z.string().uuid(),
        customerName: z.string(),
        openingBalance: z.number(),
        activity: z.number(),
        closingBalance: z.number(),
      }),
    ),
  }),
  accountsPayable: z.object({
    totals: z.object({
      totalOrdered: z.number(),
      totalBilled: z.number(),
      totalPaid: z.number(),
      remainingOrderedValue: z.number(),
      supplierBillOutstanding: z.number(),
    }),
    purchaseOrders: z.array(
      z.object({
        purchaseOrderId: z.string().uuid(),
        purchaseOrderNumber: z.string(),
        supplierId: z.string().uuid(),
        issueDate: z.string(),
        totalOrdered: z.number(),
        totalBilled: z.number(),
        remainingValue: z.number(),
      }),
    ),
    supplierBills: z.array(
      z.object({
        supplierBillId: z.string().uuid(),
        supplierId: z.string().uuid(),
        billNumber: z.string().nullable(),
        billDate: z.string(),
        status: z.enum(['Draft', 'Finalised']),
        totalBilled: z.number(),
        totalPaid: z.number(),
        outstanding: z.number(),
      }),
    ),
  }),
});

describe('reporting read-model integrity', () => {
  it('reconciles AR/AP derived totals deterministically without mutating documents', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-business-os-reporting-'));
    createdDirs.push(tempDir);
    const dbPath = join(tempDir, 'reporting.sqlite');
    const app = await buildApp({ dbPath });
    const raw = new Database(dbPath);

    const customerA = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/customers',
          payload: { displayName: 'Reporting Customer A' },
        })
      ).json(),
    );
    const customerB = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/customers',
          payload: { displayName: 'Reporting Customer B' },
        })
      ).json(),
    );
    const supplier = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/suppliers',
          payload: { displayName: 'Reporting Supplier' },
        })
      ).json(),
    );

    const openingInvoice = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/invoices',
          payload: {
            customerId: customerA.id,
            title: 'Opening AR Invoice',
            issueDate: '2026-01-10',
            dueDate: '2026-01-25',
            lineItems: [{ description: 'Opening', quantity: 1, unitPrice: 100, gstApplicable: true }],
          },
        })
      ).json(),
    );
    expect((await app.inject({ method: 'POST', url: `/invoices/${openingInvoice.id}/finalise` })).statusCode).toBe(200);

    const periodInvoiceA = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/invoices',
          payload: {
            customerId: customerA.id,
            title: 'Period AR Invoice A',
            issueDate: '2026-02-10',
            dueDate: '2026-02-25',
            lineItems: [{ description: 'A', quantity: 2, unitPrice: 100, gstApplicable: true }],
          },
        })
      ).json(),
    );
    const periodInvoiceAFinal = z.object({ invoiceNumber: z.string() }).parse(
      (
        await app.inject({
          method: 'POST',
          url: `/invoices/${periodInvoiceA.id}/finalise`,
        })
      ).json(),
    );

    const periodInvoiceB = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/invoices',
          payload: {
            customerId: customerB.id,
            title: 'Period AR Invoice B',
            issueDate: '2026-02-12',
            dueDate: '2026-02-27',
            lineItems: [{ description: 'B', quantity: 1, unitPrice: 50, gstApplicable: true }],
          },
        })
      ).json(),
    );
    expect((await app.inject({ method: 'POST', url: `/invoices/${periodInvoiceB.id}/finalise` })).statusCode).toBe(200);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/credit-notes',
          payload: {
            linkedInvoiceId: periodInvoiceA.id,
            issueDate: '2026-02-15',
            reason: 'Reporting credit',
            type: 'Partial',
            lineItems: [{ description: 'Credit', amount: 55 }],
          },
        })
      ).statusCode,
    ).toBe(201);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/payments',
          payload: {
            customerId: customerA.id,
            paymentDate: '2026-02-16',
            paymentMethod: 'Bank Transfer',
            reference: 'REPORT-PAY-1',
            amount: 100,
            allocations: [{ invoiceId: periodInvoiceA.id, amount: 100 }],
          },
        })
      ).statusCode,
    ).toBe(201);

    const poA = z.object({ id: z.string().uuid(), purchaseOrderNumber: z.string() }).parse(
      (
        await app.inject({
          method: 'POST',
          url: '/purchase-orders',
          payload: {
            supplierId: supplier.id,
            issueDate: '2026-02-10',
            currency: 'AUD',
            supplierReference: 'PO-A',
            lineItems: [{ description: 'PO A', quantity: 2, unitPrice: 100, gstApplicable: true }],
          },
        })
      ).json(),
    );
    expect((await app.inject({ method: 'POST', url: `/purchase-orders/${poA.id}/approve` })).statusCode).toBe(200);
    const billA = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/purchase-orders/${poA.id}/create-supplier-bill`,
          payload: {},
        })
      ).json(),
    );
    const billAFinal = z.object({ billNumber: z.string() }).parse(
      (await app.inject({ method: 'POST', url: `/supplier-bills/${billA.id}/finalise` })).json(),
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/supplier-payments',
          payload: {
            supplierId: supplier.id,
            paymentDate: '2026-02-20',
            paymentMethod: 'Bank Transfer',
            reference: 'REPORT-SPAY-1',
            amount: 50,
            allocations: [{ supplierBillId: billA.id, amount: 50 }],
          },
        })
      ).statusCode,
    ).toBe(201);

    const poB = z.object({ id: z.string().uuid() }).parse(
      (
        await app.inject({
          method: 'POST',
          url: '/purchase-orders',
          payload: {
            supplierId: supplier.id,
            issueDate: '2026-02-12',
            currency: 'AUD',
            supplierReference: 'PO-B',
            lineItems: [{ description: 'PO B', quantity: 1, unitPrice: 50, gstApplicable: true }],
          },
        })
      ).json(),
    );
    expect((await app.inject({ method: 'POST', url: `/purchase-orders/${poB.id}/approve` })).statusCode).toBe(200);
    const billB = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/purchase-orders/${poB.id}/create-supplier-bill`,
          payload: {},
        })
      ).json(),
    );
    expect((await app.inject({ method: 'POST', url: `/supplier-bills/${billB.id}/finalise` })).statusCode).toBe(200);

    const timelineBefore = z
      .object({ events: z.array(z.unknown()) })
      .parse((await app.inject({ method: 'GET', url: `/timeline/invoice/${periodInvoiceA.id}` })).json());

    const reportRes = await app.inject({
      method: 'GET',
      url: '/reports/read-model?from=2026-02-01&to=2026-02-28&limit=50&offset=0',
    });
    expect(reportRes.statusCode).toBe(200);
    const report = reportSchema.parse(reportRes.json());

    expect(report.accountsReceivable.totals.totalInvoiced).toBe(275);
    expect(report.accountsReceivable.totals.totalCredited).toBe(55);
    expect(report.accountsReceivable.totals.totalPaid).toBe(100);
    expect(report.accountsReceivable.totals.outstanding).toBe(120);

    const invoiceARow = report.accountsReceivable.invoices.find((row) => row.invoiceId === periodInvoiceA.id);
    expect(invoiceARow?.invoiceNumber).toBe(periodInvoiceAFinal.invoiceNumber);
    expect(invoiceARow?.totalInvoiced).toBe(220);
    expect(invoiceARow?.totalCredited).toBe(55);
    expect(invoiceARow?.totalPaid).toBe(100);
    expect(invoiceARow?.outstanding).toBe(65);

    const statementA = report.accountsReceivable.customerStatements.find((row) => row.customerId === customerA.id);
    expect(statementA).toMatchObject({
      openingBalance: 110,
      activity: 65,
      closingBalance: 175,
    });

    expect(report.accountsPayable.totals.totalOrdered).toBe(275);
    expect(report.accountsPayable.totals.totalBilled).toBe(275);
    expect(report.accountsPayable.totals.totalPaid).toBe(50);
    expect(report.accountsPayable.totals.remainingOrderedValue).toBe(0);
    expect(report.accountsPayable.totals.supplierBillOutstanding).toBe(225);

    const poARow = report.accountsPayable.purchaseOrders.find((row) => row.purchaseOrderId === poA.id);
    expect(poARow).toMatchObject({
      totalOrdered: 220,
      totalBilled: 220,
      remainingValue: 0,
    });
    const billARow = report.accountsPayable.supplierBills.find((row) => row.supplierBillId === billA.id);
    expect(billARow).toMatchObject({
      billNumber: billAFinal.billNumber,
      totalBilled: 220,
      totalPaid: 50,
      outstanding: 170,
    });

    const reportRepeat = reportSchema.parse(
      (await app.inject({ method: 'GET', url: '/reports/read-model?from=2026-02-01&to=2026-02-28&limit=50&offset=0' })).json(),
    );
    expect(reportRepeat).toEqual(report);

    const page0 = reportSchema.parse(
      (await app.inject({ method: 'GET', url: '/reports/read-model?from=2026-02-01&to=2026-02-28&limit=1&offset=0' })).json(),
    );
    const page1 = reportSchema.parse(
      (await app.inject({ method: 'GET', url: '/reports/read-model?from=2026-02-01&to=2026-02-28&limit=1&offset=1' })).json(),
    );
    expect([...page0.accountsReceivable.invoices, ...page1.accountsReceivable.invoices].map((row) => row.invoiceId)).toEqual(
      report.accountsReceivable.invoices.slice(0, 2).map((row) => row.invoiceId),
    );

    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/invoices/${periodInvoiceA.id}`,
          payload: {
            title: 'Rejected mutation',
            issueDate: '2026-02-10',
            dueDate: '2026-02-25',
            paymentState: 'Sent',
            lineItems: [{ description: 'x', quantity: 1, unitPrice: 1, gstApplicable: false }],
          },
        })
      ).statusCode,
    ).toBe(409);
    const reportAfterReject = reportSchema.parse(
      (await app.inject({ method: 'GET', url: '/reports/read-model?from=2026-02-01&to=2026-02-28&limit=50&offset=0' })).json(),
    );
    expect(reportAfterReject.accountsReceivable.invoices.some((row) => row.invoiceNumber === periodInvoiceAFinal.invoiceNumber)).toBe(
      true,
    );

    const timelineAfter = z
      .object({ events: z.array(z.unknown()) })
      .parse((await app.inject({ method: 'GET', url: `/timeline/invoice/${periodInvoiceA.id}` })).json());
    expect(timelineAfter.events).toHaveLength(timelineBefore.events.length);

    const reportingTables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND lower(name) LIKE '%report%'")
      .all() as Array<{ name: string }>;
    expect(reportingTables).toHaveLength(0);

    raw.close();
    await app.close();
  });

  it('keeps report totals and ordering deterministic under concurrent creation', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const customer = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/customers',
          payload: { displayName: 'Concurrent Report Customer' },
        })
      ).json(),
    );

    const draftResponses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/invoices',
          payload: {
            customerId: customer.id,
            title: `Concurrent Report Invoice ${index + 1}`,
            issueDate: '2026-03-10',
            dueDate: '2026-03-25',
            lineItems: [{ description: 'Concurrent', quantity: 1, unitPrice: 100, gstApplicable: true }],
          },
        }),
      ),
    );
    const invoiceIds = draftResponses.map((response) => idSchema.parse(response.json()).id);
    const finaliseResponses = await Promise.all(
      invoiceIds.map((invoiceId) => app.inject({ method: 'POST', url: `/invoices/${invoiceId}/finalise` })),
    );
    for (const response of finaliseResponses) {
      expect(response.statusCode).toBe(200);
    }

    const reportA = reportSchema.parse(
      (await app.inject({ method: 'GET', url: '/reports/read-model?from=2026-03-01&to=2026-03-31&limit=100&offset=0' })).json(),
    );
    const reportB = reportSchema.parse(
      (await app.inject({ method: 'GET', url: '/reports/read-model?from=2026-03-01&to=2026-03-31&limit=100&offset=0' })).json(),
    );

    expect(reportA).toEqual(reportB);
    expect(reportA.accountsReceivable.totals.totalInvoiced).toBe(880);
    expect(reportA.accountsReceivable.totals.totalCredited).toBe(0);
    expect(reportA.accountsReceivable.totals.totalPaid).toBe(0);
    expect(reportA.accountsReceivable.totals.outstanding).toBe(880);
    expect(reportA.accountsReceivable.invoices).toHaveLength(8);
    expect(new Set(reportA.accountsReceivable.invoices.map((row) => row.invoiceId)).size).toBe(8);

    await app.close();
  });
});
