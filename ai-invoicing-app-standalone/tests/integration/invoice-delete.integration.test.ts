import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const invoiceSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.enum(['Draft', 'Finalised']),
  invoiceNumber: z.string().nullable(),
});

const apps: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (apps.length) {
    const app = apps.pop();
    if (app) await app.close();
  }
});

function tempDbPath() {
  return join(mkdtempSync(join(tmpdir(), 'invoice-delete-')), 'app.db');
}

async function seedDraft(app: Awaited<ReturnType<typeof buildApp>>, title = 'Disposable draft') {
  const customer = await app.inject({
    method: 'POST',
    url: '/api/customers',
    payload: {
      displayName: 'Delete Pathway Customer',
      email: 'delete-pathway@example.test',
    },
  });
  expect(customer.statusCode).toBe(201);
  const customerId = customer.json().id as string;
  const created = await app.inject({
    method: 'POST',
    url: '/api/invoices',
    payload: {
      customerId,
      title,
      issueDate: '2026-07-22',
      dueDate: '2026-08-05',
      invoiceNumber: null,
      lineItems: [{ description: 'Callout', quantity: 1, unitPrice: 90, gstApplicable: true }],
    },
  });
  expect(created.statusCode).toBe(201);
  return invoiceSchema.parse(created.json());
}

describe('invoice draft deletion pathway', () => {
  it('deletes a draft permanently, removes line items, and blocks reopen/preview/update', async () => {
    const app = await buildApp({
      dbPath: tempDbPath(),
      authBypassForTesting: true,
      serveFrontend: true,
    });
    apps.push(app);

    const draft = await seedDraft(app);
    expect(draft.status).toBe('Draft');
    expect(draft.invoiceNumber).toBeNull();

    const deleted = await app.inject({ method: 'DELETE', url: `/api/invoices/${draft.id}` });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe('');

    const again = await app.inject({ method: 'DELETE', url: `/api/invoices/${draft.id}` });
    expect(again.statusCode).toBe(404);

    const loaded = await app.inject({ method: 'GET', url: `/api/invoices/${draft.id}` });
    expect(loaded.statusCode).toBe(404);

    const pdf = await app.inject({ method: 'GET', url: `/api/invoices/${draft.id}/pdf` });
    expect(pdf.statusCode).toBe(404);

    const update = await app.inject({
      method: 'PUT',
      url: `/api/invoices/${draft.id}`,
      payload: {
        title: 'Should not revive',
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        paymentState: 'Draft',
        invoiceNumber: null,
        lineItems: [{ description: 'Callout', quantity: 1, unitPrice: 90, gstApplicable: true }],
      },
    });
    expect(update.statusCode).toBe(404);

    const listed = await app.inject({ method: 'GET', url: '/api/invoices' });
    expect(listed.statusCode).toBe(200);
    const invoices = listed.json().invoices as Array<{ id: string }>;
    expect(invoices.some((item) => item.id === draft.id)).toBe(false);

    const editor = await app.inject({ method: 'GET', url: '/assets/invoice-editor.js' });
    expect(editor.statusCode).toBe(200);
    expect(editor.body).toContain('data-invoice-action="delete"');
    expect(editor.body).not.toMatch(/new FormData\s*\(/);
  });

  it('blocks deletion of finalised invoices and unauthenticated requests', async () => {
    const app = await buildApp({
      dbPath: tempDbPath(),
      authBypassForTesting: true,
      serveFrontend: false,
    });
    apps.push(app);

    const draft = await seedDraft(app, 'Issue then protect');
    const finalise = await app.inject({
      method: 'POST',
      url: `/api/invoices/${draft.id}/finalise`,
    });
    expect(finalise.statusCode).toBe(200);
    const issued = invoiceSchema.parse(finalise.json());
    expect(issued.status).toBe('Finalised');
    expect(issued.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);

    const blocked = await app.inject({ method: 'DELETE', url: `/api/invoices/${issued.id}` });
    expect(blocked.statusCode).toBe(409);
    expect(JSON.stringify(blocked.json())).toMatch(/Only draft invoices can be deleted/i);

    const stillThere = await app.inject({ method: 'GET', url: `/api/invoices/${issued.id}` });
    expect(stillThere.statusCode).toBe(200);

    const locked = await buildApp({
      dbPath: tempDbPath(),
      authBypassForTesting: false,
      serveFrontend: false,
    });
    apps.push(locked);
    const unauth = await locked.inject({
      method: 'DELETE',
      url: `/api/invoices/${randomUUID()}`,
    });
    expect(unauth.statusCode).toBe(401);

    const missing = await app.inject({
      method: 'DELETE',
      url: `/api/invoices/${randomUUID()}`,
    });
    expect(missing.statusCode).toBe(404);
  });
});
