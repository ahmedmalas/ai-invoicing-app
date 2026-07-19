import { describe, expect, it } from 'vitest';

import {
  assertCustomerCanBeDeletedOrThrow,
  resolveCustomerDeleteBlock,
} from '../../src/domain/customers/safe-deletion.js';
import {
  assertInvoiceDraftDeletableOrThrow,
  assertInvoiceNotReferencedByQuoteOrThrow,
} from '../../src/domain/invoices/safe-deletion.js';

describe('customer/invoice safe deletion domain rules', () => {
  it('allows orphan customers and blocks FK dependents in schema order', () => {
    expect(
      resolveCustomerDeleteBlock({
        invoices: 0,
        quotes: 0,
        customer_payments: 0,
        credit_notes: 0,
        jobs: 0,
      }),
    ).toBeNull();
    expect(() =>
      assertCustomerCanBeDeletedOrThrow({
        invoices: 0,
        quotes: 0,
        customer_payments: 0,
        credit_notes: 0,
        jobs: 0,
      }),
    ).not.toThrow();

    expect(
      resolveCustomerDeleteBlock({
        invoices: 1,
        quotes: 2,
        customer_payments: 0,
        credit_notes: 0,
        jobs: 0,
      }),
    ).toBe('CUSTOMER_HAS_INVOICES');
    expect(
      resolveCustomerDeleteBlock({
        invoices: 0,
        quotes: 1,
        customer_payments: 0,
        credit_notes: 0,
        jobs: 0,
      }),
    ).toBe('CUSTOMER_HAS_QUOTES');
  });

  it('allows draft invoice deletes and blocks finalised or quote-linked drafts', () => {
    expect(() => assertInvoiceDraftDeletableOrThrow('Draft')).not.toThrow();
    expect(() => assertInvoiceDraftDeletableOrThrow('Finalised')).toThrow(
      'Only draft invoices can be deleted',
    );
    expect(() => assertInvoiceNotReferencedByQuoteOrThrow(0)).not.toThrow();
    expect(() => assertInvoiceNotReferencedByQuoteOrThrow(1)).toThrow('INVOICE_REFERENCED_BY_QUOTE');
  });
});
