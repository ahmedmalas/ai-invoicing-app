import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

const creditNoteSchema = z.object({
  id: z.string().uuid(),
  creditNoteNumber: z.string(),
  linkedInvoiceId: z.string().uuid(),
  customerId: z.string().uuid(),
  type: z.enum(['Full', 'Partial']),
  status: z.literal('Issued'),
  totalCredit: z.number(),
  lineItems: z.array(
    z.object({
      description: z.string(),
      amount: z.number(),
    }),
  ),
});

describe('credit notes e2e', () => {
  it('supports lifecycle-safe full and partial credits', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const customerARes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Credit Customer A' },
    });
    expect(customerARes.statusCode).toBe(201);
    const customerA = idSchema.parse(customerARes.json());

    const customerBRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Credit Customer B' },
    });
    expect(customerBRes.statusCode).toBe(201);
    const customerB = idSchema.parse(customerBRes.json());

    const invoiceDraftRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customerA.id,
        title: 'Draft Invoice Rejection',
        issueDate: '2026-07-07',
        dueDate: '2026-07-14',
        lineItems: [{ description: 'Draft work', quantity: 1, unitPrice: 100, gstApplicable: true }],
      },
    });
    expect(invoiceDraftRes.statusCode).toBe(201);
    const draftInvoice = idSchema.parse(invoiceDraftRes.json());

    const draftCreditAttemptRes = await app.inject({
      method: 'POST',
      url: '/credit-notes',
      payload: {
        linkedInvoiceId: draftInvoice.id,
        issueDate: '2026-07-08',
        reason: 'Should fail',
        type: 'Partial',
        adjustmentAmount: 20,
      },
    });
    expect(draftCreditAttemptRes.statusCode).toBe(409);
    expect(draftCreditAttemptRes.json()).toMatchObject({
      message: 'CREDIT_NOTE_REQUIRES_FINALISED_INVOICE',
    });

    const finalInvoiceDraftRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customerA.id,
        title: 'Invoice To Credit',
        issueDate: '2026-07-07',
        dueDate: '2026-07-14',
        lineItems: [
          { description: 'Line A', quantity: 2, unitPrice: 100, gstApplicable: true },
          { description: 'Line B', quantity: 1, unitPrice: 50, gstApplicable: true },
        ],
      },
    });
    expect(finalInvoiceDraftRes.statusCode).toBe(201);
    const finalInvoiceDraft = idSchema.parse(finalInvoiceDraftRes.json());

    const finaliseInvoiceRes = await app.inject({
      method: 'POST',
      url: `/invoices/${finalInvoiceDraft.id}/finalise`,
    });
    expect(finaliseInvoiceRes.statusCode).toBe(200);
    const finalisedInvoice = z
      .object({
        id: z.string().uuid(),
        status: z.literal('Finalised'),
        totals: z.object({
          total: z.number(),
        }),
      })
      .parse(finaliseInvoiceRes.json());

    const invoiceBeforeCreditRes = await app.inject({
      method: 'GET',
      url: `/invoices/${finalInvoiceDraft.id}`,
    });
    expect(invoiceBeforeCreditRes.statusCode).toBe(200);
    const invoiceBeforeCredit = z
      .object({
        id: z.string().uuid(),
        status: z.literal('Finalised'),
        totals: z.object({ total: z.number() }),
      })
      .parse(invoiceBeforeCreditRes.json());

    const partialCreditRes = await app.inject({
      method: 'POST',
      url: '/credit-notes',
      payload: {
        linkedInvoiceId: finalisedInvoice.id,
        issueDate: '2026-07-09',
        reason: 'Partial goodwill credit',
        type: 'Partial',
        lineItems: [{ description: 'Goodwill adjustment', amount: 55 }],
      },
    });
    expect(partialCreditRes.statusCode).toBe(201);
    const partialCredit = creditNoteSchema.parse(partialCreditRes.json());
    expect(partialCredit.totalCredit).toBe(55);
    expect(partialCredit.type).toBe('Partial');

    const overCreditRes = await app.inject({
      method: 'POST',
      url: '/credit-notes',
      payload: {
        linkedInvoiceId: finalisedInvoice.id,
        issueDate: '2026-07-09',
        reason: 'Over credit should fail',
        type: 'Partial',
        adjustmentAmount: finalisedInvoice.totals.total + 1,
      },
    });
    expect(overCreditRes.statusCode).toBe(409);
    expect(overCreditRes.json()).toMatchObject({
      message: 'CREDIT_NOTE_AMOUNT_EXCEEDS_INVOICE_TOTAL',
    });

    const fullCreditRes = await app.inject({
      method: 'POST',
      url: '/credit-notes',
      payload: {
        linkedInvoiceId: finalisedInvoice.id,
        issueDate: '2026-07-10',
        reason: 'Full invoice reversal',
        type: 'Full',
      },
    });
    expect(fullCreditRes.statusCode).toBe(201);
    const fullCredit = creditNoteSchema.parse(fullCreditRes.json());
    expect(fullCredit.totalCredit).toBe(finalisedInvoice.totals.total);
    expect(fullCredit.type).toBe('Full');

    const duplicateFullCreditRes = await app.inject({
      method: 'POST',
      url: '/credit-notes',
      payload: {
        linkedInvoiceId: finalisedInvoice.id,
        issueDate: '2026-07-11',
        reason: 'Duplicate full credit',
        type: 'Full',
      },
    });
    expect(duplicateFullCreditRes.statusCode).toBe(409);
    expect(duplicateFullCreditRes.json()).toMatchObject({
      message: 'CREDIT_NOTE_FULL_ALREADY_EXISTS',
    });

    const invalidInvoiceRes = await app.inject({
      method: 'POST',
      url: '/credit-notes',
      payload: {
        linkedInvoiceId: '550e8400-e29b-41d4-a716-446655440099',
        issueDate: '2026-07-11',
        reason: 'Invalid invoice',
        type: 'Partial',
        adjustmentAmount: 10,
      },
    });
    expect(invalidInvoiceRes.statusCode).toBe(404);

    const otherInvoiceDraftRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customerB.id,
        title: 'Other customer final invoice',
        issueDate: '2026-07-07',
        dueDate: '2026-07-14',
        lineItems: [{ description: 'Other', quantity: 1, unitPrice: 90, gstApplicable: true }],
      },
    });
    expect(otherInvoiceDraftRes.statusCode).toBe(201);
    const otherInvoice = idSchema.parse(otherInvoiceDraftRes.json());
    const otherFinaliseRes = await app.inject({
      method: 'POST',
      url: `/invoices/${otherInvoice.id}/finalise`,
    });
    expect(otherFinaliseRes.statusCode).toBe(200);
    const otherFinalised = z.object({ id: z.string().uuid() }).parse(otherFinaliseRes.json());

    const otherCustomerCreditRes = await app.inject({
      method: 'POST',
      url: '/credit-notes',
      payload: {
        linkedInvoiceId: otherFinalised.id,
        issueDate: '2026-07-12',
        reason: 'Other customer credit',
        type: 'Partial',
        adjustmentAmount: 20,
      },
    });
    expect(otherCustomerCreditRes.statusCode).toBe(201);
    const otherCustomerCredit = creditNoteSchema.parse(otherCustomerCreditRes.json());

    const getCreditRes = await app.inject({
      method: 'GET',
      url: `/credit-notes/${partialCredit.id}`,
    });
    expect(getCreditRes.statusCode).toBe(200);
    expect(creditNoteSchema.parse(getCreditRes.json()).id).toBe(partialCredit.id);

    const listByCustomerRes = await app.inject({
      method: 'GET',
      url: `/credit-notes/customers/${customerA.id}`,
    });
    expect(listByCustomerRes.statusCode).toBe(200);
    const customerList = z.object({ creditNotes: z.array(creditNoteSchema) }).parse(listByCustomerRes.json());
    expect(customerList.creditNotes.some((credit) => credit.id === partialCredit.id)).toBe(true);
    expect(customerList.creditNotes.some((credit) => credit.id === fullCredit.id)).toBe(true);
    expect(customerList.creditNotes.some((credit) => credit.id === otherCustomerCredit.id)).toBe(false);

    const listByInvoiceRes = await app.inject({
      method: 'GET',
      url: `/credit-notes/invoices/${finalisedInvoice.id}`,
    });
    expect(listByInvoiceRes.statusCode).toBe(200);
    const invoiceList = z.object({ creditNotes: z.array(creditNoteSchema) }).parse(listByInvoiceRes.json());
    expect(invoiceList.creditNotes.map((credit) => credit.id).sort()).toEqual(
      [partialCredit.id, fullCredit.id].sort(),
    );

    const listWithFiltersRes = await app.inject({
      method: 'GET',
      url: `/credit-notes?customerId=${customerA.id}&invoiceId=${finalisedInvoice.id}`,
    });
    expect(listWithFiltersRes.statusCode).toBe(200);
    const filteredList = z.object({ creditNotes: z.array(creditNoteSchema) }).parse(listWithFiltersRes.json());
    expect(filteredList.creditNotes.length).toBe(2);

    const htmlRes = await app.inject({
      method: 'GET',
      url: `/credit-notes/${partialCredit.id}/html`,
    });
    expect(htmlRes.statusCode).toBe(200);
    expect(htmlRes.headers['content-type']).toContain('text/html');
    expect(htmlRes.body).toContain('Credit Note');
    expect(htmlRes.body).toContain('Partial goodwill credit');

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/credit-notes/${partialCredit.id}/pdf`,
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.body.length).toBeGreaterThan(1000);

    const timelineRes = await app.inject({
      method: 'GET',
      url: `/timeline/credit_note/${partialCredit.id}`,
    });
    expect(timelineRes.statusCode).toBe(200);
    const timeline = z
      .object({
        events: z.array(z.object({ eventKey: z.string() })),
      })
      .parse(timelineRes.json());
    expect(timeline.events.some((event) => event.eventKey === 'credit_note.created')).toBe(true);

    const invoiceAfterCreditRes = await app.inject({
      method: 'GET',
      url: `/invoices/${finalisedInvoice.id}`,
    });
    expect(invoiceAfterCreditRes.statusCode).toBe(200);
    const invoiceAfterCredit = z
      .object({
        id: z.string().uuid(),
        status: z.literal('Finalised'),
        totals: z.object({ total: z.number() }),
      })
      .parse(invoiceAfterCreditRes.json());
    expect(invoiceAfterCredit.totals.total).toBe(invoiceBeforeCredit.totals.total);
    expect(invoiceAfterCredit.status).toBe(invoiceBeforeCredit.status);

    await app.close();
  });
});
