/**
 * Guards for drawer / form interactions.
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

/** Global app shortcuts must not steal clipboard / text-editing keys from fields. */
export function shouldIgnoreGlobalShortcut(event) {
  if (!event) return false;
  return isEditableTarget(event.target);
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
 * not discard the form.
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
