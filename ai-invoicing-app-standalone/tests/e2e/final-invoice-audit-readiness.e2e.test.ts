import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

describe('final invoice audit readiness e2e', () => {
  it('keeps finalised invoice immutable and exposes invoice.finalised timeline deterministically', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const customerRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: {
        displayName: 'Audit Ready Customer',
      },
    });
    expect(customerRes.statusCode).toBe(201);
    const customer = idSchema.parse(customerRes.json());

    const draftRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customer.id,
        title: 'Final Invoice Audit Ready',
        issueDate: '2026-07-07',
        dueDate: '2026-07-14',
        lineItems: [{ description: 'Implementation', quantity: 2, unitPrice: 100, gstApplicable: true }],
      },
    });
    expect(draftRes.statusCode).toBe(201);
    const draft = idSchema.parse(draftRes.json());

    const finaliseRes = await app.inject({
      method: 'POST',
      url: `/invoices/${draft.id}/finalise`,
    });
    expect(finaliseRes.statusCode).toBe(200);
    const finalised = z
      .object({
        id: z.string().uuid(),
        status: z.literal('Finalised'),
        invoiceNumber: z.string(),
      })
      .parse(finaliseRes.json());

    const postFinaliseEditRes = await app.inject({
      method: 'PUT',
      url: `/invoices/${draft.id}`,
      payload: {
        title: 'Should be blocked',
        issueDate: '2026-07-07',
        dueDate: '2026-07-14',
        paymentState: 'Sent',
        lineItems: [{ description: 'Tamper', quantity: 1, unitPrice: 1, gstApplicable: false }],
      },
    });
    expect(postFinaliseEditRes.statusCode).toBe(409);
    expect(postFinaliseEditRes.json()).toMatchObject({
      message: 'Only draft invoices can be edited',
    });

    const persistedFinalisedRes = await app.inject({
      method: 'GET',
      url: `/invoices/${draft.id}`,
    });
    expect(persistedFinalisedRes.statusCode).toBe(200);
    const persistedFinalised = z
      .object({
        status: z.literal('Finalised'),
        invoiceNumber: z.string(),
      })
      .parse(persistedFinalisedRes.json());
    expect(persistedFinalised.invoiceNumber).toBe(finalised.invoiceNumber);

    const timelineRes = await app.inject({
      method: 'GET',
      url: `/timeline/invoice/${draft.id}`,
    });
    expect(timelineRes.statusCode).toBe(200);
    const timeline = z
      .object({
        events: z.array(
          z.object({
            eventKey: z.string(),
          }),
        ),
      })
      .parse(timelineRes.json());
    expect(timeline.events.some((event) => event.eventKey === 'invoice.finalised')).toBe(true);

    const missingTimelineRes = await app.inject({
      method: 'GET',
      url: '/timeline/invoice/550e8400-e29b-41d4-a716-446655440099',
    });
    expect(missingTimelineRes.statusCode).toBe(200);
    expect(missingTimelineRes.json()).toMatchObject({ events: [] });

    const invalidTimelineLookupRes = await app.inject({
      method: 'GET',
      url: '/timeline/invoice/not-a-uuid',
    });
    expect(invalidTimelineLookupRes.statusCode).toBe(200);
    expect(invalidTimelineLookupRes.json()).toMatchObject({ events: [] });

    await app.close();
  });
});
