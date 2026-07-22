export function resolveElement(target: unknown): unknown;
export function isEditableTarget(target: unknown): boolean;
export function isInvoiceLineDragHandle(target: unknown): boolean;
export function shouldAllowInvoiceLineDragStart(event: unknown): boolean;
export function shouldIgnoreGlobalShortcut(event: unknown): boolean;
export function hasActiveTextSelection(selection?: unknown): boolean;
export function captureEditableSelection(element: unknown): {
  element: unknown;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: string;
} | null;
export function restoreEditableSelection(snapshot: unknown): boolean;
export function shouldCloseDrawerOnBackdropClick(options?: {
  clickTarget?: unknown;
  pointerDownTarget?: unknown;
  hasTextSelection?: boolean;
}): boolean;
export function serializeFormState(form: unknown): string;
export function isDrawerFormDirty(form: unknown): boolean;
export function markDrawerFormPristine(form: unknown): void;
