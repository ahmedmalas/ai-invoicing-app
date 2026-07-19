/**
 * Customer deletion rules derived from postgres-schema.sql / schema.sql
 * foreign keys that reference customers(id).
 *
 * Source-of-truth FK dependents:
 * - invoices.customer_id
 * - quotes.customer_id
 * - customer_payments.customer_id
 * - credit_notes.customer_id
 * - jobs.customer_id
 *
 * Customers with any of these dependents must not be deleted so accounting,
 * payments, audit history, and operational records stay intact.
 */

export const CUSTOMER_DELETE_DEPENDENCIES = [
  { table: 'invoices', code: 'CUSTOMER_HAS_INVOICES' },
  { table: 'quotes', code: 'CUSTOMER_HAS_QUOTES' },
  { table: 'customer_payments', code: 'CUSTOMER_HAS_PAYMENTS' },
  { table: 'credit_notes', code: 'CUSTOMER_HAS_CREDIT_NOTES' },
  { table: 'jobs', code: 'CUSTOMER_HAS_JOBS' },
] as const;

export type CustomerDeleteBlockCode = (typeof CUSTOMER_DELETE_DEPENDENCIES)[number]['code'];

export function resolveCustomerDeleteBlock(
  dependencyCounts: Readonly<Record<string, number>>,
): CustomerDeleteBlockCode | null {
  for (const dependency of CUSTOMER_DELETE_DEPENDENCIES) {
    const count = Number(dependencyCounts[dependency.table] ?? 0);
    if (Number.isFinite(count) && count > 0) {
      return dependency.code;
    }
  }
  return null;
}

export function assertCustomerCanBeDeletedOrThrow(
  dependencyCounts: Readonly<Record<string, number>>,
): void {
  const block = resolveCustomerDeleteBlock(dependencyCounts);
  if (block) {
    throw new Error(block);
  }
}
