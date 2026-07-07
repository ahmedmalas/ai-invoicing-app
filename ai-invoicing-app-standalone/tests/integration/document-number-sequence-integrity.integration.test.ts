import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function extractSequence(documentNumber: string): number {
  const sequencePart = documentNumber.split('-').at(-1);
  if (!sequencePart) {
    throw new Error(`Invalid document number: ${documentNumber}`);
  }
  return Number(sequencePart);
}

function assertDeterministicSequence(documentNumbers: string[], expectedPrefix: string): void {
  expect(documentNumbers.length).toBeGreaterThan(1);
  expect(new Set(documentNumbers).size).toBe(documentNumbers.length);
  for (const number of documentNumbers) {
    expect(number).toMatch(new RegExp(`^${expectedPrefix}-\\d{4}-\\d{6}$`));
  }
  const sorted = documentNumbers.map(extractSequence).sort((a, b) => a - b);
  expect(sorted).toEqual(Array.from({ length: documentNumbers.length }, (_, index) => index + 1));
}

function getStringField(response: { json(): unknown }, fieldName: string): string {
  const payload = response.json() as Record<string, unknown>;
  const value = payload[fieldName];
  if (typeof value !== 'string') {
    throw new Error(`Expected string field ${fieldName}`);
  }
  return value;
}

