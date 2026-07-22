/**
 * Canonical invoice-number pathway (client).
 *
 * One property name: invoiceNumber
 * One meaning: server-allocated document number, or null before issue.
 * Display formatting is presentation of that single value — not a second field.
 */

/** @param {unknown} value */
export function normalizeInvoiceNumber(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

/** Single display mapping for the canonical value. */
export function formatInvoiceNumberDisplay(invoiceNumber) {
  const normalized = normalizeInvoiceNumber(invoiceNumber);
  return normalized ?? 'Draft';
}

/**
 * Preview/save payload must carry the same canonical number the editor shows.
 * @param {{ invoiceNumber?: unknown }} payload
 * @param {unknown} visibleInvoiceNumber
 */
export function assertPayloadMatchesVisibleInvoiceNumber(payload, visibleInvoiceNumber) {
  const payloadNumber = normalizeInvoiceNumber(payload?.invoiceNumber);
  const visibleNumber = normalizeInvoiceNumber(visibleInvoiceNumber);
  if (payloadNumber !== visibleNumber) {
    const error = new Error(
      'Invoice number in the preview payload does not match the visible invoice number.',
    );
    error.code = 'INVOICE_NUMBER_MISMATCH';
    error.status = 400;
    throw error;
  }
  return payloadNumber;
}
