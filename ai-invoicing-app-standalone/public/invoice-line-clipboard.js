/**
 * Multi-row selection, copy, paste and duplication helpers for invoice lines.
 * Presentation-only selection; never treats display line numbers as IDs.
 */

import {
  blankLineItem,
  createLineClientKey,
  ensureLineClientKeys,
  normalizeNumericText,
  parseSpreadsheetPaste,
} from './invoice-line-keyboard.js';

function tryParseClipboardNumber(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { ok: false, empty: true, value: Number.NaN };
  const normalized = normalizeNumericText(text);
  if (!normalized) return { ok: false, empty: false, value: Number.NaN };
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false, empty: false, value: Number.NaN };
  return { ok: true, empty: false, value };
}

export const CLIPBOARD_TSV_HEADERS = ['Description', 'Qty', 'Unit Price', 'GST'];

/** Editable payload fields copied between rows (never IDs / display numbers / totals). */
export function serializeLineForClipboard(item = {}) {
  return {
    description: String(item.description ?? ''),
    quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 1,
    unitPrice: Number.isFinite(Number(item.unitPrice)) ? Number(item.unitPrice) : 0,
    gstApplicable: item.gstApplicable !== false && item.gstApplicable !== 'false',
  };
}

/** Independent copy with a fresh clientKey (and no persisted id). */
export function cloneLineItem(item = {}) {
  const payload = serializeLineForClipboard(item);
  return {
    ...payload,
    clientKey: createLineClientKey(),
  };
}

export function cloneLineItems(items = []) {
  return (items || []).map((item) => cloneLineItem(item));
}

export function formatSelectedCountLabel(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n <= 0) return '';
  return n === 1 ? '1 line selected' : `${n} lines selected`;
}

function formatGstForTsv(gstApplicable) {
  return gstApplicable !== false && gstApplicable !== 'false' ? '10%' : 'No GST';
}

export function parseGstClipboardValue(raw, previous = true) {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!text) return { ok: true, value: previous !== false };
  if (['false', '0', 'no', 'n', 'off', 'ex', 'exclusive', 'no gst', 'nogst'].includes(text)) {
    return { ok: true, value: false };
  }
  if (
    ['true', '1', 'yes', 'y', 'on', 'gst', 'inc', 'inclusive', '10%', '10', '0.1'].includes(text)
  ) {
    return { ok: true, value: true };
  }
  if (/^\d+(\.\d+)?%$/.test(text)) {
    const rate = Number(text.replace('%', ''));
    if (!Number.isFinite(rate)) return { ok: false, value: previous !== false, error: `Invalid GST "${raw}"` };
    return { ok: true, value: rate > 0 };
  }
  return { ok: false, value: previous !== false, error: `Unrecognised GST value "${raw}"` };
}

/** Excel / Sheets friendly TSV, including a header row. */
export function formatLinesAsTsv(items = []) {
  const rows = [
    CLIPBOARD_TSV_HEADERS.join('\t'),
    ...(items || []).map((item) => {
      const line = serializeLineForClipboard(item);
      return [
        line.description.replace(/\t/g, ' ').replace(/\r?\n/g, ' '),
        String(line.quantity),
        Number(line.unitPrice).toFixed(2),
        formatGstForTsv(line.gstApplicable),
      ].join('\t');
    }),
  ];
  return rows.join('\n');
}

function looksLikeHeaderRow(cells = []) {
  const joined = cells.map((cell) => String(cell || '').trim().toLowerCase()).join(' ');
  return /description/.test(joined) && /(qty|quantity)/.test(joined);
}

/**
 * Parse spreadsheet / internal multi-row paste into line items.
 * Invalid cells produce explicit error messages (never silently discarded).
 */
export function parseClipboardRows(text) {
  const grid = parseSpreadsheetPaste(text);
  const errors = [];
  const lines = [];
  if (!grid.length) {
    return { lines, errors: [{ row: 0, message: 'Clipboard did not contain any rows.' }] };
  }

  let start = 0;
  if (looksLikeHeaderRow(grid[0] || [])) start = 1;
  if (start >= grid.length) {
    return { lines, errors: [{ row: 1, message: 'Clipboard only contained a header row.' }] };
  }

  for (let i = start; i < grid.length; i += 1) {
    const cells = grid[i] || [];
    const sheetRow = i + 1;
    if (cells.every((cell) => String(cell ?? '').trim() === '')) continue;

    // Support either "Description Qty Price GST" or a single description column.
    const description = cells[0] != null ? String(cells[0]) : '';
    const quantityRaw = cells.length > 1 ? cells[1] : '1';
    const unitPriceRaw = cells.length > 2 ? cells[2] : cells.length === 1 ? '0' : '0';
    const gstRaw = cells.length > 3 ? cells[3] : 'true';

    const quantityParsed = tryParseClipboardNumber(quantityRaw);
    const unitPriceParsed = tryParseClipboardNumber(unitPriceRaw);
    const gst = parseGstClipboardValue(gstRaw, true);

    if (!quantityParsed.ok || quantityParsed.value <= 0) {
      errors.push({
        row: sheetRow,
        message: `Row ${sheetRow}: quantity "${quantityRaw}" is invalid.`,
      });
    }
    if (!unitPriceParsed.ok || unitPriceParsed.value < 0) {
      errors.push({
        row: sheetRow,
        message: `Row ${sheetRow}: unit price "${unitPriceRaw}" is invalid.`,
      });
    }
    if (!gst.ok) {
      errors.push({ row: sheetRow, message: `Row ${sheetRow}: ${gst.error}` });
    }

    // Still create the row so users can fix it — never silently discard the paste block.
    lines.push(
      cloneLineItem({
        description,
        quantity: quantityParsed.ok && quantityParsed.value > 0 ? quantityParsed.value : 1,
        unitPrice: unitPriceParsed.ok && unitPriceParsed.value >= 0 ? unitPriceParsed.value : 0,
        gstApplicable: gst.value,
      }),
    );
  }

  if (!lines.length && !errors.length) {
    errors.push({ row: 0, message: 'No usable invoice rows were found in the clipboard.' });
  }

  return { lines, errors };
}

