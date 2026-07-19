import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { buildInvoiceWorkspaceHtml } from '../../public/invoice-workspace.js';

const dirs: string[] = [];

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

async function seedCustomer(app: Awaited<ReturnType<typeof buildApp>>) {
  const customer = await app.inject({
    method: 'POST',
    url: '/api/customers',
    payload: { displayName: 'Persistence Customer', email: 'persist@example.com' },
  });
  expect(customer.statusCode).toBe(201);
  return customer.json().id as string;
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
      const created = create.json();
      expect(created.id).toBeTruthy();
      // Create response must include committed line items for immediate remount safety.
      expect(created.lineItems).toHaveLength(2);
      expect(created.lineItems[0].description).toBe('Diagnostic');

      // Simulate hard refresh / browser restart: new GET from DB.
      const refreshed = await app.inject({ method: 'GET', url: `/api/invoices/${created.id}` });
      expect(refreshed.statusCode).toBe(200);
      const invoice = refreshed.json();
      expect(invoice.title).toBe('Draft after refresh');
      expect(invoice.notes).toBe('Keep after reload');
      expect(invoice.lineItems).toHaveLength(2);
      expect(invoice.lineItems.map((item: { description: string }) => item.description)).toEqual([
        'Diagnostic',
        'Travel',
      ]);

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
      const id = create.json().id as string;

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
      expect(update.json().lineItems).toHaveLength(2);

      const finalised = await app.inject({ method: 'POST', url: `/api/invoices/${id}/finalise` });
      expect(finalised.statusCode).toBe(200);
      expect(finalised.json().status).toBe('Finalised');
      expect(finalised.json().invoiceNumber).toMatch(/^INV-/);

      // Simulate logout/login or new browser session: only the server DB remains.
      const afterLogin = await app.inject({ method: 'GET', url: `/api/invoices/${id}` });
      expect(afterLogin.statusCode).toBe(200);
      const invoice = afterLogin.json();
      expect(invoice.title).toBe('Final persistence updated');
      expect(invoice.status).toBe('Finalised');
      expect(invoice.notes).toBe('Ready to issue');
      expect(invoice.lineItems).toHaveLength(2);
      expect(invoice.lineItems[1].description).toBe('Parts');

      const list = await app.inject({ method: 'GET', url: '/api/invoices?limit=50' });
      expect(list.json().invoices.some((row: { id: string }) => row.id === id)).toBe(true);
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
      invoiceId = create.json().id as string;
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
      const invoice = coldGet.json();
      expect(invoice.title).toBe('Survives restart');
      expect(invoice.notes).toBe('local storage cleared');
      expect(invoice.lineItems).toHaveLength(1);
      expect(invoice.lineItems[0].description).toBe('Restart-safe line');

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
      const id = create.json().id as string;

      // A second independent GET proves the previous transaction committed.
      const firstRead = await app.inject({ method: 'GET', url: `/api/invoices/${id}` });
      expect(firstRead.json().lineItems).toHaveLength(1);

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
      expect(secondRead.json().lineItems.map((item: { description: string }) => item.description)).toEqual([
        'A',
        'B',
      ]);
    } finally {
      await app.close();
    }
  });
});
