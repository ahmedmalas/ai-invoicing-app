/**
 * Spreadsheet-style keyboard navigation + immediate paste commit helpers
 * for invoice line items (canonical Aleya editor / Aboss-compatible adapters).
 */

export const LINE_FIELD_ORDER = ['description', 'quantity', 'unitPrice', 'gstApplicable'];

/**
 * Presentation-only line number from the visible row order.
 * Never use this as a DB id, client key, React key, or API identifier.
 */
export function displayLineNumber(visibleRowIndex) {
  return Math.max(0, Number(visibleRowIndex) || 0) + 1;
}

/** Subtle singular/plural line-count label shown near the line table. */
export function formatLineItemCountLabel(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return n === 1 ? '1 line item' : `${n} line items`;
}

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
 * Normalize messy clipboard / autofill numeric text into a parseable decimal string.
 * Supports $, spaces, thousands separators, and EU-style decimals (350,00).
 */
export function normalizeNumericText(raw) {
  if (raw == null) return '';
  let text = String(raw)
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2000-\u200b\ufeff]/g, '')
    .trim();
  if (!text) return '';

  // Strip common currency markers / codes while keeping digits and separators.
  text = text
    .replace(/(?:AUD|USD|NZD|GBP|EUR)\s*/gi, '')
    .replace(/[$£€¥]/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (!text) return '';

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');

  if (hasComma && hasDot) {
    // Last separator is the decimal mark.
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = text.split(',');
    if (parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2) {
      // 350,00 / 350,5 → decimal
      text = `${parts[0]}.${parts[1]}`;
    } else {
      // 1,250 or 1,250,000 → thousands
      text = text.replace(/,/g, '');
    }
  }

  // Allow a trailing decimal while typing ("350.").
  if (text.endsWith('.')) text = text.slice(0, -1);
  return text;
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
  const normalized = normalizeNumericText(text);
  if (normalized === '') {
    return Number.isFinite(Number(previous)) ? Number(previous) : 0;
  }
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
 * Split clipboard text into a grid of cells (rows × columns).
 * Accepts tab-separated, comma-separated (when multi-column), or newline-separated values.
 */
export function parseSpreadsheetPaste(text) {
  const raw = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!raw.trim()) return [];
  const lines = raw.endsWith('\n') ? raw.slice(0, -1).split('\n') : raw.split('\n');
  return lines.map((line) => {
    if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim());
    // Only treat commas as column separators when there are multiple cells that are
    // not a single EU decimal like "350,00".
    if (line.includes(',') && !/^\s*[$£€]?\s*\d{1,3}(?:[ .]\d{3})*,\d{1,2}\s*$/.test(line)) {
      const parts = line.split(',').map((cell) => cell.trim());
      if (parts.length > 1 && parts.every((part) => part !== '')) return parts;
    }
    return [line.trim()];
  });
}

function parseGstCell(raw, previous = true) {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!text) return previous !== false;
  if (['false', '0', 'no', 'n', 'off', 'ex', 'exclusive'].includes(text)) return false;
  if (['true', '1', 'yes', 'y', 'on', 'gst', 'inc', 'inclusive'].includes(text)) return true;
  return previous !== false;
}

function applyCellToLine(line, field, cellValue) {
  const next = { ...line };
  if (field === 'description') {
    next.description = String(cellValue ?? '');
  } else if (field === 'quantity') {
    next.quantity = parseLineNumericInput(cellValue, next.quantity);
  } else if (field === 'unitPrice') {
    next.unitPrice = parseLineNumericInput(cellValue, next.unitPrice);
  } else if (field === 'gstApplicable') {
    next.gstApplicable = parseGstCell(cellValue, next.gstApplicable);
  }
  return next;
}

/**
 * Apply a spreadsheet paste into line items starting at a field/row.
 * Returns updated lines plus focus target metadata. Always commits numeric values immediately.
 */
export function applyLinePaste({
  lineItems = [],
  startIndex = 0,
  startField = 'unitPrice',
  pastedText = '',
} = {}) {
  const grid = parseSpreadsheetPaste(pastedText);
  const fieldIndex = LINE_FIELD_ORDER.indexOf(startField);
  if (fieldIndex < 0 || grid.length === 0) {
    return {
      handled: false,
      lineItems: ensureLineClientKeys(lineItems),
      focus: null,
      rowsTouched: [],
    };
  }

  const lines = ensureLineClientKeys(lineItems).map((item) => ({ ...item }));
  const rowsTouched = new Set();
  let lastFocus = { lineIndex: startIndex, field: startField };

  // Single plain description paste: let the browser handle caret/selection natively
  // unless the clipboard is multi-cell / multi-row.
  const isMulti =
    grid.length > 1 || (grid[0] && grid[0].length > 1) || /[\t\n]/.test(String(pastedText));
  if (startField === 'description' && !isMulti) {
    return {
      handled: false,
      lineItems: lines,
      focus: null,
      rowsTouched: [],
    };
  }

  for (let rowOffset = 0; rowOffset < grid.length; rowOffset += 1) {
    const rowCells = grid[rowOffset] || [];
    const lineIndex = startIndex + rowOffset;
    while (lines.length <= lineIndex) {
      lines.push(blankLineItem());
    }
    let current = { ...lines[lineIndex] };
    for (let colOffset = 0; colOffset < Math.max(1, rowCells.length); colOffset += 1) {
      const targetFieldIndex = fieldIndex + colOffset;
      if (targetFieldIndex >= LINE_FIELD_ORDER.length) break;
      const field = LINE_FIELD_ORDER[targetFieldIndex];
      const cellValue = rowCells[colOffset] ?? rowCells[0] ?? '';
      current = applyCellToLine(current, field, cellValue);
      lastFocus = { lineIndex, field };
      // Single-cell rows only fill the starting field.
      if (rowCells.length <= 1) break;
    }
    lines[lineIndex] = current;
    rowsTouched.add(lineIndex);
  }

  return {
    handled: true,
    lineItems: lines,
    focus: lastFocus,
    rowsTouched: [...rowsTouched],
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

/** True when paste should be intercepted for immediate canonical commit. */
export function shouldHandleLinePaste(target, pastedText = '') {
  if (!target || !target.getAttribute) return false;
  const field = target.getAttribute('data-invoice-field');
  if (!LINE_FIELD_ORDER.includes(field)) return false;
  const text = String(pastedText ?? '');
  if (!text) return false;
  if (field === 'quantity' || field === 'unitPrice') return true;
  if (field === 'gstApplicable') return /[\t\n]/.test(text) || text.trim().length > 0;
  // Description: only intercept multi-cell spreadsheet pastes.
  return /[\t\n]/.test(text);
}
