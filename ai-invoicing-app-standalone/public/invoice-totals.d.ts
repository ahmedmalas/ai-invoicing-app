export function roundCurrency(value: number): number;
export function calculateLineItem(item: {
  description?: string;
  quantity?: number | string;
  unitPrice?: number | string;
  gstApplicable?: boolean | string;
}): {
  description: string;
  quantity: number;
  unitPrice: number;
  gstApplicable: boolean;
  lineSubtotal: number;
  lineGst: number;
  lineTotal: number;
};
export function calculateInvoiceTotals(items: unknown[]): {
  calculatedItems: ReturnType<typeof calculateLineItem>[];
  totals: { subtotal: number; gstTotal: number; total: number };
};
export function readLineItemsFromForm(form: unknown): Array<{
  description: string;
  quantity: number;
  unitPrice: number;
  gstApplicable: boolean;
}>;
