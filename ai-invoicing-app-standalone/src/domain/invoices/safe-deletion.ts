/**
 * Invoice deletion policy:
 *
 * Permanent delete is allowed only for Draft invoices that are not linked from a
 * converted quote. Finalised / issued invoices are accounting records and must
 * remain immutable (schema triggers also block DELETE). Use Cancel / void flows
 * for issued documents instead of deletion.
 */

export function assertInvoiceDraftDeletableOrThrow(status: string | null | undefined): void {
  if (status !== 'Draft') {
    throw new Error('Only draft invoices can be deleted');
  }
}

export function assertInvoiceNotReferencedByQuoteOrThrow(quoteLinkCount: number): void {
  if (quoteLinkCount > 0) {
    throw new Error('INVOICE_REFERENCED_BY_QUOTE');
  }
}
