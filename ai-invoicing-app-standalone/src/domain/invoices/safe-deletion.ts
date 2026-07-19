/**
 * Invoice deletion rules derived from postgres-schema.sql / schema.sql.
 *
 * Only Draft invoices may be deleted. Finalised invoices are accounting records
 * and must be preserved (payments, credit notes, snapshots, immutability triggers).
 *
 * FK dependents that must be cleared or blocked before deleting a draft:
 * - invoice_line_items.invoice_id (delete)
 * - documents.id / job_document_links.document_id (delete)
 * - reminder_states.invoice_id (delete)
 * - quotes.converted_invoice_id (block — conversion history must be preserved)
 * - invoice_snapshots / credit_notes / payment_allocations (finalised-only; blocked by status)
 */

export const INVOICE_DRAFT_DELETE_CHILD_TABLES = [
  'job_document_links',
  'invoice_line_items',
  'reminder_states',
  'documents',
] as const;

export function assertInvoiceDraftDeletableOrThrow(status: string): void {
  if (status !== 'Draft') {
    throw new Error('Only draft invoices can be deleted');
  }
}

export function assertInvoiceNotReferencedByQuoteOrThrow(quoteCount: number): void {
  if (Number(quoteCount) > 0) {
    throw new Error('INVOICE_REFERENCED_BY_QUOTE');
  }
}
