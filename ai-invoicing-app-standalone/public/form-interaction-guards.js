/**
 * Guards for invoice drawer / form interactions.
 * Prevents accidental dismissal while selecting or editing text.
 */

export function resolveElement(target) {
  if (!target) return null;
  if (target.nodeType === 1) return target;
  return target.parentElement || null;
}

export function isEditableTarget(target) {
  const element = resolveElement(target);
  if (!element?.closest) return false;
  return Boolean(
    element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'),
  );
}

export function isInvoiceLineDragHandle(target) {
  const element = resolveElement(target);
  if (!element?.closest) return false;
  return Boolean(element.closest('[data-line-drag], .invoice-line-handle'));
}

/**
 * Row reorder may only begin from the dedicated handle — never from description/title
 * inputs (HTML5 drag on a parent steals mouse selection).
 */
export function shouldAllowInvoiceLineDragStart(event) {
  if (!event) return false;
  if (isEditableTarget(event.target)) return false;
  return isInvoiceLineDragHandle(event.target);
}

/** Global app shortcuts must not steal clipboard / text-editing keys from fields. */
export function shouldIgnoreGlobalShortcut(event) {
  if (!event) return false;
  return isEditableTarget(event.target);
}

/** Capture caret/selection so totals/autosave refreshes do not wipe editing state. */
export function captureEditableSelection(element) {
  if (!element || typeof element.selectionStart !== 'number') return null;
  return {
    element,
    selectionStart: element.selectionStart,
    selectionEnd: element.selectionEnd,
    selectionDirection: element.selectionDirection || 'none',
  };
}

export function restoreEditableSelection(snapshot) {
  if (!snapshot?.element || !snapshot.element.isConnected) return false;
  if (typeof snapshot.element.setSelectionRange !== 'function') return false;
  try {
    snapshot.element.focus({ preventScroll: true });
    snapshot.element.setSelectionRange(
      snapshot.selectionStart,
      snapshot.selectionEnd,
      snapshot.selectionDirection,
    );
    return true;
  } catch {
    return false;
  }
}

export function hasActiveTextSelection(
  selection = typeof window !== 'undefined' ? window.getSelection() : null,
) {
  if (!selection) return false;
  return String(selection).length > 0 && !selection.isCollapsed;
}

/**
 * Backdrop dismiss must only happen for a real backdrop click gesture.
 * Drag-selecting description text often ends with mouseup on the dimmed overlay;
 * browsers then dispatch click on the common ancestor (the backdrop), which must
 * not discard the invoice form.
 */
export function shouldCloseDrawerOnBackdropClick({
  clickTarget,
  pointerDownTarget,
  hasTextSelection = false,
} = {}) {
  const clickElement = resolveElement(clickTarget);
  if (!clickElement?.matches?.('[data-drawer-backdrop]')) return false;
  if (hasTextSelection) return false;
  const downElement = resolveElement(pointerDownTarget);
  if (!downElement?.matches?.('[data-drawer-backdrop]')) return false;
  return true;
}

export function serializeFormState(form) {
  if (!form) return '';
  const data = new FormData(form);
  return [...data.entries()]
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : value.name || ''}`)
    .join('\n');
}

export function isDrawerFormDirty(form) {
  if (!form?.dataset) return false;
  const initial = form.dataset.initialSnapshot;
  if (typeof initial !== 'string') return false;
  return serializeFormState(form) !== initial;
}

export function markDrawerFormPristine(form) {
  if (!form?.dataset) return;
  form.dataset.initialSnapshot = serializeFormState(form);
}
