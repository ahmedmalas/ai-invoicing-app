import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

const statementSchema = z.object({
  customer: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
  }),
  generatedAt: z.string(),
  period: z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
  }),
  openingBalance: z.number(),
  periodTotal: z.number(),
  closingBalance: z.number(),
  entries: z.array(
    z.object({
      invoiceId: z.string().uuid(),
      invoiceNumber: z.string(),
      issueDate: z.string(),
      dueDate: z.string(),
      title: z.string(),
      total: z.number(),
    }),
  ),
  creditsSupported: z.literal(false),
  creditsOmittedReason: z.string(),
});

describe('customer statement engine e2e', () => {
  it('builds deterministic read-only statements and hardened exports', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const customerARes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Statement Customer A' },
    });
    expect(customerARes.statusCode).toBe(201);
    const customerA = idSchema.parse(customerARes.json());

    const customerBRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Statement Customer B' },
    });
    expect(customerBRes.statusCode).toBe(201);
    const customerB = idSchema.parse(customerBRes.json());

    const openingDraftRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customerA.id,
        title: 'Opening Invoice',
        issueDate: '2026-01-05',
        dueDate: '2026-01-20',
        lineItems: [{ description: 'Opening Work', quantity: 1, unitPrice: 100, gstApplicable: true }],
      },
    });
    expect(openingDraftRes.statusCode).toBe(201);
    const openingDraft = idSchema.parse(openingDraftRes.json());
    const openingFinaliseRes = await app.inject({
      method: 'POST',
      url: `/invoices/${openingDraft.id}/finalise`,
    });
    expect(openingFinaliseRes.statusCode).toBe(200);

    const periodFinalDraftRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customerA.id,
        title: 'Period Final Invoice',
        issueDate: '2026-02-10',
        dueDate: '2026-02-25',
        lineItems: [{ description: 'Period Work', quantity: 2, unitPrice: 100, gstApplicable: true }],
      },
    });
    expect(periodFinalDraftRes.statusCode).toBe(201);
    const periodFinalDraft = idSchema.parse(periodFinalDraftRes.json());
    const periodFinaliseRes = await app.inject({
      method: 'POST',
      url: `/invoices/${periodFinalDraft.id}/finalise`,
    });
    expect(periodFinaliseRes.statusCode).toBe(200);
    const periodFinalised = z.object({ id: z.string().uuid() }).parse(periodFinaliseRes.json());

    const periodDraftOnlyRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customerA.id,
        title: 'Period Draft Only',
        issueDate: '2026-02-15',
        dueDate: '2026-02-28',
        lineItems: [{ description: 'Draft Work', quantity: 3, unitPrice: 50, gstApplicable: true }],
      },
    });
    expect(periodDraftOnlyRes.statusCode).toBe(201);
    const periodDraftOnly = idSchema.parse(periodDraftOnlyRes.json());

    const otherCustomerDraftRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customerB.id,
        title: 'Other Customer Invoice',
        issueDate: '2026-02-12',
        dueDate: '2026-02-26',
        lineItems: [{ description: 'Other Work', quantity: 1, unitPrice: 80, gstApplicable: true }],
      },
    });
    expect(otherCustomerDraftRes.statusCode).toBe(201);
    const otherCustomerDraft = idSchema.parse(otherCustomerDraftRes.json());
    const otherCustomerFinaliseRes = await app.inject({
      method: 'POST',
      url: `/invoices/${otherCustomerDraft.id}/finalise`,
    });
    expect(otherCustomerFinaliseRes.statusCode).toBe(200);

    const timelineBeforeRes = await app.inject({
      method: 'GET',
      url: `/timeline/invoice/${periodFinalDraft.id}`,
    });
    expect(timelineBeforeRes.statusCode).toBe(200);
    const timelineBefore = z.object({ events: z.array(z.unknown()) }).parse(timelineBeforeRes.json());

    const statementRes = await app.inject({
      method: 'GET',
      url: `/statements/customers/${customerA.id}?from=2026-02-01&to=2026-02-28`,
    });
    expect(statementRes.statusCode).toBe(200);
    const statement = statementSchema.parse(statementRes.json());

    expect(statement.entries.map((entry) => entry.invoiceId)).toContain(periodFinalised.id);
    expect(statement.entries.map((entry) => entry.invoiceId)).not.toContain(periodDraftOnly.id);
    expect(statement.entries.every((entry) => entry.issueDate >= '2026-02-01' && entry.issueDate <= '2026-02-28')).toBe(
      true,
    );
    expect(statement.customer.id).toBe(customerA.id);
    expect(statement.entries.some((entry) => entry.title === 'Other Customer Invoice')).toBe(false);
    expect(statement.openingBalance).toBe(110);
    expect(statement.periodTotal).toBe(220);
    expect(statement.closingBalance).toBe(330);
    expect(statement.creditsSupported).toBe(false);

    const htmlRes = await app.inject({
      method: 'GET',
      url: `/statements/customers/${customerA.id}/html?from=2026-02-01&to=2026-02-28`,
    });
    expect(htmlRes.statusCode).toBe(200);
    expect(htmlRes.headers['content-type']).toContain('text/html');
    expect(htmlRes.body).toContain('Customer Statement');
    expect(htmlRes.body).toContain('Period Final Invoice');
    expect(htmlRes.body).not.toContain('Period Draft Only');
    expect(htmlRes.body).toContain('Opening Balance:</strong> 110.00');
    expect(htmlRes.body).toContain('Closing Balance:</strong> 330.00');

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/statements/customers/${customerA.id}/pdf?from=2026-02-01&to=2026-02-28`,
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.body.length).toBeGreaterThan(1000);
    expect(pdfRes.headers['x-statement-source-signature']).toBe(htmlRes.headers['x-statement-source-signature']);
    expect(pdfRes.headers['x-statement-entry-count']).toBe(htmlRes.headers['x-statement-entry-count']);

    const timelineAfterRes = await app.inject({
      method: 'GET',
      url: `/timeline/invoice/${periodFinalDraft.id}`,
    });
    expect(timelineAfterRes.statusCode).toBe(200);
    const timelineAfter = z.object({ events: z.array(z.unknown()) }).parse(timelineAfterRes.json());
    expect(timelineAfter.events).toHaveLength(timelineBefore.events.length);

    const invalidCustomerIdRes = await app.inject({
      method: 'GET',
      url: '/statements/customers/not-a-uuid?from=2026-02-01&to=2026-02-28',
    });
    expect(invalidCustomerIdRes.statusCode).toBe(400);

    const missingCustomerRes = await app.inject({
      method: 'GET',
      url: '/statements/customers/550e8400-e29b-41d4-a716-446655440099?from=2026-02-01&to=2026-02-28',
    });
    expect(missingCustomerRes.statusCode).toBe(404);

    const invalidDateRes = await app.inject({
      method: 'GET',
      url: `/statements/customers/${customerA.id}?from=2026-02-99&to=2026-02-28`,
    });
    expect(invalidDateRes.statusCode).toBe(400);

    const invalidRangeRes = await app.inject({
      method: 'GET',
      url: `/statements/customers/${customerA.id}?from=2026-03-01&to=2026-02-28`,
    });
    expect(invalidRangeRes.statusCode).toBe(400);

    await app.close();
  });

  it('handles empty statement exports deterministically', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const customerRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Empty Statement Customer' },
    });
    expect(customerRes.statusCode).toBe(201);
    const customer = idSchema.parse(customerRes.json());

    const statementRes = await app.inject({
      method: 'GET',
      url: `/statements/customers/${customer.id}?from=2026-04-01&to=2026-04-30`,
    });
    expect(statementRes.statusCode).toBe(200);
    const statement = statementSchema.parse(statementRes.json());
    expect(statement.entries).toHaveLength(0);
    expect(statement.openingBalance).toBe(0);
    expect(statement.closingBalance).toBe(0);

    const htmlRes = await app.inject({
      method: 'GET',
      url: `/statements/customers/${customer.id}/html?from=2026-04-01&to=2026-04-30`,
    });
    expect(htmlRes.statusCode).toBe(200);
    expect(htmlRes.body).toContain('No finalised invoices in selected period.');

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/statements/customers/${customer.id}/pdf?from=2026-04-01&to=2026-04-30`,
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.body.length).toBeGreaterThan(1000);
    expect(pdfRes.headers['x-statement-entry-count']).toBe('0');

    await app.close();
  });
});
