import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

const paymentSchema = z.object({
  id: z.string().uuid(),
  paymentNumber: z.string(),
  customerId: z.string().uuid(),
  paymentDate: z.string(),
  paymentMethod: z.string(),
  reference: z.string(),
  amount: z.number(),
  allocations: z.array(
    z.object({
      invoiceId: z.string().uuid(),
      amount: z.number(),
    }),
  ),
});

describe('customer payments e2e', () => {
  it('supports lifecycle-safe payment allocation without invoice mutations', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const customerARes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Paying Customer A' },
    });
    expect(customerARes.statusCode).toBe(201);
    const customerA = idSchema.parse(customerARes.json());

    const customerBRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Paying Customer B' },
    });
    expect(customerBRes.statusCode).toBe(201);
    const customerB = idSchema.parse(customerBRes.json());

    const draftInvoiceRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customerA.id,
        title: 'Draft unpaid invoice',
        issueDate: '2026-07-07',
        dueDate: '2026-07-14',
        lineItems: [{ description: 'Draft work', quantity: 1, unitPrice: 100, gstApplicable: true }],
      },
    });
    expect(draftInvoiceRes.statusCode).toBe(201);
    const draftInvoice = idSchema.parse(draftInvoiceRes.json());

    const finalInvoiceA1DraftRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customerA.id,
        title: 'Final invoice A1',
        issueDate: '2026-07-07',
        dueDate: '2026-07-14',
        lineItems: [{ description: 'A1 service', quantity: 1, unitPrice: 200, gstApplicable: true }],
      },
    });
    expect(finalInvoiceA1DraftRes.statusCode).toBe(201);
    const invoiceA1Draft = idSchema.parse(finalInvoiceA1DraftRes.json());
    const finaliseA1Res = await app.inject({
      method: 'POST',
      url: `/invoices/${invoiceA1Draft.id}/finalise`,
    });
    expect(finaliseA1Res.statusCode).toBe(200);
    const invoiceA1 = z
      .object({
        id: z.string().uuid(),
        customerId: z.string().uuid(),
        status: z.literal('Finalised'),
        totals: z.object({ total: z.number() }),
      })
      .parse(finaliseA1Res.json());

    const finalInvoiceA2DraftRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customerA.id,
        title: 'Final invoice A2',
        issueDate: '2026-07-08',
        dueDate: '2026-07-15',
        lineItems: [{ description: 'A2 service', quantity: 1, unitPrice: 100, gstApplicable: true }],
      },
    });
    expect(finalInvoiceA2DraftRes.statusCode).toBe(201);
    const invoiceA2Draft = idSchema.parse(finalInvoiceA2DraftRes.json());
    const finaliseA2Res = await app.inject({
      method: 'POST',
      url: `/invoices/${invoiceA2Draft.id}/finalise`,
    });
    expect(finaliseA2Res.statusCode).toBe(200);
    const invoiceA2 = z
      .object({
        id: z.string().uuid(),
        customerId: z.string().uuid(),
        status: z.literal('Finalised'),
        totals: z.object({ total: z.number() }),
      })
      .parse(finaliseA2Res.json());

    const finalInvoiceBDraftRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customerB.id,
        title: 'Final invoice B1',
        issueDate: '2026-07-09',
        dueDate: '2026-07-16',
        lineItems: [{ description: 'B1 service', quantity: 1, unitPrice: 90, gstApplicable: true }],
      },
    });
    expect(finalInvoiceBDraftRes.statusCode).toBe(201);
    const invoiceBDraft = idSchema.parse(finalInvoiceBDraftRes.json());
    const finaliseBRes = await app.inject({
      method: 'POST',
      url: `/invoices/${invoiceBDraft.id}/finalise`,
    });
    expect(finaliseBRes.statusCode).toBe(200);
    const invoiceB = z
      .object({
        id: z.string().uuid(),
        customerId: z.string().uuid(),
        status: z.literal('Finalised'),
        totals: z.object({ total: z.number() }),
      })
      .parse(finaliseBRes.json());

    const invoiceBeforePaymentsRes = await app.inject({
      method: 'GET',
      url: `/invoices/${invoiceA1.id}`,
    });
    expect(invoiceBeforePaymentsRes.statusCode).toBe(200);
    const invoiceBeforePayments = z
      .object({
        id: z.string().uuid(),
        totals: z.object({ total: z.number() }),
      })
      .parse(invoiceBeforePaymentsRes.json());

    const draftInvoiceAllocationRes = await app.inject({
      method: 'POST',
      url: '/payments',
      payload: {
        customerId: customerA.id,
        paymentDate: '2026-07-10',
        paymentMethod: 'Bank Transfer',
        reference: 'PAY-DRAFT-1',
        amount: 20,
        allocations: [{ invoiceId: draftInvoice.id, amount: 20 }],
      },
    });
    expect(draftInvoiceAllocationRes.statusCode).toBe(409);
    expect(draftInvoiceAllocationRes.json()).toMatchObject({
      message: 'PAYMENT_ALLOCATION_REQUIRES_FINALISED_INVOICE',
    });

    const wrongCustomerAllocationRes = await app.inject({
      method: 'POST',
      url: '/payments',
      payload: {
        customerId: customerA.id,
        paymentDate: '2026-07-10',
        paymentMethod: 'Bank Transfer',
        reference: 'PAY-WRONG-CUSTOMER-1',
        amount: 30,
        allocations: [{ invoiceId: invoiceB.id, amount: 30 }],
      },
    });
    expect(wrongCustomerAllocationRes.statusCode).toBe(409);
    expect(wrongCustomerAllocationRes.json()).toMatchObject({
      message: 'PAYMENT_ALLOCATION_CUSTOMER_MISMATCH',
    });

    const duplicateAllocationEntryRes = await app.inject({
      method: 'POST',
      url: '/payments',
      payload: {
        customerId: customerA.id,
        paymentDate: '2026-07-10',
        paymentMethod: 'Bank Transfer',
        reference: 'PAY-DUP-ENTRY-1',
        amount: 50,
        allocations: [
          { invoiceId: invoiceA1.id, amount: 25 },
          { invoiceId: invoiceA1.id, amount: 25 },
        ],
      },
    });
    expect(duplicateAllocationEntryRes.statusCode).toBe(409);
    expect(duplicateAllocationEntryRes.json()).toMatchObject({
      message: 'PAYMENT_DUPLICATE_ALLOCATION_INVOICE',
    });

    const partialPaymentRes = await app.inject({
      method: 'POST',
      url: '/payments',
      payload: {
        customerId: customerA.id,
        paymentDate: '2026-07-10',
        paymentMethod: 'Bank Transfer',
        reference: 'PAY-PARTIAL-1',
        amount: 100,
        notes: 'First partial payment',
        allocations: [{ invoiceId: invoiceA1.id, amount: 100 }],
      },
    });
    expect(partialPaymentRes.statusCode).toBe(201);
    const partialPayment = paymentSchema.parse(partialPaymentRes.json());

    const multiInvoicePaymentRes = await app.inject({
      method: 'POST',
      url: '/payments',
      payload: {
        customerId: customerA.id,
        paymentDate: '2026-07-11',
        paymentMethod: 'Card',
        reference: 'PAY-MULTI-1',
        amount: 230,
        allocations: [
          { invoiceId: invoiceA1.id, amount: invoiceA1.totals.total - 100 },
          { invoiceId: invoiceA2.id, amount: invoiceA2.totals.total },
        ],
      },
    });
    expect(multiInvoicePaymentRes.statusCode).toBe(201);
    const multiPayment = paymentSchema.parse(multiInvoicePaymentRes.json());

    const overAllocationRes = await app.inject({
      method: 'POST',
      url: '/payments',
      payload: {
        customerId: customerA.id,
        paymentDate: '2026-07-12',
        paymentMethod: 'Cash',
        reference: 'PAY-OVER-1',
        amount: 10,
        allocations: [{ invoiceId: invoiceA1.id, amount: 10 }],
      },
    });
    expect(overAllocationRes.statusCode).toBe(409);
    expect(overAllocationRes.json()).toMatchObject({
      message: 'PAYMENT_ALLOCATION_EXCEEDS_OUTSTANDING',
    });

    const invoiceAfterPaymentsRes = await app.inject({
      method: 'GET',
      url: `/invoices/${invoiceA1.id}`,
    });
    expect(invoiceAfterPaymentsRes.statusCode).toBe(200);
    const invoiceAfterPayments = z
      .object({
        id: z.string().uuid(),
        status: z.literal('Finalised'),
        totals: z.object({ total: z.number() }),
        paymentState: z.enum(['Awaiting Payment', 'Paid']),
      })
      .parse(invoiceAfterPaymentsRes.json());
    expect(invoiceAfterPayments.totals.total).toBe(invoiceBeforePayments.totals.total);
    expect(invoiceAfterPayments.paymentState).toBe('Paid');

    const getPaymentRes = await app.inject({
      method: 'GET',
      url: `/payments/${partialPayment.id}`,
    });
    expect(getPaymentRes.statusCode).toBe(200);
    expect(paymentSchema.parse(getPaymentRes.json()).id).toBe(partialPayment.id);

    const byCustomerRes = await app.inject({
      method: 'GET',
      url: `/payments/customers/${customerA.id}`,
    });
    expect(byCustomerRes.statusCode).toBe(200);
    const byCustomer = z.object({ payments: z.array(paymentSchema) }).parse(byCustomerRes.json());
    expect(byCustomer.payments.some((payment) => payment.id === partialPayment.id)).toBe(true);
    expect(byCustomer.payments.some((payment) => payment.id === multiPayment.id)).toBe(true);

    const byInvoiceRes = await app.inject({
      method: 'GET',
      url: `/payments/invoices/${invoiceA2.id}`,
    });
    expect(byInvoiceRes.statusCode).toBe(200);
    const byInvoice = z.object({ payments: z.array(paymentSchema) }).parse(byInvoiceRes.json());
    expect(byInvoice.payments.map((payment) => payment.id)).toContain(multiPayment.id);

    const byRangeRes = await app.inject({
      method: 'GET',
      url: `/payments?customerId=${customerA.id}&invoiceId=${invoiceA1.id}&from=2026-07-10&to=2026-07-11`,
    });
    expect(byRangeRes.statusCode).toBe(200);
    const byRange = z.object({ payments: z.array(paymentSchema) }).parse(byRangeRes.json());
    expect(byRange.payments.length).toBe(2);

    const htmlRes = await app.inject({
      method: 'GET',
      url: `/payments/${partialPayment.id}/html`,
    });
    expect(htmlRes.statusCode).toBe(200);
    expect(htmlRes.headers['content-type']).toContain('text/html');
    expect(htmlRes.body).toContain('Payment Receipt');

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/payments/${partialPayment.id}/pdf`,
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.body.length).toBeGreaterThan(1000);

    const timelineRes = await app.inject({
      method: 'GET',
      url: `/timeline/payment/${partialPayment.id}`,
    });
    expect(timelineRes.statusCode).toBe(200);
    const timeline = z
      .object({
        events: z.array(z.object({ eventKey: z.string() })),
      })
      .parse(timelineRes.json());
    expect(timeline.events.some((event) => event.eventKey === 'payment.created')).toBe(true);
    expect(timeline.events.some((event) => event.eventKey === 'payment.allocated')).toBe(true);

    await app.close();
  });
});
