import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });
const finalisedSchema = z.object({
  status: z.literal('Finalised'),
  invoiceNumber: z.string(),
});

describe('slice 1 happy path e2e', () => {
  it('runs customer -> draft -> update -> finalise -> pdf -> search', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const customerRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: {
        displayName: 'Bluebird Co',
        email: 'hello@bluebird.co',
      },
    });
    expect(customerRes.statusCode).toBe(201);
    const customer = idSchema.parse(customerRes.json());

    const profileRes = await app.inject({
      method: 'POST',
      url: '/business-profile',
      payload: {
        companyName: 'My Services Pty Ltd',
        primaryColor: '#1d4ed8',
        secondaryColor: '#0f172a',
      },
    });
    expect(profileRes.statusCode).toBe(200);

    const prefRes = await app.inject({
      method: 'POST',
      url: '/preferences/invoice',
      payload: {
        value: {
          defaultPaymentTerms: '7 days',
          defaultGst: true,
        },
      },
    });
    expect(prefRes.statusCode).toBe(201);

    const draftRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customer.id,
        title: 'Consulting Services',
        issueDate: '2026-07-06',
        dueDate: '2026-07-13',
        lineItems: [
          { description: 'Consulting', quantity: 3, unitPrice: 150, gstApplicable: true },
        ],
      },
    });
    expect(draftRes.statusCode).toBe(201);
    const draft = idSchema.parse(draftRes.json());

    const updateRes = await app.inject({
      method: 'PUT',
      url: `/invoices/${draft.id}`,
      payload: {
        title: 'Consulting Services - revised',
        issueDate: '2026-07-06',
        dueDate: '2026-07-13',
        paymentState: 'Sent',
        lineItems: [
          { description: 'Consulting', quantity: 3, unitPrice: 150, gstApplicable: true },
          { description: 'Support', quantity: 1, unitPrice: 80, gstApplicable: false },
        ],
      },
    });
    expect(updateRes.statusCode).toBe(200);

    const finaliseRes = await app.inject({
      method: 'POST',
      url: `/invoices/${draft.id}/finalise`,
    });
    expect(finaliseRes.statusCode).toBe(200);
    const finalised = finalisedSchema.parse(finaliseRes.json());
    expect(finalised.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/invoices/${draft.id}/pdf`,
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.body.length).toBeGreaterThan(1000);

    const timelineRes = await app.inject({
      method: 'GET',
      url: `/timeline/invoice/${draft.id}`,
    });
    expect(timelineRes.statusCode).toBe(200);
    const timeline = z
      .object({ events: z.array(z.object({ eventType: z.string() })) })
      .parse(timelineRes.json());
    expect(timeline.events.map((event) => event.eventType)).toEqual([
      'Draft Created',
      'Draft Updated',
      'Invoice Finalised',
    ]);

    const searchRes = await app.inject({
      method: 'GET',
      url: '/search?q=Consulting',
    });
    expect(searchRes.statusCode).toBe(200);
    const searchResults = z
      .object({
        invoices: z.array(z.unknown()),
        documents: z.array(z.unknown()),
        customers: z.array(z.unknown()),
      })
      .parse(searchRes.json());
    expect(searchResults.invoices.length).toBeGreaterThan(0);
    expect(searchResults.documents.length).toBeGreaterThan(0);

    await app.close();
  });
});
