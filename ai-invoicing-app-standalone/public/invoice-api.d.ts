import type { InvoiceEditorState } from './invoice-model.js';

export declare function createInvoiceApiClient(deps: {
  api: (path: string, options?: object) => Promise<any>;
  previewPdf?: (id: string) => Promise<void>;
  downloadPdf?: (id: string) => Promise<string>;
}): {
  createDraft: (editorState: InvoiceEditorState) => Promise<any>;
  updateDraft: (editorState: InvoiceEditorState) => Promise<any>;
  saveDraft: (editorState: InvoiceEditorState) => Promise<any>;
  readInvoice: (invoiceId: string) => Promise<any>;
  deleteDraft: (invoiceId: string) => Promise<void>;
  finaliseInvoice: (invoiceId: string) => Promise<any>;
  previewPdf: (invoiceId: string) => Promise<void>;
  downloadPdf: (invoiceId: string) => Promise<string>;
  ensurePersistedForPdf: (
    editorState: InvoiceEditorState,
    options: { isDirty: boolean; persist: () => Promise<any> },
  ) => Promise<any>;
};
