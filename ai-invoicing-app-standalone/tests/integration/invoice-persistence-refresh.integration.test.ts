import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';
import { buildInvoiceWorkspaceHtml } from '../../public/invoice-workspace.js';
import Database from 'better-sqlite3';

const dirs: string[] = [];

const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  gstApplicable: z.boolean(),
});

const invoiceSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  title: z.string(),
  notes: z.string().nullable().optional(),
  status: z.enum(['Draft', 'Finalised']),
  paymentState: z.string(),
  invoiceNumber: z.string().nullable().optional(),
  totals: z
    .object({
      subtotal: z.number(),
      gstTotal: z.number(),
      total: z.number(),
    })
    .optional(),
  lineItems: z.array(lineItemSchema),
});

const customerSchema = z.object({ id: z.string().uuid() });
const invoiceListSchema = z.object({
  invoices: z.array(z.object({ id: z.string().uuid(), title: z.string(), status: z.string() })),
});

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'invoice-persist-'));
  dirs.push(dir);
  return join(dir, 'test.sqlite');
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function seedCustomer(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
  const customer = await app.inject({
    method: 'POST',
    url: '/api/customers',
    payload: { displayName: 'Persistence Customer', email: 'persist@example.com' },
  });
  expect(customer.statusCode).toBe(201);
  return customerSchema.parse(customer.json()).id;
}

function readCommittedInvoice(dbPath: string, invoiceId: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const header = db.prepare('SELECT id, title, status, notes FROM invoices WHERE id = ?').get(invoiceId) as
      | { id: string; title: string; status: string; notes: string | null }
      | undefined;
    const lines = db
      .prepare(
        'SELECT description, quantity, unit_price, gst_applicable FROM invoice_line_items WHERE invoice_id = ? ORDER BY rowid ASC',
      )
      .all(invoiceId) as Array<{
      description: string;
      quantity: number;
      unit_price: number;
      gst_applicable: number;
    }>;
    const duplicateTitles = db
      .prepare('SELECT COUNT(*) AS count FROM invoices WHERE title = ?')
      .get(header?.title ?? '') as { count: number };
    return { header, lines, duplicateTitles };
  } finally {
    db.close();
  }
}

