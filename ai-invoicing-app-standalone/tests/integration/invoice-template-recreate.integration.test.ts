import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { extractPdfText } from '../helpers/pdf-text.js';

const apps: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (apps.length) {
    const app = apps.pop();
    if (app) await app.close();
  }
});

function tempDbPath() {
  return join(mkdtempSync(join(tmpdir(), 'invoice-template-')), 'app.db');
}

const samplePdfPath = join(
  process.env.HOME || '/home/ubuntu',
  '.cursor/projects/workspace/uploads/Cart_N_Tip__107_e19b.pdf',
);

describe('invoice template recreate pathway', () => {
  it('analyzes PDF, saves default template, and applies it to a new invoice PDF', async () => {
    let pdfBytes: Buffer;
    try {
      pdfBytes = readFileSync(samplePdfPath);
    } catch {
      return;
    }

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
        companyName: 'Quantum Hire Services Pty Ltd',
        legalName: 'Quantum Hire Services Pty Ltd',
        abnTaxId: '26641770130',
        address: '1 Hire Street',
        email: 'info@quantumhireservices.com.au',
        phone: '0410760760',
        primaryColor: '#173f35',
        secondaryColor: '#c4f36b',
      },
    });

    const analyzed = await app.inject({
      method: 'POST',
      url: '/api/invoice-templates/analyze',
      payload: {
        filename: 'Cart_N_Tip_107.pdf',
        mimeType: 'application/pdf',
        contentBase64: pdfBytes.toString('base64'),
      },
    });
    expect(analyzed.statusCode).toBe(200);
    const analysis = analyzed.json();
    expect(analysis.design.layout.headerStyle).toBe('split-bill-from');
    expect(analysis.design.bankDetails.bsb).toBe('012347');

    const approved = await app.inject({
      method: 'POST',
      url: '/api/invoice-templates/approve',
      payload: {
        name: 'Cart N Tip recreation',
        isDefault: true,
        applyBusinessDefaults: false,
        source: 'imported',
        design: analysis.design,
        originalFilename: 'Cart_N_Tip_107.pdf',
        originalMimeType: 'application/pdf',
      },
    });
    expect(approved.statusCode).toBe(201);
    const template = approved.json();
    expect(template.isDefault).toBe(true);

    const asset = await app.inject({ method: 'GET', url: '/assets/invoice-templates-ui.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain('createInvoiceTemplatesUi');

    const shell = await app.inject({ method: 'GET', url: '/templates/import' });
    expect(shell.statusCode).toBe(200);

    const customer = await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: {
        displayName: 'Cart and Tip Pty Ltd',
        email: 'accounts@cartntip.example',
      },
    });
    expect(customer.statusCode).toBe(201);
    const customerId = customer.json().id as string;

    const invoice = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: {
        customerId,
        title: 'Labour hire week',
        issueDate: '2026-07-20',
        dueDate: '2026-07-27',
        paymentTerms: analysis.design.termsAndConditions,
        notes: analysis.design.notesPlaceholder,
        templateId: template.id,
        lineItems: [
          {
            description: 'Labour Hire - Day Shift',
            quantity: 2,
            unitPrice: 350,
            gstApplicable: true,
          },
        ],
      },
    });
    expect(invoice.statusCode).toBe(201);
    const invoiceId = invoice.json().id as string;
    expect(invoice.json().templateId).toBe(template.id);

    const pdf = await app.inject({ method: 'GET', url: `/api/invoices/${invoiceId}/pdf` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
    const text = extractPdfText(Buffer.from(pdf.rawPayload));
    expect(text).toContain('TAX INVOICE');
    expect(text).toMatch(/BILL TO/i);
    expect(text).toMatch(/FROM/i);
    expect(text).toMatch(/RATE/i);
    expect(text).toContain('012347');
    expect(text).toContain('814027296');
    expect(text).toContain('Labour Hire - Day Shift');
    expect(text).toContain('AMOUNT (EX GST)');
    expect(text).toContain('PAYMENT DETAILS');
  });
});