/**
 * Resolve the next selected index set for checkbox / row clicks.
 * Uses stable indexes into the current visible order.
 */
export function resolveRowSelection({
  selectedIndexes = [],
  clickedIndex = 0,
  shiftKey = false,
  metaKey = false,
  ctrlKey = false,
  anchorIndex = null,
  lineCount = 0,
} = {}) {
  const count = Math.max(0, Number(lineCount) || 0);
  const clicked = Math.min(Math.max(0, Number(clickedIndex) || 0), Math.max(0, count - 1));
  const current = new Set(
    (selectedIndexes || [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value < count),
  );
  const toggle = Boolean(metaKey || ctrlKey);
  let nextAnchor = anchorIndex == null ? clicked : Number(anchorIndex);

  if (shiftKey && nextAnchor != null && Number.isInteger(nextAnchor)) {
    const from = Math.max(0, Math.min(nextAnchor, clicked));
    const to = Math.min(count - 1, Math.max(nextAnchor, clicked));
    if (!toggle) current.clear();
    for (let i = from; i <= to; i += 1) current.add(i);
  } else if (toggle) {
    if (current.has(clicked)) current.delete(clicked);
    else current.add(clicked);
    nextAnchor = clicked;
  } else {
    current.clear();
    current.add(clicked);
    nextAnchor = clicked;
  }

  return {
    selectedIndexes: [...current].sort((a, b) => a - b),
    anchorIndex: nextAnchor,
  };
}

export function resolveSelectAll({ lineCount = 0, currentlySelectedCount = 0 } = {}) {
  const count = Math.max(0, Number(lineCount) || 0);
  if (count === 0) return [];
  if (currentlySelectedCount >= count) return [];
  return Array.from({ length: count }, (_, index) => index);
}

/** Insert cloned lines after insertAfterIndex (-1 = prepend, >= last = append). */
export function insertLinesAfter({ lineItems = [], insertAfterIndex = -1, newLines = [] } = {}) {
  const base = ensureLineClientKeys(lineItems).map((item) => ({ ...item }));
  const clones = cloneLineItems(newLines);
  if (!clones.length) {
    return { lineItems: base, insertedIndexes: [], insertedClientKeys: [] };
  }
  const after = Math.min(Math.max(-1, Number(insertAfterIndex)), base.length - 1);
  const at = after + 1;
  base.splice(at, 0, ...clones);
  const insertedIndexes = clones.map((_, offset) => at + offset);
  return {
    lineItems: base,
    insertedIndexes,
    insertedClientKeys: clones.map((item) => item.clientKey),
  };
}

export function linesFromSelectedIndexes(lineItems = [], selectedIndexes = []) {
  const lines = ensureLineClientKeys(lineItems);
  return (selectedIndexes || [])
    .map((index) => Number(index))
    .filter((index) => index >= 0 && index < lines.length)
    .sort((a, b) => a - b)
    .map((index) => serializeLineForClipboard(lines[index]));
}

/** True when Ctrl/Cmd+C should copy selected rows instead of native text copy. */
export function shouldHandleBulkRowCopy({
  selectedCount = 0,
  target = null,
  textSelected = false,
} = {}) {
  if (selectedCount < 1) return false;
  if (textSelected) return false;
  const tag = String(target?.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA') return false;
  // Allow bulk copy from checkboxes, row chrome, or when focus is on a line control
  // without an active text selection.
  return true;
}

/** Detect multi-row spreadsheet paste that should create/insert whole rows. */
export function isMultiRowClipboardText(text = '') {
  const raw = String(text ?? '');
  if (!raw.trim()) return false;
  if (raw.includes('\n') || raw.includes('\r')) return true;
  // Header + single data row still counts as spreadsheet paste when tabs present.
  const grid = parseSpreadsheetPaste(raw);
  return grid.length > 1 || (grid[0] || []).length >= 3;
}

export function blankSelectableLine() {
  return blankLineItem();
}
