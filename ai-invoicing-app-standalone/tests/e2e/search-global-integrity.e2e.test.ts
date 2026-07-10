import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

const searchResultSchema = z.object({
  customers: z.array(z.object({ id: z.string().uuid(), displayName: z.string() })),
  suppliers: z.array(z.object({ id: z.string().uuid(), displayName: z.string() })),
  invoices: z.array(
    z.object({
      id: z.string().uuid(),
      customerId: z.string().uuid(),
      invoiceNumber: z.string().nullable(),
      creditNoteIds: z.array(z.string().uuid()),
      customerPaymentIds: z.array(z.string().uuid()),
    }),
  ),
  creditNotes: z.array(
    z.object({
      id: z.string().uuid(),
      creditNoteNumber: z.string(),
      linkedInvoiceId: z.string().uuid(),
    }),
  ),
  customerPayments: z.array(
    z.object({
      id: z.string().uuid(),
      paymentNumber: z.string(),
      allocations: z.array(z.object({ invoiceId: z.string().uuid(), amount: z.number() })),
    }),
  ),
  purchaseOrders: z.array(
    z.object({
      id: z.string().uuid(),
      purchaseOrderNumber: z.string(),
      supplierBillIds: z.array(z.string().uuid()),
    }),
  ),
  supplierBills: z.array(
    z.object({
      id: z.string().uuid(),
      billNumber: z.string().nullable(),
      sourcePurchaseOrderId: z.string().uuid().nullable(),
    }),
  ),
  supplierPayments: z.array(
    z.object({
      id: z.string().uuid(),
      paymentNumber: z.string(),
      allocations: z.array(z.object({ supplierBillId: z.string().uuid(), amount: z.number() })),
    }),
  ),
  documents: z.array(z.object({ id: z.string().uuid(), entityId: z.string().uuid() })),
  jobs: z.array(z.object({ id: z.string().uuid() })),
});

function assertNoDuplicates(ids: string[]): void {
  expect(new Set(ids).size).toBe(ids.length);
}

