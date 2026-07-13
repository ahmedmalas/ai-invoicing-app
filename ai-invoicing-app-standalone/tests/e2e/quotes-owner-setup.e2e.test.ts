import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { createDatabase } from '../../src/db/database.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('quote and owner setup production workflow', () => {
  it('creates a quote, renders its PDF, converts exactly once, and preserves the source reference', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'aboss-quote-e2e-'));
    directories.push(directory);
    const app = await buildApp({ dbPath: join(directory, 'app.db'), authBypassForTesting: true });
    const customerResponse = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Production Workflow Customer', email: 'workflow@example.test' },
    });
    const customer = customerResponse.json<{ id: string }>();
    const quoteResponse = await app.inject({
      method: 'POST',
      url: '/quotes',
      payload: {
        customerId: customer.id,
        title: 'Weekend acceptance quote',
        issueDate: '2026-07-13',
        expiryDate: '2026-07-27',
        paymentTerms: 'Due in 14 days',
        lineItems: [
          { description: 'Professional service', quantity: 2, unitPrice: 100, gstApplicable: true },
        ],
      },
    });
    expect(quoteResponse.statusCode).toBe(201);
    const quote = quoteResponse.json<{
      id: string;
      quoteNumber: string;
      totals: { total: number };
    }>();
    expect(quote.quoteNumber).toMatch(/^QUO-2026-\d{6}$/);
    expect(quote.totals.total).toBe(220);

    await app.inject({
      method: 'POST',
      url: '/business-profile',
      payload: {
        companyName: 'ABoss Test Business',
        address: '1 Test Street, Sydney NSW 2000',
        primaryColor: '#173f35',
        secondaryColor: '#c4f36b',
      },
    });

    const pdf = await app.inject({ method: 'GET', url: `/quotes/${quote.id}/pdf` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');

    const accepted = await app.inject({
      method: 'PUT',
      url: `/quotes/${quote.id}`,
      payload: {
        customerId: customer.id,
        title: 'Weekend acceptance quote',
        issueDate: '2026-07-13',
        expiryDate: '2026-07-27',
        paymentTerms: 'Due in 14 days',
        lineItems: [
          { description: 'Professional service', quantity: 2, unitPrice: 100, gstApplicable: true },
        ],
        status: 'Accepted',
      },
    });
    expect(accepted.statusCode).toBe(200);

    const firstConversion = await app.inject({
      method: 'POST',
      url: `/quotes/${quote.id}/convert`,
    });
    const secondConversion = await app.inject({
      method: 'POST',
      url: `/quotes/${quote.id}/convert`,
    });
    expect(firstConversion.statusCode).toBe(200);
    expect(secondConversion.statusCode).toBe(200);
    const invoice = firstConversion.json<{
      id: string;
      sourceQuoteId: string;
      sourceQuoteNumber: string;
      status: string;
    }>();
    expect(secondConversion.json<{ id: string }>().id).toBe(invoice.id);
    expect(invoice).toMatchObject({
      sourceQuoteId: quote.id,
      sourceQuoteNumber: quote.quoteNumber,
      status: 'Finalised',
    });
    const converted = await app.inject({ method: 'GET', url: `/quotes/${quote.id}` });
    expect(converted.json()).toMatchObject({ status: 'Converted', convertedInvoiceId: invoice.id });
    const timeline = await app.inject({ method: 'GET', url: `/timeline/quote/${quote.id}` });
    expect(
      timeline
        .json<{ events: Array<{ eventKey: string }> }>()
        .events.map((event) => event.eventKey),
    ).toEqual(expect.arrayContaining(['quote.created', 'quote.converted']));
    await app.close();
  });

  it('provisions only one owner atomically against the application database', () => {
    const db = createDatabase(':memory:');
    const owner = db.provisionOwner({
      id: randomUUID(),
      displayName: 'Ahmed Owner',
      email: 'owner@example.test',
    });
    expect(owner.roleIds).toHaveLength(1);
    expect(db.getRoleById(owner.roleIds[0]!)).toMatchObject({
      name: 'Owner',
      canBeAssigned: true,
      canManageAssignments: true,
    });
    expect(() =>
      db.provisionOwner({
        id: randomUUID(),
        displayName: 'Second Owner',
        email: 'second@example.test',
      }),
    ).toThrow('OWNER_ALREADY_PROVISIONED');
    db.close();
  });
});
