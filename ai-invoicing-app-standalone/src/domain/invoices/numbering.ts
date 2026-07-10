export function formatInvoiceNumber(
  prefix: string,
  year: number,
  sequence: number,
): string {
  const padded = sequence.toString().padStart(6, '0');
  return `${prefix}-${year}-${padded}`;
}
