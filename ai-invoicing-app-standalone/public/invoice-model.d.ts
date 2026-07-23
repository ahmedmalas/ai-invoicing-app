export const INVOICE_MODEL_VERSION: number;
export const GST_RATE: number;
export const DEFAULT_CURRENCY: string;

export type InvoiceStatus = 'Draft' | 'Finalised';

export interface InvoiceLineItemState {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  gstApplicable: boolean;
  productId?: string | null;
}

export interface InvoiceEditorState {
  id: string | null;
  status: InvoiceStatus;
  paymentState: string;
  invoiceNumber: string | null;
  title: string;
  customerId: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  lineItems: InvoiceLineItemState[];
  notes: string;
  paymentTerms: string;
  tax: { gstRate: number };
  totals: { subtotal: number; gstTotal: number; total: number };
  version: number;
  updatedAt: string | null;
  createdAt: string | null;
}

export interface InvoiceCanonicalPayload {
  customerId: string;
  title: string;
  issueDate: string;
  dueDate: string;
  invoiceNumber: string | null;
  notes?: string;
  paymentTerms?: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    gstApplicable: boolean;
    productId?: string | null;
  }>;
}

export function normalizeLegacyInvoiceRecord(record: unknown): Record<string, unknown>;
export function createEmptyEditorState(seed?: object): InvoiceEditorState;
export function hydrateEditorState(record: unknown): InvoiceEditorState;
export function withRecalculatedTotals(state: InvoiceEditorState): InvoiceEditorState;
export function patchEditorState(
  state: InvoiceEditorState,
  patch: Partial<InvoiceEditorState>,
): InvoiceEditorState;
export function buildInvoicePayload(editorState: InvoiceEditorState): InvoiceCanonicalPayload;
export function toCreateDraftBody(payload: InvoiceCanonicalPayload): object;
export function toUpdateDraftBody(payload: InvoiceCanonicalPayload, paymentState?: string): object;
export function validateInvoiceForSave(
  input: InvoiceEditorState | InvoiceCanonicalPayload,
):
  | { ok: true; payload: InvoiceCanonicalPayload }
  | { ok: false; message: string; fieldPath: string };
export function payloadReadyForAutosave(payload: InvoiceCanonicalPayload): boolean;
export function snapshotRecoverable(snapshot: unknown): boolean;
export function applySavedInvoice(
  state: InvoiceEditorState,
  saved: unknown,
): InvoiceEditorState;
