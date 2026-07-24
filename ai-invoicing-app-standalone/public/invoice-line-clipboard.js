/**
 * Invoice line clipboard helpers: natural text / spreadsheet copy-paste.
 * Row checkboxes are not used — selection is standard browser text selection.
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

/** Detect spreadsheet/grid clipboard text that can create invoice rows. */
export function isMultiRowClipboardText(text = '') {
  const raw = String(text ?? '');
  if (!raw.trim()) return false;
  if (raw.includes('\t')) {
    const grid = parseSpreadsheetPaste(raw);
    return grid.length >= 1 && ((grid[0] || []).length >= 2 || grid.length > 1);
  }
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  // Newline-only description lists are plain text — not automatic row inserts.
  if (lines.length >= 2 && /^description$/i.test(lines[0])) return true;
  return false;
}

/**
 * Insert clipboard text as invoice rows only for spreadsheet/grid pastes.
 * Plain multi-line description selections paste natively into focused fields.
 */
export function shouldInsertClipboardAsRows(text = '', target = null) {
  const raw = String(text ?? '');
  if (!raw.trim()) return false;
  const tag = String(target?.tagName || '').toUpperCase();
  const inField =
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    Boolean(target?.closest?.('[data-invoice-field]'));
  if (raw.includes('\t')) return isMultiRowClipboardText(raw);
  if (inField) return false;
  return isMultiRowClipboardText(raw);
}

const SELECTABLE_LINE_FIELDS = ['description', 'quantity', 'unitPrice'];

function fieldFromSelectionNode(node) {
  if (!node) return null;
  const el = node.nodeType === 3 ? node.parentElement : node;
  return el?.closest?.('[data-invoice-display]')?.getAttribute?.('data-invoice-display') || null;
}

function lineRowFromSelectionNode(node) {
  if (!node) return null;
  const el = node.nodeType === 3 ? node.parentElement : node;
  return el?.closest?.('[data-invoice-line]') || null;
}

/**
 * Build clean clipboard text from a native DOM selection over invoice cells.
 * Uses selection anchor/focus fields so a vertical drag in Description copies
 * only descriptions (newline-separated). Multi-column drags become TSV.
 */
export function serializeNaturalSelection(selection, root = null) {
  if (!selection || selection.isCollapsed) return null;
  const scope =
    root ||
    selection.anchorNode?.ownerDocument?.querySelector?.('[data-invoice-lines]')?.closest('form') ||
    selection.anchorNode?.ownerDocument?.body;
  if (!scope?.querySelectorAll) return null;

  const anchorField = fieldFromSelectionNode(selection.anchorNode);
  const focusField = fieldFromSelectionNode(selection.focusNode);
  const anchorIdx = SELECTABLE_LINE_FIELDS.indexOf(anchorField);
  const focusIdx = SELECTABLE_LINE_FIELDS.indexOf(focusField);
  if (anchorIdx < 0 || focusIdx < 0) return null;

  const fields = SELECTABLE_LINE_FIELDS.slice(
    Math.min(anchorIdx, focusIdx),
    Math.max(anchorIdx, focusIdx) + 1,
  );
  const allRows = [...scope.querySelectorAll('[data-invoice-line]')];
  const anchorRow = lineRowFromSelectionNode(selection.anchorNode);
  const focusRow = lineRowFromSelectionNode(selection.focusNode);
  const anchorRowIdx = allRows.indexOf(anchorRow);
  const focusRowIdx = allRows.indexOf(focusRow);
  if (anchorRowIdx < 0 || focusRowIdx < 0) return null;

  const rowStart = Math.min(anchorRowIdx, focusRowIdx);
  const rowEnd = Math.max(anchorRowIdx, focusRowIdx);
  const lines = [];
  for (let i = rowStart; i <= rowEnd; i += 1) {
    const row = allRows[i];
    const values = fields.map((field) => {
      const el = row?.querySelector?.(`[data-invoice-display="${field}"]`);
      return String(el?.textContent || '').trim();
    });
    lines.push(values);
  }
  if (!lines.length) return null;

  if (fields.length === 1 && fields[0] === 'description') {
    return lines.map((values) => values[0]).join('\n');
  }
  return lines.map((values) => values.join('\t')).join('\n');
}

export function blankSelectableLine() {
  return blankLineItem();
}