describe('global search integrity and cross-document references', () => {
  it('keeps deterministic, complete, and linked search results across all document classes', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const customerRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Acme Search Customer', email: 'acme@search.test' },
    });
    expect(customerRes.statusCode).toBe(201);
    const customer = idSchema.parse(customerRes.json());

    const supplierRes = await app.inject({
      method: 'POST',
      url: '/suppliers',
      payload: { displayName: 'Beta Search Supplier', email: 'beta@supplier.test' },
    });
    expect(supplierRes.statusCode).toBe(201);
    const supplier = idSchema.parse(supplierRes.json());

    const invoiceDraftRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customer.id,
        title: 'Global Search Invoice',
        issueDate: '2026-07-07',
        dueDate: '2026-07-21',
        notes: 'search-invoice-token',
        lineItems: [{ description: 'Search line', quantity: 1, unitPrice: 250, gstApplicable: true }],
      },
    });
    expect(invoiceDraftRes.statusCode).toBe(201);
    const invoice = idSchema.parse(invoiceDraftRes.json());

    const finaliseInvoiceRes = await app.inject({
      method: 'POST',
      url: `/invoices/${invoice.id}/finalise`,
    });
    expect(finaliseInvoiceRes.statusCode).toBe(200);
    const finalisedInvoice = z.object({ invoiceNumber: z.string() }).parse(finaliseInvoiceRes.json());

    const creditNoteRes = await app.inject({
      method: 'POST',
      url: '/credit-notes',
      payload: {
        linkedInvoiceId: invoice.id,
        issueDate: '2026-07-08',
        reason: 'search-credit-token',
        type: 'Partial',
        lineItems: [{ description: 'Credit', amount: 20 }],
      },
    });
    expect(creditNoteRes.statusCode).toBe(201);
    const creditNote = z.object({ id: z.string().uuid(), creditNoteNumber: z.string() }).parse(creditNoteRes.json());

    const customerPaymentRes = await app.inject({
      method: 'POST',
      url: '/payments',
      payload: {
        customerId: customer.id,
        paymentDate: '2026-07-09',
        paymentMethod: 'Bank Transfer',
        reference: 'search-pay-token',
        amount: 100,
        allocations: [{ invoiceId: invoice.id, amount: 100 }],
      },
    });
    expect(customerPaymentRes.statusCode).toBe(201);
    const customerPayment = z.object({ id: z.string().uuid(), paymentNumber: z.string() }).parse(customerPaymentRes.json());

    const purchaseOrderRes = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      payload: {
        supplierId: supplier.id,
        issueDate: '2026-07-10',
        expectedDeliveryDate: '2026-07-22',
        supplierReference: 'search-po-token',
        currency: 'AUD',
        lineItems: [{ description: 'PO line', quantity: 2, unitPrice: 80, gstApplicable: true }],
      },
    });
    expect(purchaseOrderRes.statusCode).toBe(201);
    const purchaseOrder = z
      .object({ id: z.string().uuid(), purchaseOrderNumber: z.string() })
      .parse(purchaseOrderRes.json());

    const approvePoRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${purchaseOrder.id}/approve`,
    });
    expect(approvePoRes.statusCode).toBe(200);

    const supplierBillFromPoRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${purchaseOrder.id}/create-supplier-bill`,
      payload: {},
    });
    expect(supplierBillFromPoRes.statusCode).toBe(201);
    const supplierBillFromPo = z.object({ id: z.string().uuid() }).parse(supplierBillFromPoRes.json());

    const finaliseSupplierBillRes = await app.inject({
      method: 'POST',
      url: `/supplier-bills/${supplierBillFromPo.id}/finalise`,
    });
    expect(finaliseSupplierBillRes.statusCode).toBe(200);
    const finalisedSupplierBill = z.object({ billNumber: z.string() }).parse(finaliseSupplierBillRes.json());

    const supplierPaymentRes = await app.inject({
      method: 'POST',
      url: '/supplier-payments',
      payload: {
        supplierId: supplier.id,
        paymentDate: '2026-07-11',
        paymentMethod: 'Bank Transfer',
        reference: 'search-spay-token',
        amount: 50,
        allocations: [{ supplierBillId: supplierBillFromPo.id, amount: 50 }],
      },
    });
    expect(supplierPaymentRes.statusCode).toBe(201);
    const supplierPayment = z.object({ id: z.string().uuid(), paymentNumber: z.string() }).parse(supplierPaymentRes.json());

    const allSearchRes = await app.inject({
      method: 'GET',
      url: `/search?q=${encodeURIComponent('search')}&limit=100&offset=0`,
    });
    expect(allSearchRes.statusCode).toBe(200);
    const allSearch = searchResultSchema.parse(allSearchRes.json());

    expect(allSearch.customers.some((item) => item.id === customer.id)).toBe(true);
    expect(allSearch.suppliers.some((item) => item.id === supplier.id)).toBe(true);
    expect(allSearch.invoices.some((item) => item.id === invoice.id)).toBe(true);
    expect(allSearch.creditNotes.some((item) => item.id === creditNote.id)).toBe(true);
    expect(allSearch.customerPayments.some((item) => item.id === customerPayment.id)).toBe(true);
    expect(allSearch.purchaseOrders.some((item) => item.id === purchaseOrder.id)).toBe(true);
    expect(allSearch.supplierPayments.some((item) => item.id === supplierPayment.id)).toBe(true);

    const invoiceFromSearch = allSearch.invoices.find((item) => item.id === invoice.id);
    expect(invoiceFromSearch?.creditNoteIds).toContain(creditNote.id);
    expect(invoiceFromSearch?.customerPaymentIds).toContain(customerPayment.id);

    const poFromSearch = allSearch.purchaseOrders.find((item) => item.id === purchaseOrder.id);
    expect(poFromSearch?.supplierBillIds).toContain(supplierBillFromPo.id);

    const paymentFromSearch = allSearch.customerPayments.find((item) => item.id === customerPayment.id);
    expect(paymentFromSearch?.allocations.some((allocation) => allocation.invoiceId === invoice.id)).toBe(true);

    const supplierPaymentFromSearch = allSearch.supplierPayments.find((item) => item.id === supplierPayment.id);
    expect(
      supplierPaymentFromSearch?.allocations.some((allocation) => allocation.supplierBillId === supplierBillFromPo.id),
    ).toBe(true);

    const invoiceNumberSearchRes = await app.inject({
      method: 'GET',
      url: `/search?q=${encodeURIComponent(finalisedInvoice.invoiceNumber)}&entityTypes=invoices`,
    });
    expect(invoiceNumberSearchRes.statusCode).toBe(200);
    const invoiceNumberSearch = searchResultSchema.parse(invoiceNumberSearchRes.json());
    expect(invoiceNumberSearch.invoices.some((item) => item.id === invoice.id)).toBe(true);

    const creditNumberSearchRes = await app.inject({
      method: 'GET',
      url: `/search?q=${encodeURIComponent(creditNote.creditNoteNumber)}&entityTypes=creditNotes`,
    });
    expect(creditNumberSearchRes.statusCode).toBe(200);
    expect(searchResultSchema.parse(creditNumberSearchRes.json()).creditNotes.map((item) => item.id)).toContain(
      creditNote.id,
    );

    const paymentNumberSearchRes = await app.inject({
      method: 'GET',
      url: `/search?q=${encodeURIComponent(customerPayment.paymentNumber)}&entityTypes=customerPayments`,
    });
    expect(paymentNumberSearchRes.statusCode).toBe(200);
    expect(searchResultSchema.parse(paymentNumberSearchRes.json()).customerPayments.map((item) => item.id)).toContain(
      customerPayment.id,
    );

    const poNumberSearchRes = await app.inject({
      method: 'GET',
      url: `/search?q=${encodeURIComponent(purchaseOrder.purchaseOrderNumber)}&entityTypes=purchaseOrders`,
    });
    expect(poNumberSearchRes.statusCode).toBe(200);
    expect(searchResultSchema.parse(poNumberSearchRes.json()).purchaseOrders.map((item) => item.id)).toContain(
      purchaseOrder.id,
    );

    const billNumberSearchRes = await app.inject({
      method: 'GET',
      url: `/search?q=${encodeURIComponent(finalisedSupplierBill.billNumber)}&entityTypes=supplierBills`,
    });
    expect(billNumberSearchRes.statusCode).toBe(200);
    const billNumberSearch = searchResultSchema.parse(billNumberSearchRes.json()).supplierBills;
    expect(billNumberSearch.map((item) => item.id)).toContain(supplierBillFromPo.id);
    const supplierBillFromSearch = billNumberSearch.find((item) => item.id === supplierBillFromPo.id);
    expect(supplierBillFromSearch?.sourcePurchaseOrderId).toBe(purchaseOrder.id);

    const supplierPaymentNumberSearchRes = await app.inject({
      method: 'GET',
      url: `/search?q=${encodeURIComponent(supplierPayment.paymentNumber)}&entityTypes=supplierPayments`,
    });
    expect(supplierPaymentNumberSearchRes.statusCode).toBe(200);
    expect(searchResultSchema.parse(supplierPaymentNumberSearchRes.json()).supplierPayments.map((item) => item.id)).toContain(
      supplierPayment.id,
    );

    const customerCaseInsensitiveRes = await app.inject({
      method: 'GET',
      url: '/search?q=ACME%20SEARCH&entityTypes=customers',
    });
    expect(customerCaseInsensitiveRes.statusCode).toBe(200);
    expect(searchResultSchema.parse(customerCaseInsensitiveRes.json()).customers.map((item) => item.id)).toContain(
      customer.id,
    );

    const supplierPartialRes = await app.inject({
      method: 'GET',
      url: '/search?q=search%20supp&entityTypes=suppliers',
    });
    expect(supplierPartialRes.statusCode).toBe(200);
    expect(searchResultSchema.parse(supplierPartialRes.json()).suppliers.map((item) => item.id)).toContain(supplier.id);

    for (const ids of [
      allSearch.customers.map((item) => item.id),
      allSearch.suppliers.map((item) => item.id),
      allSearch.invoices.map((item) => item.id),
      allSearch.creditNotes.map((item) => item.id),
      allSearch.customerPayments.map((item) => item.id),
      allSearch.purchaseOrders.map((item) => item.id),
      allSearch.supplierBills.map((item) => item.id),
      allSearch.supplierPayments.map((item) => item.id),
      allSearch.documents.map((item) => item.id),
      allSearch.jobs.map((item) => item.id),
    ]) {
      assertNoDuplicates(ids);
    }

    const repeatOneRes = await app.inject({
      method: 'GET',
      url: '/search?q=search&entityTypes=invoices,creditNotes,customerPayments,purchaseOrders,supplierBills,supplierPayments',
    });
    const repeatTwoRes = await app.inject({
      method: 'GET',
      url: '/search?q=search&entityTypes=invoices,creditNotes,customerPayments,purchaseOrders,supplierBills,supplierPayments',
    });
    expect(repeatOneRes.statusCode).toBe(200);
    expect(repeatTwoRes.statusCode).toBe(200);
    expect(searchResultSchema.parse(repeatOneRes.json())).toEqual(searchResultSchema.parse(repeatTwoRes.json()));

    const pageOneRes = await app.inject({
      method: 'GET',
      url: '/search?q=search&entityTypes=invoices&limit=1&offset=0',
    });
    const pageTwoRes = await app.inject({
      method: 'GET',
      url: '/search?q=search&entityTypes=invoices&limit=1&offset=1',
    });
    const fullInvoicesRes = await app.inject({
      method: 'GET',
      url: '/search?q=search&entityTypes=invoices&limit=2&offset=0',
    });
    expect(pageOneRes.statusCode).toBe(200);
    expect(pageTwoRes.statusCode).toBe(200);
    expect(fullInvoicesRes.statusCode).toBe(200);
    const pageOne = searchResultSchema.parse(pageOneRes.json()).invoices;
    const pageTwo = searchResultSchema.parse(pageTwoRes.json()).invoices;
    const fullInvoices = searchResultSchema.parse(fullInvoicesRes.json()).invoices;
    expect([...pageOne, ...pageTwo].map((item) => item.id)).toEqual(fullInvoices.map((item) => item.id));

    const immutableUpdateRes = await app.inject({
      method: 'PUT',
      url: `/invoices/${invoice.id}`,
      payload: {
        title: 'Immutable rejected',
        issueDate: '2026-07-07',
        dueDate: '2026-07-21',
        paymentState: 'Sent',
        lineItems: [{ description: 'Nope', quantity: 1, unitPrice: 1, gstApplicable: false }],
      },
    });
    expect(immutableUpdateRes.statusCode).toBe(409);
    const immutableSearchRes = await app.inject({
      method: 'GET',
      url: `/search?q=${encodeURIComponent(finalisedInvoice.invoiceNumber)}&entityTypes=invoices`,
    });
    expect(immutableSearchRes.statusCode).toBe(200);
    expect(searchResultSchema.parse(immutableSearchRes.json()).invoices.map((item) => item.id)).toContain(invoice.id);

    const concurrentToken = 'concurrent-search-token';
    const concurrentCustomers = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/customers',
          payload: { displayName: `Concurrent Search ${concurrentToken} ${index}` },
        }),
      ),
    );
    for (const response of concurrentCustomers) {
      expect(response.statusCode).toBe(201);
    }
    const concurrentCustomerIds = concurrentCustomers.map((response) => idSchema.parse(response.json()).id);
    const concurrentSearchOneRes = await app.inject({
      method: 'GET',
      url: `/search?q=${encodeURIComponent(concurrentToken)}&entityTypes=customers&limit=100`,
    });
    const concurrentSearchTwoRes = await app.inject({
      method: 'GET',
      url: `/search?q=${encodeURIComponent(concurrentToken)}&entityTypes=customers&limit=100`,
    });
    expect(concurrentSearchOneRes.statusCode).toBe(200);
    expect(concurrentSearchTwoRes.statusCode).toBe(200);
    const concurrentSearchOne = searchResultSchema.parse(concurrentSearchOneRes.json()).customers;
    const concurrentSearchTwo = searchResultSchema.parse(concurrentSearchTwoRes.json()).customers;
    expect(concurrentSearchOne.map((item) => item.id)).toEqual(concurrentSearchTwo.map((item) => item.id));
    for (const concurrentCustomerId of concurrentCustomerIds) {
      expect(concurrentSearchOne.map((item) => item.id)).toContain(concurrentCustomerId);
    }

    await app.close();
  });
});
