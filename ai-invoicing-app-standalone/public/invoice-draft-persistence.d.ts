export type InvoiceDraftLineItemSnapshot = {
  description?: string;
  quantity?: string | number;
  unitPrice?: string | number;
  gstApplicable?: string | boolean;
};

export type InvoiceDraftSnapshot = {
  version: number;
  savedAt: string;
  recordId: string | null;
  pathname: string;
  customerId: string;
  title: string;
  issueDate: string;
  dueDate: string;
  notes: string;
  paymentTerms: string;
  lineItems: InvoiceDraftLineItemSnapshot[];
};

export declare const INVOICE_DRAFT_STORAGE_KEY: "aleya-invoice-workspace-draft-v1";

export declare function readInvoiceDraftSnapshot(
  storage?: Storage | null,
): InvoiceDraftSnapshot | null;

export declare function clearInvoiceDraftSnapshot(storage?: Storage | null): void;

// Forms are DOM elements at runtime; tests may pass lightweight stubs.
// Keep typings intentionally loose to avoid fighting HTMLFormElement vs mocks.
export declare function buildInvoiceDraftSnapshot(
  form: unknown,
  options?: { recordId?: string | null },
): InvoiceDraftSnapshot | null;

export declare function writeInvoiceDraftSnapshot(
  form: unknown,
  options?: { recordId?: string | null },
  storage?: Storage | null,
): InvoiceDraftSnapshot | null;

export declare function snapshotLooksRecoverable(
  snapshot: InvoiceDraftSnapshot | null | undefined,
): boolean;

export declare function applyInvoiceDraftSnapshot(
  form: unknown,
  snapshot: InvoiceDraftSnapshot | null | undefined,
): boolean;
