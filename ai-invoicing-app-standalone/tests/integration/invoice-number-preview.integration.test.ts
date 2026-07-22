import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';
import { extractPdfText } from '../helpers/pdf-text.js';

const invoiceSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  invoiceNumber: z.string().nullable(),
  status: z.enum(['Draft', 'Finalised']),
  customerId: z.string().uuid(),
  lineItems: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      gstApplicable: z.boolean(),
    }),
  ),
});

const apps: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (apps.length) {
    const app = apps.pop();
    if (app) await app.close();
  }
});

function tempDbPath() {
  return join(mkdtempSync(join(tmpdir(), 'invoice-number-')), 'app.db');
}

async function seedCustomer(app: Awaited<ReturnType<typeof buildApp>>) {
  const created = await app.inject({
    method: 'POST',
    url: '/api/customers',
    payload: {
      displayName: 'Number Pathway Customer',
      email: 'number-pathway@example.test',
    },
  });
  expect(created.statusCode).toBe(201);
  return created.json().id as string;
}

describe('existing invoice number → preview PDF pathway', () => {
  it('opens PDF for an existing issued invoice without inventing or clearing the number', async () => {
    const app = await buildApp({
      dbPath: tempDbPath(),
      authBypassForTesting: true,
      serveFrontend: true,
    });
    apps.push(app);

    await app.inject({
      method: 'POST',
      url: '/api/business-profile',
      payload: {
        companyName: 'Number Pathway Co',
        address: '1 Number Street',
        primaryColor: '#0F766E',
        secondaryColor: '#134E4A',
      },
    });

    const customerId = await seedCustomer(app);
    const create = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: {
        customerId,
        title: 'Existing issued invoice',
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        notes: 'Keep number',
        paymentTerms: 'Net 14',
        invoiceNumber: null,
        lineItems: [
          { description: 'Inspection', quantity: 1, unitPrice: 220, gstApplicable: true },
        ],
      },
    });
    expect(create.statusCode).toBe(201);
    const draft = invoiceSchema.parse(create.json());
    expect(draft.invoiceNumber).toBeNull();

    const inventOnCreate = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: {
        customerId,
        title: 'Should fail',
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        invoiceNumber: 'INV-FAKE-000001',
        lineItems: [
          { description: 'Inspection', quantity: 1, unitPrice: 220, gstApplicable: true },
        ],
      },
    });
    expect(inventOnCreate.statusCode).toBe(409);

    const finalise = await app.inject({
      method: 'POST',
      url: `/api/invoices/${draft.id}/finalise`,
    });
    expect(finalise.statusCode).toBe(200);
    const issued = invoiceSchema.parse(finalise.json());
    expect(issued.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);

    const loaded = invoiceSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/invoices/${issued.id}` })).json(),
    );
    expect(loaded.invoiceNumber).toBe(issued.invoiceNumber);

    const mutateNumber = await app.inject({
      method: 'PUT',
      url: `/api/invoices/${issued.id}`,
      payload: {
        title: 'Existing issued invoice',
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        notes: 'Keep number',
        paymentTerms: 'Net 14',
        paymentState: 'Awaiting Payment',
        invoiceNumber: 'INV-CHANGED-000099',
        lineItems: [
          { description: 'Inspection', quantity: 1, unitPrice: 220, gstApplicable: true },
        ],
      },
    });
    expect(mutateNumber.statusCode).toBe(409);

    const pdf = await app.inject({ method: 'GET', url: `/api/invoices/${issued.id}/pdf` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const text = await extractPdfText(pdf.rawPayload);
    expect(text).toContain(issued.invoiceNumber!);
    expect(text).toContain('Existing issued invoice');
    expect(text).toContain('Inspection');

    const afterPdf = invoiceSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/invoices/${issued.id}` })).json(),
    );
    expect(afterPdf.invoiceNumber).toBe(issued.invoiceNumber);
    expect(afterPdf.title).toBe('Existing issued invoice');

    const editorAsset = await app.inject({ method: 'GET', url: '/assets/invoice-editor.js' });
    expect(editorAsset.statusCode).toBe(200);
    expect(editorAsset.body).toContain('invoiceNumber');
    expect(editorAsset.body).toContain('assertPayloadMatchesVisibleInvoiceNumber');
    expect(editorAsset.body).toContain('data-invoice-number-display');

    const numberAsset = await app.inject({ method: 'GET', url: '/assets/invoice-number.js' });
    expect(numberAsset.statusCode).toBe(200);
    expect(numberAsset.body).toContain('formatInvoiceNumberDisplay');
  });

  it('keeps draft invoiceNumber null through save/preview and still validates missing invent attempts', async () => {
    const app = await buildApp({
      dbPath: tempDbPath(),
      authBypassForTesting: true,
      serveFrontend: false,
    });
    apps.push(app);
    const customerId = await seedCustomer(app);

    const create = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: {
        customerId,
        title: 'Draft without number',
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        invoiceNumber: null,
        lineItems: [{ description: 'Callout', quantity: 1, unitPrice: 90, gstApplicable: true }],
      },
    });
    const draft = invoiceSchema.parse(create.json());
    expect(draft.invoiceNumber).toBeNull();

    const update = await app.inject({
      method: 'PUT',
      url: `/api/invoices/${draft.id}`,
      payload: {
        title: 'Draft without number edited',
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        paymentState: 'Draft',
        invoiceNumber: null,
        lineItems: [{ description: 'Callout', quantity: 2, unitPrice: 90, gstApplicable: true }],
      },
    });
    expect(update.statusCode).toBe(200);
    const saved = invoiceSchema.parse(update.json());
    expect(saved.invoiceNumber).toBeNull();
    expect(saved.title).toBe('Draft without number edited');

    const pdf = await app.inject({ method: 'GET', url: `/api/invoices/${saved.id}/pdf` });
    expect(pdf.statusCode).toBe(200);
    const text = await extractPdfText(pdf.rawPayload);
    expect(text).toMatch(/Invoice Number:\s*Draft/i);
    expect(text).not.toMatch(/INV-\d{4}-\d{6}/);

    const afterPdf = invoiceSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/invoices/${saved.id}` })).json(),
    );
    expect(afterPdf.invoiceNumber).toBeNull();
  });

  it('edit another field on a draft, then PDF preview, without allocating a number', async () => {
    const app = await buildApp({
      dbPath: tempDbPath(),
      authBypassForTesting: true,
      serveFrontend: false,
    });
    apps.push(app);

    await app.inject({
      method: 'POST',
      url: '/api/business-profile',
      payload: {
        companyName: 'Number Pathway Co',
        address: '1 Number Street',
        primaryColor: '#0F766E',
        secondaryColor: '#134E4A',
      },
    });

    const customerId = await seedCustomer(app);
    const create = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: {
        customerId,
        title: 'Legacy style draft',
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        notes: 'original',
        invoiceNumber: null,
        lineItems: [{ description: 'Service', quantity: 1, unitPrice: 50, gstApplicable: true }],
      },
    });
    const draft = invoiceSchema.parse(create.json());

    const update = await app.inject({
      method: 'PUT',
      url: `/api/invoices/${draft.id}`,
      payload: {
        title: 'Legacy style draft',
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        paymentState: 'Draft',
        notes: 'edited without touching number',
        invoiceNumber: null,
        lineItems: [{ description: 'Service', quantity: 1, unitPrice: 50, gstApplicable: true }],
      },
    });
    expect(update.statusCode).toBe(200);
    const saved = invoiceSchema.parse(update.json());
    expect(saved.invoiceNumber).toBeNull();
    expect(update.json().notes).toBe('edited without touching number');

    const pdf = await app.inject({ method: 'GET', url: `/api/invoices/${saved.id}/pdf` });
    expect(pdf.statusCode).toBe(200);
    const text = await extractPdfText(pdf.rawPayload);
    expect(text).toContain('Legacy style draft');
    expect(text).toContain('edited without touching number');

    const missingTitle = await app.inject({
      method: 'PUT',
      url: `/api/invoices/${saved.id}`,
      payload: {
        title: '',
        issueDate: '2026-07-22',
        dueDate: '2026-08-05',
        paymentState: 'Draft',
        invoiceNumber: null,
        lineItems: [{ description: 'Service', quantity: 1, unitPrice: 50, gstApplicable: true }],
      },
    });
    expect(missingTitle.statusCode).toBe(400);
    expect(JSON.stringify(missingTitle.json())).toMatch(/Invoice title is required/i);
  });
});
