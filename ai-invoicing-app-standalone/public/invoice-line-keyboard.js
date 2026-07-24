/**
 * Spreadsheet-style keyboard navigation for invoice line items.
 * Shared helpers for the canonical Aleya invoice editor (and Aboss-compatible adapters).
 */

export const LINE_FIELD_ORDER = ['description', 'quantity', 'unitPrice', 'gstApplicable'];

export function createLineClientKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Ensure every line has a stable clientKey for focus targeting (not sent in API payloads). */
export function ensureLineClientKeys(lineItems = []) {
  return (lineItems || []).map((item) => {
    const next = { ...item };
    if (!next.clientKey) {
      next.clientKey = next.id ? `persisted-${next.id}` : createLineClientKey();
    }
    return next;
  });
}

/**
 * Parse a numeric line field without inventing zero from incomplete/blank drafts
 * when a previous numeric value already exists.
 */
export function parseLineNumericInput(raw, previous = 0) {
  if (raw == null) return Number.isFinite(Number(previous)) ? Number(previous) : 0;
  const text = String(raw).trim();
  if (text === '') {
    return Number.isFinite(Number(previous)) ? Number(previous) : 0;
  }
  // Allow trailing decimal while typing ("350." → 350)
  const normalized = text.replace(/,/g, '');
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return Number.isFinite(Number(previous)) ? Number(previous) : 0;
  }
  return value;
}

export function blankLineItem() {
  return {
    clientKey: createLineClientKey(),
    description: '',
    quantity: 1,
    unitPrice: 0,
    gstApplicable: true,
  };
}

/**
 * Decide where Enter should move focus for a line-item field.
 * @returns {{ action: 'focus' | 'add-row', field: string, lineIndex: number }}
 */
export function resolveEnterNavigation({ field, lineIndex, lineCount }) {
  const index = Math.max(0, Number(lineIndex) || 0);
  const count = Math.max(1, Number(lineCount) || 1);
  const targetField = LINE_FIELD_ORDER.includes(field) ? field : 'unitPrice';
  if (index >= count - 1) {
    return { action: 'add-row', field: targetField === 'gstApplicable' ? 'description' : targetField, lineIndex: count };
  }
  return { action: 'focus', field: targetField, lineIndex: index + 1 };
}

/**
 * Decide where Tab / Shift+Tab should move within and across rows.
 * @returns {{ action: 'focus' | 'add-row' | 'native', field?: string, lineIndex?: number }}
 */
export function resolveTabNavigation({ field, lineIndex, lineCount, shiftKey }) {
  const index = Math.max(0, Number(lineIndex) || 0);
  const count = Math.max(1, Number(lineCount) || 1);
  const orderIndex = LINE_FIELD_ORDER.indexOf(field);
  if (orderIndex < 0) return { action: 'native' };

  if (!shiftKey) {
    if (orderIndex < LINE_FIELD_ORDER.length - 1) {
      return { action: 'focus', field: LINE_FIELD_ORDER[orderIndex + 1], lineIndex: index };
    }
    // Final editable field in the row → first field of next row (create if needed).
    if (index >= count - 1) {
      return { action: 'add-row', field: 'description', lineIndex: count };
    }
    return { action: 'focus', field: 'description', lineIndex: index + 1 };
  }

  // Shift+Tab
  if (orderIndex > 0) {
    return { action: 'focus', field: LINE_FIELD_ORDER[orderIndex - 1], lineIndex: index };
  }
  if (index <= 0) return { action: 'native' };
  return { action: 'focus', field: 'gstApplicable', lineIndex: index - 1 };
}

/** True when Enter should be handled as line navigation (not form submit / newline). */
export function shouldHandleLineEnter(target) {
  if (!target || !target.getAttribute) return false;
  if (target.tagName === 'TEXTAREA') return false;
  if (target.isContentEditable) return false;
  const field = target.getAttribute('data-invoice-field');
  return LINE_FIELD_ORDER.includes(field);
}

/** True when Tab should be handled as spreadsheet navigation inside line rows. */
export function shouldHandleLineTab(target) {
  if (!target || !target.getAttribute) return false;
  const field = target.getAttribute('data-invoice-field');
  return LINE_FIELD_ORDER.includes(field);
}
