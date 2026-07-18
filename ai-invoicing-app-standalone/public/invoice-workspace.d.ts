export function invoiceWorkspaceLineRow(item?: unknown, index?: number): string;
export function refreshInvoiceWorkspaceTotals(form: unknown): {
  calculatedItems: unknown[];
  totals: { subtotal: number; gstTotal: number; total: number };
};
export function reindexInvoiceLines(form: unknown): void;
export function moveInvoiceLine(form: unknown, row: unknown, direction: number): boolean;
export function buildInvoiceWorkspaceHtml(input: {
  profile?: Record<string, unknown>;
  customers?: Array<Record<string, unknown>>;
  record?: Record<string, unknown> | null;
  moneyFormat?: (value: number) => string;
}): string;
export function customerPreviewHtml(customer: unknown): string;
export function bindInvoiceWorkspaceInteractions(
  form: unknown,
  options?: { onToast?: (message: string, error?: boolean) => void },
): void;
export function calculateInvoiceTotals(items: unknown[]): {
  calculatedItems: unknown[];
  totals: { subtotal: number; gstTotal: number; total: number };
};
export function readLineItemsFromForm(form: unknown): unknown[];
export function formatMoney(value: number): string;
export function escapeHtml(value: unknown): string;
