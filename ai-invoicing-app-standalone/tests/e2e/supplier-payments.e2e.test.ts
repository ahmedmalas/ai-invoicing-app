import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

const supplierPaymentSchema = z.object({
  id: z.string().uuid(),
  paymentNumber: z.string(),
  supplierId: z.string().uuid(),
  paymentDate: z.string(),
  paymentMethod: z.string(),
  reference: z.string(),
  amount: z.number(),
  allocations: z.array(
    z.object({
      supplierBillId: z.string().uuid(),
      amount: z.number(),
    }),
  ),
});

describe('supplier payments e2e', () => {
  it('supports supplier payment allocations without mutating supplier bill totals', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const supplierARes = await app.inject({
      method: 'POST',
      url: '/suppliers',
      payload: { displayName: 'Supplier A' },
    });
    expect(supplierARes.statusCode).toBe(201);
    const supplierA = idSchema.parse(supplierARes.json());

    const supplierBRes = await app.inject({
      method: 'POST',
      url: '/suppliers',
      payload: { displayName: 'Supplier B' },
    });
    expect(supplierBRes.statusCode).toBe(201);
    const supplierB = idSchema.parse(supplierBRes.json());

    const draftBillRes = await app.inject({
      method: 'POST',
      url: '/supplier-bills',
      payload: {
        supplierId: supplierA.id,
        billDate: '2026-07-07',
        dueDate: '2026-07-14',
        currency: 'AUD',
        lineItems: [{ description: 'Draft line', quantity: 1, unitPrice: 100, gstApplicable: true }],
      },
    });
    expect(draftBillRes.statusCode).toBe(201);
    const draftBill = idSchema.parse(draftBillRes.json());

    const billA1DraftRes = await app.inject({
      method: 'POST',
      url: '/supplier-bills',
      payload: {
        supplierId: supplierA.id,
        billDate: '2026-07-07',
        dueDate: '2026-07-14',
        supplierReference: 'A1',
        currency: 'AUD',
        lineItems: [{ description: 'A1 line', quantity: 1, unitPrice: 200, gstApplicable: true }],
      },
    });
    expect(billA1DraftRes.statusCode).toBe(201);
    const billA1Draft = idSchema.parse(billA1DraftRes.json());

    const billA2DraftRes = await app.inject({
      method: 'POST',
      url: '/supplier-bills',
      payload: {
        supplierId: supplierA.id,
        billDate: '2026-07-08',
        dueDate: '2026-07-15',
        supplierReference: 'A2',
        currency: 'AUD',
        lineItems: [{ description: 'A2 line', quantity: 1, unitPrice: 100, gstApplicable: true }],
      },
    });
    expect(billA2DraftRes.statusCode).toBe(201);
    const billA2Draft = idSchema.parse(billA2DraftRes.json());

    const billBDraftRes = await app.inject({
      method: 'POST',
      url: '/supplier-bills',
      payload: {
        supplierId: supplierB.id,
        billDate: '2026-07-09',
        dueDate: '2026-07-16',
        supplierReference: 'B1',
        currency: 'AUD',
        lineItems: [{ description: 'B line', quantity: 1, unitPrice: 90, gstApplicable: true }],
      },
    });
    expect(billBDraftRes.statusCode).toBe(201);
    const billBDraft = idSchema.parse(billBDraftRes.json());

    const billA1FinaliseRes = await app.inject({
      method: 'POST',
      url: `/supplier-bills/${billA1Draft.id}/finalise`,
    });
    expect(billA1FinaliseRes.statusCode).toBe(200);
    const billA1 = z
      .object({
        id: z.string().uuid(),
        supplierId: z.string().uuid(),
        status: z.literal('Finalised'),
        totals: z.object({ total: z.number() }),
      })
      .parse(billA1FinaliseRes.json());

    const billA2FinaliseRes = await app.inject({
      method: 'POST',
      url: `/supplier-bills/${billA2Draft.id}/finalise`,
    });
    expect(billA2FinaliseRes.statusCode).toBe(200);
    const billA2 = z
      .object({
        id: z.string().uuid(),
        supplierId: z.string().uuid(),
        status: z.literal('Finalised'),
        totals: z.object({ total: z.number() }),
      })
      .parse(billA2FinaliseRes.json());

    const billBFinaliseRes = await app.inject({
      method: 'POST',
      url: `/supplier-bills/${billBDraft.id}/finalise`,
    });
    expect(billBFinaliseRes.statusCode).toBe(200);
    const billB = z
      .object({
        id: z.string().uuid(),
        supplierId: z.string().uuid(),
        status: z.literal('Finalised'),
        totals: z.object({ total: z.number() }),
      })
      .parse(billBFinaliseRes.json());

    const billBeforePaymentsRes = await app.inject({
      method: 'GET',
      url: `/supplier-bills/${billA1.id}`,
    });
    expect(billBeforePaymentsRes.statusCode).toBe(200);
    const billBeforePayments = z
      .object({
        id: z.string().uuid(),
        totals: z.object({ total: z.number() }),
      })
      .parse(billBeforePaymentsRes.json());

    const draftBillAllocationRes = await app.inject({
      method: 'POST',
      url: '/supplier-payments',
      payload: {
        supplierId: supplierA.id,
        paymentDate: '2026-07-10',
        paymentMethod: 'Bank Transfer',
        reference: 'SPAY-DRAFT',
        amount: 10,
        allocations: [{ supplierBillId: draftBill.id, amount: 10 }],
      },
    });
    expect(draftBillAllocationRes.statusCode).toBe(409);

    const wrongSupplierAllocationRes = await app.inject({
      method: 'POST',
      url: '/supplier-payments',
      payload: {
        supplierId: supplierA.id,
        paymentDate: '2026-07-10',
        paymentMethod: 'Bank Transfer',
        reference: 'SPAY-WRONG',
        amount: 20,
        allocations: [{ supplierBillId: billB.id, amount: 20 }],
      },
    });
    expect(wrongSupplierAllocationRes.statusCode).toBe(409);
    expect(wrongSupplierAllocationRes.json()).toMatchObject({
      message: 'SUPPLIER_PAYMENT_ALLOCATION_SUPPLIER_MISMATCH',
    });

    const duplicateAllocationEntryRes = await app.inject({
      method: 'POST',
      url: '/supplier-payments',
      payload: {
        supplierId: supplierA.id,
        paymentDate: '2026-07-10',
        paymentMethod: 'Bank Transfer',
        reference: 'SPAY-DUP',
        amount: 50,
        allocations: [
          { supplierBillId: billA1.id, amount: 25 },
          { supplierBillId: billA1.id, amount: 25 },
        ],
      },
    });
    expect(duplicateAllocationEntryRes.statusCode).toBe(409);
    expect(duplicateAllocationEntryRes.json()).toMatchObject({
      message: 'SUPPLIER_PAYMENT_DUPLICATE_ALLOCATION_BILL',
    });

    const partialPaymentRes = await app.inject({
      method: 'POST',
      url: '/supplier-payments',
      payload: {
        supplierId: supplierA.id,
        paymentDate: '2026-07-10',
        paymentMethod: 'Bank Transfer',
        reference: 'SPAY-PARTIAL',
        amount: 100,
        allocations: [{ supplierBillId: billA1.id, amount: 100 }],
      },
    });
    expect(partialPaymentRes.statusCode).toBe(201);
    const partialPayment = supplierPaymentSchema.parse(partialPaymentRes.json());

    const multiPaymentRes = await app.inject({
      method: 'POST',
      url: '/supplier-payments',
      payload: {
        supplierId: supplierA.id,
        paymentDate: '2026-07-11',
        paymentMethod: 'Card',
        reference: 'SPAY-MULTI',
        amount: 230,
        allocations: [
          { supplierBillId: billA1.id, amount: billA1.totals.total - 100 },
          { supplierBillId: billA2.id, amount: billA2.totals.total },
        ],
      },
    });
    expect(multiPaymentRes.statusCode).toBe(201);
    const multiPayment = supplierPaymentSchema.parse(multiPaymentRes.json());

    const overAllocationRes = await app.inject({
      method: 'POST',
      url: '/supplier-payments',
      payload: {
        supplierId: supplierA.id,
        paymentDate: '2026-07-12',
        paymentMethod: 'Cash',
        reference: 'SPAY-OVER',
        amount: 10,
        allocations: [{ supplierBillId: billA1.id, amount: 10 }],
      },
    });
    expect(overAllocationRes.statusCode).toBe(409);
    expect(overAllocationRes.json()).toMatchObject({
      message: 'SUPPLIER_PAYMENT_ALLOCATION_EXCEEDS_OUTSTANDING',
    });

    const billAfterPaymentsRes = await app.inject({
      method: 'GET',
      url: `/supplier-bills/${billA1.id}`,
    });
    expect(billAfterPaymentsRes.statusCode).toBe(200);
    const billAfterPayments = z
      .object({
        id: z.string().uuid(),
        totals: z.object({ total: z.number() }),
        paymentState: z.enum(['Awaiting Payment', 'Paid']),
      })
      .parse(billAfterPaymentsRes.json());
    expect(billAfterPayments.totals.total).toBe(billBeforePayments.totals.total);
    expect(billAfterPayments.paymentState).toBe('Paid');

    const getPaymentRes = await app.inject({
      method: 'GET',
      url: `/supplier-payments/${partialPayment.id}`,
    });
    expect(getPaymentRes.statusCode).toBe(200);
    expect(supplierPaymentSchema.parse(getPaymentRes.json()).id).toBe(partialPayment.id);

    const bySupplierRes = await app.inject({
      method: 'GET',
      url: `/supplier-payments/suppliers/${supplierA.id}`,
    });
    expect(bySupplierRes.statusCode).toBe(200);
    const bySupplier = z.object({ payments: z.array(supplierPaymentSchema) }).parse(bySupplierRes.json());
    expect(bySupplier.payments.some((payment) => payment.id === partialPayment.id)).toBe(true);
    expect(bySupplier.payments.some((payment) => payment.id === multiPayment.id)).toBe(true);

    const byBillRes = await app.inject({
      method: 'GET',
      url: `/supplier-payments/bills/${billA2.id}`,
    });
    expect(byBillRes.statusCode).toBe(200);
    const byBill = z.object({ payments: z.array(supplierPaymentSchema) }).parse(byBillRes.json());
    expect(byBill.payments.map((payment) => payment.id)).toContain(multiPayment.id);

    const byDateRes = await app.inject({
      method: 'GET',
      url: `/supplier-payments?supplierId=${supplierA.id}&supplierBillId=${billA1.id}&from=2026-07-10&to=2026-07-11`,
    });
    expect(byDateRes.statusCode).toBe(200);
    const byDate = z.object({ payments: z.array(supplierPaymentSchema) }).parse(byDateRes.json());
    expect(byDate.payments.length).toBe(2);

    const htmlRes = await app.inject({
      method: 'GET',
      url: `/supplier-payments/${partialPayment.id}/html`,
    });
    expect(htmlRes.statusCode).toBe(200);
    expect(htmlRes.headers['content-type']).toContain('text/html');
    expect(htmlRes.body).toContain('Supplier Payment Receipt');

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/supplier-payments/${partialPayment.id}/pdf`,
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.body.length).toBeGreaterThan(1000);

    const timelineRes = await app.inject({
      method: 'GET',
      url: `/timeline/supplier_payment/${partialPayment.id}`,
    });
    expect(timelineRes.statusCode).toBe(200);
    const timeline = z.object({ events: z.array(z.object({ eventKey: z.string() })) }).parse(timelineRes.json());
    expect(timeline.events.some((event) => event.eventKey === 'supplier_payment.created')).toBe(true);
    expect(timeline.events.some((event) => event.eventKey === 'supplier_payment.allocated')).toBe(true);

    const searchRes = await app.inject({
      method: 'GET',
      url: `/search?q=${partialPayment.paymentNumber}`,
    });
    expect(searchRes.statusCode).toBe(200);
    const searchPayload = z
      .object({
        documents: z.array(z.object({ entityId: z.string() })),
      })
      .passthrough()
      .parse(searchRes.json());
    expect(searchPayload.documents.some((doc) => doc.entityId === partialPayment.id)).toBe(true);

    await app.close();
  });
});
