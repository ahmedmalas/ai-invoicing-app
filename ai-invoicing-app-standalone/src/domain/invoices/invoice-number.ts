/**
 * Canonical invoice-number pathway (server).
 *
 * DB column: invoice_number
 * API / domain property: invoiceNumber
 * Allocation: finaliseInvoice only
 * PDF: reads invoice.invoiceNumber from the loaded invoice row
 */

export function normalizeInvoiceNumber(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatInvoiceNumberDisplay(invoiceNumber: unknown): string {
  return normalizeInvoiceNumber(invoiceNumber) ?? 'Draft';
}

/** Create payloads must not invent a number — allocation happens on finalise. */
export function assertCreateInvoiceNumber(value: unknown): void {
  if (value === undefined) return;
  if (normalizeInvoiceNumber(value) !== null) {
    throw new Error('INVOICE_NUMBER_NOT_ASSIGNABLE_ON_CREATE');
  }
}

/**
 * Update payloads may echo the existing number for preview/save parity checks,
 * but must never change or invent one.
 */
export function assertUpdateInvoiceNumber(
  submitted: unknown,
  persisted: string | null | undefined,
): void {
  if (submitted === undefined) return;
  const next = normalizeInvoiceNumber(submitted);
  const current = normalizeInvoiceNumber(persisted);
  if (next !== current) {
    throw new Error('INVOICE_NUMBER_IMMUTABLE');
  }
}
