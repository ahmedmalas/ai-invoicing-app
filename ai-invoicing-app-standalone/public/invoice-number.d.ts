export function normalizeInvoiceNumber(value: unknown): string | null;
export function formatInvoiceNumberDisplay(invoiceNumber: unknown): string;
export function assertPayloadMatchesVisibleInvoiceNumber(
  payload: { invoiceNumber?: unknown },
  visibleInvoiceNumber: unknown,
): string | null;
