import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

const supplierBillSchema = z.object({
  id: z.string().uuid(),
  supplierId: z.string().uuid(),
  billNumber: z.string().nullable(),
  billDate: z.string(),
  dueDate: z.string(),
  supplierReference: z.string().nullable(),
  currency: z.string(),
  status: z.enum(['Draft', 'Finalised']),
  totals: z.object({ total: z.number() }),
});

describe('supplier bills e2e', () => {
  it('supports supplier bill lifecycle and retrieval with immutable finalised behavior', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const supplierRes = await app.inject({
      method: 'POST',
      url: '/suppliers',
      payload: { displayName: 'Main Supplier', email: 'supplier@example.com' },
    });
    expect(supplierRes.statusCode).toBe(201);
    const supplier = idSchema.parse(supplierRes.json());

    const invalidSupplierRes = await app.inject({
      method: 'POST',
      url: '/supplier-bills',
      payload: {
        supplierId: '550e8400-e29b-41d4-a716-446655440099',
        billDate: '2026-07-07',
        dueDate: '2026-07-14',
        currency: 'AUD',
        lineItems: [{ description: 'Invalid supplier item', quantity: 1, unitPrice: 10, gstApplicable: true }],
      },
    });
    expect(invalidSupplierRes.statusCode).toBe(404);

    const emptyBillRes = await app.inject({
      method: 'POST',
      url: '/supplier-bills',
      payload: {
        supplierId: supplier.id,
        billDate: '2026-07-07',
        dueDate: '2026-07-14',
        currency: 'AUD',
        lineItems: [],
      },
    });
    expect(emptyBillRes.statusCode).toBe(400);

    const negativeQtyRes = await app.inject({
      method: 'POST',
      url: '/supplier-bills',
      payload: {
        supplierId: supplier.id,
        billDate: '2026-07-07',
        dueDate: '2026-07-14',
        currency: 'AUD',
        lineItems: [{ description: 'Invalid qty', quantity: -1, unitPrice: 10, gstApplicable: true }],
      },
    });
    expect(negativeQtyRes.statusCode).toBe(400);

    const negativePriceRes = await app.inject({
      method: 'POST',
      url: '/supplier-bills',
      payload: {
        supplierId: supplier.id,
        billDate: '2026-07-07',
        dueDate: '2026-07-14',
        currency: 'AUD',
        lineItems: [{ description: 'Invalid price', quantity: 1, unitPrice: -10, gstApplicable: true }],
      },
    });
    expect(negativePriceRes.statusCode).toBe(400);

    const draftBillRes = await app.inject({
      method: 'POST',
      url: '/supplier-bills',
      payload: {
        supplierId: supplier.id,
        billDate: '2026-07-08',
        dueDate: '2026-07-21',
        supplierReference: 'SUP-REF-1',
        currency: 'AUD',
        notes: 'Office supplies',
        lineItems: [
          { description: 'Paper', quantity: 2, unitPrice: 20, gstApplicable: true },
          { description: 'Pens', quantity: 1, unitPrice: 10, gstApplicable: true },
        ],
      },
    });
    expect(draftBillRes.statusCode).toBe(201);
    const draftBill = supplierBillSchema.parse(draftBillRes.json());
    expect(draftBill.status).toBe('Draft');

    const duplicateRefRes = await app.inject({
      method: 'POST',
      url: '/supplier-bills',
      payload: {
        supplierId: supplier.id,
        billDate: '2026-07-09',
        dueDate: '2026-07-22',
        supplierReference: 'SUP-REF-1',
        currency: 'AUD',
        lineItems: [{ description: 'Another item', quantity: 1, unitPrice: 10, gstApplicable: true }],
      },
    });
    expect(duplicateRefRes.statusCode).toBe(409);

    const finaliseRes = await app.inject({
      method: 'POST',
      url: `/supplier-bills/${draftBill.id}/finalise`,
    });
    expect(finaliseRes.statusCode).toBe(200);
    const finalisedBill = supplierBillSchema.parse(finaliseRes.json());
    expect(finalisedBill.status).toBe('Finalised');
    expect(finalisedBill.billNumber).toBeTruthy();

    const immutableUpdateRes = await app.inject({
      method: 'PUT',
      url: `/supplier-bills/${draftBill.id}`,
      payload: {
        billDate: '2026-07-10',
        dueDate: '2026-07-25',
        supplierReference: 'SUP-REF-UPDATED',
        currency: 'AUD',
        lineItems: [{ description: 'Changed', quantity: 1, unitPrice: 99, gstApplicable: true }],
      },
    });
    expect(immutableUpdateRes.statusCode).toBe(409);

    const bySupplierRes = await app.inject({
      method: 'GET',
      url: `/supplier-bills?supplierId=${supplier.id}`,
    });
    expect(bySupplierRes.statusCode).toBe(200);
    const bySupplier = z.object({ bills: z.array(supplierBillSchema) }).parse(bySupplierRes.json());
    expect(bySupplier.bills.some((bill) => bill.id === draftBill.id)).toBe(true);

    const byBillNumberRes = await app.inject({
      method: 'GET',
      url: `/supplier-bills?billNumber=${finalisedBill.billNumber}`,
    });
    expect(byBillNumberRes.statusCode).toBe(200);
    const byBillNumber = z.object({ bills: z.array(supplierBillSchema) }).parse(byBillNumberRes.json());
    expect(byBillNumber.bills.map((bill) => bill.id)).toContain(draftBill.id);

    const byStatusRes = await app.inject({
      method: 'GET',
      url: '/supplier-bills?status=Finalised',
    });
    expect(byStatusRes.statusCode).toBe(200);
    const byStatus = z.object({ bills: z.array(supplierBillSchema) }).parse(byStatusRes.json());
    expect(byStatus.bills.some((bill) => bill.id === draftBill.id)).toBe(true);

    const byDueDateRes = await app.inject({
      method: 'GET',
      url: '/supplier-bills?fromDueDate=2026-07-20&toDueDate=2026-07-22',
    });
    expect(byDueDateRes.statusCode).toBe(200);
    const byDueDate = z.object({ bills: z.array(supplierBillSchema) }).parse(byDueDateRes.json());
    expect(byDueDate.bills.some((bill) => bill.id === draftBill.id)).toBe(true);

    const htmlRes = await app.inject({
      method: 'GET',
      url: `/supplier-bills/${draftBill.id}/html`,
    });
    expect(htmlRes.statusCode).toBe(200);
    expect(htmlRes.headers['content-type']).toContain('text/html');
    expect(htmlRes.body).toContain('Supplier Bill');

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/supplier-bills/${draftBill.id}/pdf`,
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.body.length).toBeGreaterThan(1000);

    const timelineRes = await app.inject({
      method: 'GET',
      url: `/timeline/supplier_bill/${draftBill.id}`,
    });
    expect(timelineRes.statusCode).toBe(200);
    const timeline = z.object({ events: z.array(z.object({ eventKey: z.string() })) }).parse(timelineRes.json());
    expect(timeline.events.some((event) => event.eventKey === 'supplier_bill.created')).toBe(true);
    expect(timeline.events.some((event) => event.eventKey === 'supplier_bill.finalised')).toBe(true);

    const searchRes = await app.inject({
      method: 'GET',
      url: `/search?q=${finalisedBill.billNumber}`,
    });
    expect(searchRes.statusCode).toBe(200);
    const searchPayload = z
      .object({
        documents: z.array(z.object({ entityId: z.string() })),
      })
      .passthrough()
      .parse(searchRes.json());
    expect(searchPayload.documents.some((doc) => doc.entityId === draftBill.id)).toBe(true);

    await app.close();
  });
});