describe('document number sequence integrity', () => {
  it('keeps numbers unique, deterministic, and immutable across all document types', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-business-os-numbering-'));
    createdDirs.push(tempDir);
    const dbPath = join(tempDir, 'numbering.sqlite');
    const app = await buildApp({ dbPath });

    const customerRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Sequence Customer' },
    });
    expect(customerRes.statusCode).toBe(201);
    const customerId = getStringField(customerRes, 'id');

    const supplierRes = await app.inject({
      method: 'POST',
      url: '/suppliers',
      payload: { displayName: 'Sequence Supplier' },
    });
    expect(supplierRes.statusCode).toBe(201);
    const supplierId = getStringField(supplierRes, 'id');

    const invoiceDraftPayload = (index: number) => ({
      customerId,
      title: `Invoice ${index}`,
      issueDate: '2026-07-07',
      dueDate: '2026-07-21',
      lineItems: [{ description: `Service ${index}`, quantity: 1, unitPrice: 100 + index, gstApplicable: true }],
    });
    const invoiceDraftResponses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/invoices',
          payload: invoiceDraftPayload(index + 1),
        }),
      ),
    );
    for (const response of invoiceDraftResponses) {
      expect(response.statusCode).toBe(201);
    }
    const invoiceIds = invoiceDraftResponses.map((response) => getStringField(response, 'id'));

    const invoiceFinaliseResponses = await Promise.all(
      invoiceIds.map((invoiceId) => app.inject({ method: 'POST', url: `/invoices/${invoiceId}/finalise` })),
    );
    for (const response of invoiceFinaliseResponses) {
      expect(response.statusCode).toBe(200);
    }
    const invoiceNumbers = invoiceFinaliseResponses.map((response) => getStringField(response, 'invoiceNumber'));
    assertDeterministicSequence(invoiceNumbers, 'INV');

    const creditNoteResponses = await Promise.all(
      invoiceIds.slice(0, 4).map((invoiceId, index) =>
        app.inject({
          method: 'POST',
          url: '/credit-notes',
          payload: {
            linkedInvoiceId: invoiceId,
            issueDate: '2026-07-08',
            reason: `Credit ${index + 1}`,
            type: 'Partial',
            lineItems: [{ description: 'Adjustment', amount: 10 }],
          },
        }),
      ),
    );
    for (const response of creditNoteResponses) {
      expect(response.statusCode).toBe(201);
    }
    const creditNoteNumbers = creditNoteResponses.map((response) => getStringField(response, 'creditNoteNumber'));
    assertDeterministicSequence(creditNoteNumbers, 'CRN');

    const customerPaymentResponses = await Promise.all(
      invoiceIds.slice(4, 8).map((invoiceId, index) =>
        app.inject({
          method: 'POST',
          url: '/payments',
          payload: {
            customerId,
            paymentDate: '2026-07-09',
            paymentMethod: 'Bank Transfer',
            reference: `PAY-REF-${index + 1}`,
            amount: 50,
            allocations: [{ invoiceId, amount: 50 }],
          },
        }),
      ),
    );
    for (const response of customerPaymentResponses) {
      expect(response.statusCode).toBe(201);
    }
    const customerPaymentNumbers = customerPaymentResponses.map((response) => getStringField(response, 'paymentNumber'));
    assertDeterministicSequence(customerPaymentNumbers, 'PAY');

    const purchaseOrderResponses = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/purchase-orders',
          payload: {
            supplierId,
            issueDate: '2026-07-10',
            expectedDeliveryDate: '2026-07-20',
            supplierReference: `PO-REF-${index + 1}`,
            currency: 'AUD',
            lineItems: [{ description: `Materials ${index + 1}`, quantity: 2, unitPrice: 40, gstApplicable: true }],
          },
        }),
      ),
    );
    for (const response of purchaseOrderResponses) {
      expect(response.statusCode).toBe(201);
    }
    const purchaseOrderIds = purchaseOrderResponses.map((response) => getStringField(response, 'id'));
    const purchaseOrderNumbers = purchaseOrderResponses.map((response) =>
      getStringField(response, 'purchaseOrderNumber'),
    );
    assertDeterministicSequence(purchaseOrderNumbers, 'PO');

    const supplierBillDraftResponses = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/supplier-bills',
          payload: {
            supplierId,
            billDate: '2026-07-11',
            dueDate: '2026-07-25',
            supplierReference: `BILL-REF-${index + 1}`,
            currency: 'AUD',
            notes: `Draft bill ${index + 1}`,
            lineItems: [{ description: `Supply ${index + 1}`, quantity: 1, unitPrice: 120, gstApplicable: true }],
          },
        }),
      ),
    );
    for (const response of supplierBillDraftResponses) {
      expect(response.statusCode).toBe(201);
    }
    const supplierBillIds = supplierBillDraftResponses.map((response) => getStringField(response, 'id'));

    const supplierBillFinaliseResponses = await Promise.all(
      supplierBillIds.map((billId) => app.inject({ method: 'POST', url: `/supplier-bills/${billId}/finalise` })),
    );
    for (const response of supplierBillFinaliseResponses) {
      expect(response.statusCode).toBe(200);
    }
    const supplierBillNumbers = supplierBillFinaliseResponses.map((response) => getStringField(response, 'billNumber'));
    assertDeterministicSequence(supplierBillNumbers, 'BILL');

    const supplierPaymentResponses = await Promise.all(
      supplierBillIds.map((supplierBillId, index) =>
        app.inject({
          method: 'POST',
          url: '/supplier-payments',
          payload: {
            supplierId,
            paymentDate: '2026-07-12',
            paymentMethod: 'Bank Transfer',
            reference: `SPAY-REF-${index + 1}`,
            amount: 50,
            allocations: [{ supplierBillId, amount: 50 }],
          },
        }),
      ),
    );
    for (const response of supplierPaymentResponses) {
      expect(response.statusCode).toBe(201);
    }
    const supplierPaymentIds = supplierPaymentResponses.map((response) => getStringField(response, 'id'));
    const supplierPaymentNumbers = supplierPaymentResponses.map((response) =>
      getStringField(response, 'paymentNumber'),
    );
    assertDeterministicSequence(supplierPaymentNumbers, 'SPAY');

    const firstCreditNote = creditNoteResponses.at(0);
    const firstCustomerPayment = customerPaymentResponses.at(0);
    const purchaseOrderId = purchaseOrderIds.at(0);
    const supplierBillId = supplierBillIds.at(0);
    const supplierPaymentId = supplierPaymentIds.at(0);
    const invoiceId = invoiceIds.at(0);
    const invoiceNumber = invoiceNumbers.at(0);
    const creditNoteNumber = creditNoteNumbers.at(0);
    const customerPaymentNumber = customerPaymentNumbers.at(0);
    const purchaseOrderNumber = purchaseOrderNumbers.at(0);
    const supplierBillNumber = supplierBillNumbers.at(0);
    const supplierPaymentNumber = supplierPaymentNumbers.at(0);
    if (
      !firstCreditNote ||
      !firstCustomerPayment ||
      !purchaseOrderId ||
      !supplierBillId ||
      !supplierPaymentId ||
      !invoiceId ||
      !invoiceNumber ||
      !creditNoteNumber ||
      !customerPaymentNumber ||
      !purchaseOrderNumber ||
      !supplierBillNumber ||
      !supplierPaymentNumber
    ) {
      throw new Error('Expected generated document ids and numbers');
    }
    const creditNoteId = getStringField(firstCreditNote, 'id');
    const customerPaymentId = getStringField(firstCustomerPayment, 'id');

    const invoicePdfRes = await app.inject({ method: 'GET', url: `/invoices/${invoiceId}/pdf` });
    expect(invoicePdfRes.statusCode).toBe(200);
    expect(invoicePdfRes.headers['content-type']).toContain('application/pdf');
    expect(invoicePdfRes.body.length).toBeGreaterThan(1000);

    const creditNoteHtmlRes = await app.inject({ method: 'GET', url: `/credit-notes/${creditNoteId}/html` });
    expect(creditNoteHtmlRes.statusCode).toBe(200);
    expect(creditNoteHtmlRes.body).toContain(creditNoteNumber);
    const creditNotePdfRes = await app.inject({ method: 'GET', url: `/credit-notes/${creditNoteId}/pdf` });
    expect(creditNotePdfRes.statusCode).toBe(200);
    expect(creditNotePdfRes.headers['content-type']).toContain('application/pdf');

    const customerPaymentHtmlRes = await app.inject({ method: 'GET', url: `/payments/${customerPaymentId}/html` });
    expect(customerPaymentHtmlRes.statusCode).toBe(200);
    expect(customerPaymentHtmlRes.body).toContain(customerPaymentNumber);
    const customerPaymentPdfRes = await app.inject({ method: 'GET', url: `/payments/${customerPaymentId}/pdf` });
    expect(customerPaymentPdfRes.statusCode).toBe(200);
    expect(customerPaymentPdfRes.headers['content-type']).toContain('application/pdf');

    const purchaseOrderHtmlRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${purchaseOrderId}/html`,
    });
    expect(purchaseOrderHtmlRes.statusCode).toBe(200);
    expect(purchaseOrderHtmlRes.body).toContain(purchaseOrderNumber);
    const purchaseOrderPdfRes = await app.inject({ method: 'GET', url: `/purchase-orders/${purchaseOrderId}/pdf` });
    expect(purchaseOrderPdfRes.statusCode).toBe(200);
    expect(purchaseOrderPdfRes.headers['content-type']).toContain('application/pdf');

    const supplierBillHtmlRes = await app.inject({ method: 'GET', url: `/supplier-bills/${supplierBillId}/html` });
    expect(supplierBillHtmlRes.statusCode).toBe(200);
    expect(supplierBillHtmlRes.body).toContain(supplierBillNumber);
    const supplierBillPdfRes = await app.inject({ method: 'GET', url: `/supplier-bills/${supplierBillId}/pdf` });
    expect(supplierBillPdfRes.statusCode).toBe(200);
    expect(supplierBillPdfRes.headers['content-type']).toContain('application/pdf');

    const supplierPaymentHtmlRes = await app.inject({
      method: 'GET',
      url: `/supplier-payments/${supplierPaymentId}/html`,
    });
    expect(supplierPaymentHtmlRes.statusCode).toBe(200);
    expect(supplierPaymentHtmlRes.body).toContain(supplierPaymentNumber);
    const supplierPaymentPdfRes = await app.inject({
      method: 'GET',
      url: `/supplier-payments/${supplierPaymentId}/pdf`,
    });
    expect(supplierPaymentPdfRes.statusCode).toBe(200);
    expect(supplierPaymentPdfRes.headers['content-type']).toContain('application/pdf');

    const raw = new Database(dbPath);
    expect(() =>
      raw.prepare('UPDATE invoices SET invoice_number = ? WHERE id = ?').run('INV-2026-999999', invoiceId),
    ).toThrow(/IMMUTABLE_FINALISED_INVOICE/);
    expect(() =>
      raw
        .prepare('UPDATE credit_notes SET credit_note_number = ? WHERE id = ?')
        .run('CRN-2026-999999', creditNoteId),
    ).toThrow(/IMMUTABLE_CREDIT_NOTE_NUMBER/);
    expect(() =>
      raw
        .prepare('UPDATE customer_payments SET payment_number = ? WHERE id = ?')
        .run('PAY-2026-999999', customerPaymentId),
    ).toThrow(/IMMUTABLE_CUSTOMER_PAYMENT_NUMBER/);
    expect(() =>
      raw
        .prepare('UPDATE purchase_orders SET purchase_order_number = ? WHERE id = ?')
        .run('PO-2026-999999', purchaseOrderId),
    ).toThrow(/IMMUTABLE_PURCHASE_ORDER_NUMBER/);
    expect(() =>
      raw
        .prepare('UPDATE supplier_bills SET bill_number = ? WHERE id = ?')
        .run('BILL-2026-999999', supplierBillId),
    ).toThrow(/IMMUTABLE_FINALISED_SUPPLIER_BILL/);
    expect(() =>
      raw
        .prepare('UPDATE supplier_payments SET payment_number = ? WHERE id = ?')
        .run('SPAY-2026-999999', supplierPaymentId),
    ).toThrow(/IMMUTABLE_SUPPLIER_PAYMENT_NUMBER/);

    raw.prepare('UPDATE invoice_sequences SET next_sequence = 0 WHERE id = 1').run();
    const invalidStateDraftRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: invoiceDraftPayload(99),
    });
    expect(invalidStateDraftRes.statusCode).toBe(201);
    const invalidStateDraftId = getStringField(invalidStateDraftRes, 'id');
    const invalidStateFinaliseRes = await app.inject({
      method: 'POST',
      url: `/invoices/${invalidStateDraftId}/finalise`,
    });
    expect(invalidStateFinaliseRes.statusCode).toBe(409);
    expect(invalidStateFinaliseRes.json()).toMatchObject({
      message: 'DOCUMENT_NUMBER_SEQUENCE_INVALID_STATE',
    });

    raw.close();
    await app.close();

    expect(invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
  });
});
