export declare const INVOICE_EDITOR_STORAGE_KEY: string;
export declare const INVOICE_EDITOR_AUTOSAVE_MS: number;

export declare function createInvoiceEditor(deps: {
  api: (path: string, options?: object) => Promise<unknown>;
  getAccessToken: () => string | null | undefined;
  getProfile: () => unknown;
  getCustomers: () => unknown[];
  toast: (message: string, error?: boolean) => void;
  invalidateCache: () => void;
  isProfileReady: (profile: unknown) => boolean;
  downloadPdf: (id: string) => Promise<string>;
  previewPdf: (id: string) => Promise<void>;
  storage?: Storage;
}): {
  open: (record?: unknown) => Promise<{ redirected: string | null }>;
  close: (options?: { force?: boolean; animate?: boolean }) => Promise<boolean>;
  isOpen: () => boolean;
  isDirty: () => boolean;
  getForm: () => HTMLFormElement | null;
  buildPayload: () => unknown;
  handleAction: (action: string) => Promise<unknown>;
  handleSubmit: (submitterAction?: string | null) => Promise<unknown>;
  clearLocal: () => void;
  captureLocal: (recordId?: string | null) => unknown;
  focusField: (fieldPath: string) => void;
};

export declare function buildEditorHtml(input: unknown): string;
export declare function buildPayloadFromForm(form: unknown): unknown;
export declare function lineRowHtml(item?: unknown, index?: number): string;
export declare function snapshotRecoverable(snapshot: unknown): boolean;
export declare function readInvoiceEditorLocal(storage?: Storage): unknown;
export declare function clearInvoiceEditorLocal(storage?: Storage): void;