describe('invoice persistence across refresh / session boundaries', () => {
  it('Save Draft writes a DB transaction and refresh remounts from persisted data', async () => {
    const app = await buildApp({
      dbPath: tempDbPath(),
      authBypassForTesting: true,
      serveFrontend: true,
    });

    try {
      const customerId = await seedCustomer(app);
      const create = await app.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: {
          customerId,
          title: 'Draft after refresh',
          issueDate: '2026-07-19',
          dueDate: '2026-08-02',
          notes: 'Keep after reload',
          paymentTerms: 'Net 14',
          lineItems: [
            { description: 'Diagnostic', quantity: 1, unitPrice: 120, gstApplicable: true },
            { description: 'Travel', quantity: 1, unitPrice: 40, gstApplicable: false },
          ],
        },
      });
      expect(create.statusCode).toBe(201);
      const created = invoiceSchema.parse(create.json());
      expect(created.id).toBeTruthy();
      // Create response must include committed line items for immediate remount safety.
      expect(created.lineItems).toHaveLength(2);
      expect(created.lineItems[0]?.description).toBe('Diagnostic');

      // Simulate hard refresh / browser restart: new GET from DB.
      const refreshed = await app.inject({ method: 'GET', url: `/api/invoices/${created.id}` });
      expect(refreshed.statusCode).toBe(200);
      const invoice = invoiceSchema.parse(refreshed.json());
      expect(invoice.title).toBe('Draft after refresh');
      expect(invoice.notes).toBe('Keep after reload');
      expect(invoice.lineItems).toHaveLength(2);
      expect(invoice.lineItems.map((item) => item.description)).toEqual(['Diagnostic', 'Travel']);

      const html = buildInvoiceWorkspaceHtml({
        profile: {},
        customers: [{ id: customerId, displayName: 'Persistence Customer' }],
        record: invoice,
      });
      expect(html).toContain('data-record-id="' + created.id + '"');
      expect(html).toContain('Draft after refresh');
      expect(html).toContain('Diagnostic');
      expect(html).toContain('Travel');
      expect(html).toContain('Keep after reload');

      const shell = await app.inject({
        method: 'GET',
        url: `/workspace/invoices/${created.id}/edit`,
      });
      expect(shell.statusCode).toBe(200);
      const asset = await app.inject({
        method: 'GET',
        url: '/assets/invoice-draft-persistence.js',
      });
      expect(asset.statusCode).toBe(200);
      expect(asset.body).toContain('INVOICE_DRAFT_STORAGE_KEY');
    } finally {
      await app.close();
    }
  });

  it('Save then Issue (final) persists through logout/login-style re-fetch', async () => {
    const app = await buildApp({
      dbPath: tempDbPath(),
      authBypassForTesting: true,
      serveFrontend: false,
    });

    try {
      const customerId = await seedCustomer(app);
      const create = await app.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: {
          customerId,
          title: 'Final persistence',
          issueDate: '2026-07-19',
          dueDate: '2026-08-05',
          lineItems: [{ description: 'Labour', quantity: 2, unitPrice: 95, gstApplicable: true }],
        },
      });
      const id = invoiceSchema.parse(create.json()).id;

      const update = await app.inject({
        method: 'PUT',
        url: `/api/invoices/${id}`,
        payload: {
          title: 'Final persistence updated',
          issueDate: '2026-07-19',
          dueDate: '2026-08-05',
          notes: 'Ready to issue',
          paymentState: 'Draft',
          lineItems: [
            { description: 'Labour', quantity: 2, unitPrice: 95, gstApplicable: true },
            { description: 'Parts', quantity: 1, unitPrice: 55, gstApplicable: false },
          ],
        },
      });
      expect(update.statusCode).toBe(200);
      expect(invoiceSchema.parse(update.json()).lineItems).toHaveLength(2);

      const finalised = await app.inject({ method: 'POST', url: `/api/invoices/${id}/finalise` });
      expect(finalised.statusCode).toBe(200);
      const issued = invoiceSchema.parse(finalised.json());
      expect(issued.status).toBe('Finalised');
      expect(issued.invoiceNumber).toMatch(/^INV-/);

      // Simulate logout/login or new browser session: only the server DB remains.
      const afterLogin = await app.inject({ method: 'GET', url: `/api/invoices/${id}` });
      expect(afterLogin.statusCode).toBe(200);
      const invoice = invoiceSchema.parse(afterLogin.json());
      expect(invoice.title).toBe('Final persistence updated');
      expect(invoice.status).toBe('Finalised');
      expect(invoice.notes).toBe('Ready to issue');
      expect(invoice.lineItems).toHaveLength(2);
      expect(invoice.lineItems[1]?.description).toBe('Parts');

      const list = await app.inject({ method: 'GET', url: '/api/invoices?limit=50' });
      const listed = invoiceListSchema.parse(list.json());
      expect(listed.invoices.some((row) => row.id === id)).toBe(true);
      expect(listed.invoices.filter((row) => row.title === 'Final persistence updated')).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('browser restart / logout-login still loads a saved draft from the database, not empty local state', async () => {
    const dbPath = tempDbPath();
    const app = await buildApp({
      dbPath,
      authBypassForTesting: true,
      serveFrontend: false,
    });

    let invoiceId = '';
    let customerId = '';
    try {
      customerId = await seedCustomer(app);
      const create = await app.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: {
          customerId,
          title: 'Survives restart',
          issueDate: '2026-07-19',
          dueDate: '2026-08-10',
          notes: 'local storage cleared',
          lineItems: [
            { description: 'Restart-safe line', quantity: 3, unitPrice: 33, gstApplicable: true },
          ],
        },
      });
      expect(create.statusCode).toBe(201);
      invoiceId = invoiceSchema.parse(create.json()).id;
    } finally {
      await app.close();
    }

    // New process / login: reopen the same DB file with no client local state.
    const appAfterRestart = await buildApp({
      dbPath,
      authBypassForTesting: true,
      serveFrontend: false,
    });
    try {
      const coldGet = await appAfterRestart.inject({
        method: 'GET',
        url: `/api/invoices/${invoiceId}`,
      });
      expect(coldGet.statusCode).toBe(200);
      const invoice = invoiceSchema.parse(coldGet.json());
      expect(invoice.title).toBe('Survives restart');
      expect(invoice.notes).toBe('local storage cleared');
      expect(invoice.lineItems).toHaveLength(1);
      expect(invoice.lineItems[0]?.description).toBe('Restart-safe line');

      const html = buildInvoiceWorkspaceHtml({
        profile: {},
        customers: [{ id: customerId, displayName: 'Persistence Customer' }],
        record: invoice,
      });
      expect(html).toContain('value="Survives restart"');
      expect(html).toContain('Restart-safe line');
    } finally {
      await appAfterRestart.close();
    }
  });

  it('create → update → get round-trip commits inside the database transaction', async () => {
    const app = await buildApp({
      dbPath: tempDbPath(),
      authBypassForTesting: true,
      serveFrontend: false,
    });

    try {
      const customerId = await seedCustomer(app);
      const create = await app.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: {
          customerId,
          title: 'Txn commit check',
          issueDate: '2026-07-19',
          dueDate: '2026-08-01',
          lineItems: [{ description: 'A', quantity: 1, unitPrice: 10, gstApplicable: false }],
        },
      });
      const id = invoiceSchema.parse(create.json()).id;

      // A second independent GET proves the previous transaction committed.
      const firstRead = await app.inject({ method: 'GET', url: `/api/invoices/${id}` });
      expect(invoiceSchema.parse(firstRead.json()).lineItems).toHaveLength(1);

      await app.inject({
        method: 'PUT',
        url: `/api/invoices/${id}`,
        payload: {
          title: 'Txn commit check',
          issueDate: '2026-07-19',
          dueDate: '2026-08-01',
          paymentState: 'Draft',
          lineItems: [
            { description: 'A', quantity: 1, unitPrice: 10, gstApplicable: false },
            { description: 'B', quantity: 2, unitPrice: 20, gstApplicable: true },
          ],
        },
      });

      const secondRead = await app.inject({ method: 'GET', url: `/api/invoices/${id}` });
      expect(
        invoiceSchema.parse(secondRead.json()).lineItems.map((item) => item.description),
      ).toEqual(['A', 'B']);
    } finally {
      await app.close();
    }
  });

  it('production verification: 3+ lines, edit/refresh, no duplicates, finalise same id, SQL proof', async () => {
    const dbPath = tempDbPath();
    const app = await buildApp({
      dbPath,
      authBypassForTesting: true,
      serveFrontend: true,
    });

    try {
      const customerId = await seedCustomer(app);

      // 1) Create draft with customer, title, and three valid line items (autosave/create).
      const create = await app.inject({
        method: 'POST',
        url: '/api/invoices',
        payload: {
          customerId,
          title: 'P0 production verify draft',
          issueDate: '2026-07-20',
          dueDate: '2026-08-03',
          notes: 'autosave verification',
          lineItems: [
            { description: 'Labour', quantity: 2, unitPrice: 100, gstApplicable: true },
            { description: 'Parts', quantity: 1, unitPrice: 50, gstApplicable: false },
            { description: 'Travel', quantity: 3, unitPrice: 20, gstApplicable: true },
          ],
        },
      });
      expect(create.statusCode).toBe(201);
      const created = invoiceSchema.parse(create.json());
      expect(created.lineItems).toHaveLength(3);

      // 2) Only one invoice record; URL binding target exists for /edit/:id.
      const listAfterCreate = invoiceListSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/invoices?limit=100' })).json(),
      );
      expect(
        listAfterCreate.invoices.filter((row) => row.title === 'P0 production verify draft'),
      ).toHaveLength(1);
      const editShell = await app.inject({
        method: 'GET',
        url: `/workspace/invoices/${created.id}/edit`,
      });
      expect(editShell.statusCode).toBe(200);

      // Raw DB proof: header + three lines committed together.
      const committed = readCommittedInvoice(dbPath, created.id);
      expect(committed.header).toMatchObject({
        id: created.id,
        title: 'P0 production verify draft',
        status: 'Draft',
      });
      expect(committed.lines).toHaveLength(3);
      expect(committed.lines.map((line) => line.description)).toEqual([
        'Labour',
        'Parts',
        'Travel',
      ]);
      expect(committed.duplicateTitles.count).toBe(1);

      // 3) Hard refresh reload from API (not empty local state).
      const refresh1 = invoiceSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/invoices/${created.id}` })).json(),
      );
      expect(refresh1.customerId).toBe(customerId);
      expect(refresh1.title).toBe('P0 production verify draft');
      expect(refresh1.lineItems).toHaveLength(3);
      expect(refresh1.totals?.total).toBeGreaterThan(0);

      // 4) Edit: change a line, add a line, remove a line; refresh again.
      const update = await app.inject({
        method: 'PUT',
        url: `/api/invoices/${created.id}`,
        payload: {
          title: 'P0 production verify draft',
          issueDate: '2026-07-20',
          dueDate: '2026-08-03',
          notes: 'edited after autosave',
          paymentState: 'Draft',
          lineItems: [
            { description: 'Labour updated', quantity: 4, unitPrice: 110, gstApplicable: true },
            { description: 'Travel', quantity: 3, unitPrice: 20, gstApplicable: true },
            { description: 'Callout', quantity: 1, unitPrice: 75, gstApplicable: false },
          ],
        },
      });
      expect(update.statusCode).toBe(200);
      const updated = invoiceSchema.parse(update.json());
      expect(updated.lineItems.map((item) => item.description)).toEqual([
        'Labour updated',
        'Travel',
        'Callout',
      ]);

      const refresh2 = invoiceSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/invoices/${created.id}` })).json(),
      );
      expect(refresh2.notes).toBe('edited after autosave');
      expect(refresh2.lineItems).toHaveLength(3);
      expect(refresh2.lineItems[0]).toMatchObject({
        description: 'Labour updated',
        quantity: 4,
        unitPrice: 110,
      });

      const afterEditDb = readCommittedInvoice(dbPath, created.id);
      expect(afterEditDb.lines).toHaveLength(3);
      expect(afterEditDb.duplicateTitles.count).toBe(1);

      // 8/9) Finalise same id — no duplicate invoice; lines intact after reopen.
      const finalise = await app.inject({
        method: 'POST',
        url: `/api/invoices/${created.id}/finalise`,
      });
      expect(finalise.statusCode).toBe(200);
      const issued = invoiceSchema.parse(finalise.json());
      expect(issued.id).toBe(created.id);
      expect(issued.status).toBe('Finalised');
      expect(issued.invoiceNumber).toMatch(/^INV-/);
      expect(issued.lineItems).toHaveLength(3);

      const afterIssue = invoiceSchema.parse(
        (await app.inject({ method: 'GET', url: `/api/invoices/${created.id}` })).json(),
      );
      expect(afterIssue.status).toBe('Finalised');
      expect(afterIssue.lineItems.map((item) => item.description)).toEqual([
        'Labour updated',
        'Travel',
        'Callout',
      ]);

      const listFinal = invoiceListSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/invoices?limit=100' })).json(),
      );
      expect(listFinal.invoices.filter((row) => row.id === created.id)).toHaveLength(1);
      expect(
        listFinal.invoices.filter((row) => row.title === 'P0 production verify draft'),
      ).toHaveLength(1);

      const pdf = await app.inject({ method: 'GET', url: `/api/invoices/${created.id}/pdf` });
      // PDF may require business profile; accept 200 or explicit 400 readiness error.
      expect([200, 400]).toContain(pdf.statusCode);

      const finalDb = readCommittedInvoice(dbPath, created.id);
      expect(finalDb.header?.status).toBe('Finalised');
      expect(finalDb.lines).toHaveLength(3);
      expect(finalDb.duplicateTitles.count).toBe(1);
    } finally {
      await app.close();
    }
  });
});
