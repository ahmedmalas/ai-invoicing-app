/**
 * Canonical invoice editor UI.
 *
 * Source of truth: InvoiceEditorState (invoice-model.js).
 * Payload builder: buildInvoicePayload(state) — used for every save / autosave / PDF path.
 * API: createInvoiceApiClient — UI handlers do not invent fetch bodies.
 *
 * The DOM is a view of state. Disabling inputs never removes data from state.
 * Never FormData. Never scrape the DOM to build network payloads.
 */

import { calculateInvoiceTotals, calculateLineItem } from './invoice-totals.js';
import {
  formatInvoiceNumberDisplay,
  normalizeInvoiceNumber,
  assertPayloadMatchesVisibleInvoiceNumber,
} from './invoice-number.js';
import { logoSrcFromProfile } from './logo-studio-ui.js';
import {
  applySavedInvoice,
  buildInvoicePayload,
  createEmptyEditorState,
  hydrateEditorState,
  patchEditorState,
  payloadReadyForAutosave,
  snapshotRecoverable,
  validateInvoiceForSave,
  withRecalculatedTotals,
} from './invoice-model.js';
import { createInvoiceApiClient } from './invoice-api.js';
import {
  applyLinePaste,
  blankLineItem,
  displayLineNumber,
  ensureLineClientKeys,
  formatLineItemCountLabel,
  parseLineNumericInput,
  resolveEnterNavigation,
  resolveTabNavigation,
  shouldHandleLineEnter,
  shouldHandleLinePaste,
  shouldHandleLineTab,
} from './invoice-line-keyboard.js';
import {
  cloneLineItem,
  insertLinesAfter,
  parseClipboardRows,
  serializeNaturalSelection,
  shouldInsertClipboardAsRows,
} from './invoice-line-clipboard.js';

export const INVOICE_EDITOR_STORAGE_KEY = 'aleya-invoice-editor-v3';
export const INVOICE_EDITOR_AUTOSAVE_MS = 1200;

function withLineClientKeys(editorState) {
  return {
    ...editorState,
    lineItems: ensureLineClientKeys(editorState?.lineItems || []),
  };
}

const GST_RATE = 0.1;
const OPEN_MS = 320;

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const money = (value) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(value || 0));

function readLocal(storage) {
  try {
    const raw = storage?.getItem?.(INVOICE_EDITOR_STORAGE_KEY);
    if (!raw) {
      // Migration: recover v2 local drafts once.
      const legacy = storage?.getItem?.('aleya-invoice-editor-v2');
      if (!legacy) return null;
      const parsed = JSON.parse(legacy);
      return parsed && typeof parsed === 'object' ? parsed : null;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocal(storage, snapshot) {
  try {
    storage?.setItem?.(INVOICE_EDITOR_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* private mode / quota */
  }
}

function clearLocal(storage) {
  try {
    storage?.removeItem?.(INVOICE_EDITOR_STORAGE_KEY);
    storage?.removeItem?.('aleya-invoice-editor-v2');
  } catch {
    /* ignore */
  }
}

function formatCellDisplayValue(fieldName, value) {
  if (fieldName === 'quantity' || fieldName === 'unitPrice') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(numeric) : String(value ?? '');
  }
  return String(value ?? '');
}

/** Selectable text cell; input appears only while editing so drag-select works across rows. */
function editableCellHtml(fieldName, value, inputAttrs = '') {
  const display = formatCellDisplayValue(fieldName, value);
  return (
    '<td class="invoice-editable-cell" data-editable-cell="' +
    escapeHtml(fieldName) +
    '">' +
    '<span class="invoice-cell-text" data-invoice-display="' +
    escapeHtml(fieldName) +
    '" tabindex="0">' +
    escapeHtml(display) +
    '</span>' +
    '<input class="invoice-cell-input" data-invoice-field="' +
    escapeHtml(fieldName) +
    '" name="' +
    escapeHtml(fieldName) +
    '" value="' +
    escapeHtml(display) +
    '" hidden ' +
    inputAttrs +
    '>' +
    '</td>'
  );
}

function lineRowHtml(item = {}, index = 0) {
  const calculated = calculateLineItem(item);
  const lineId = String(item.clientKey || item.id || `line-index-${index}`);
  const number = displayLineNumber(index);
  return (
    '<tr class="invoice-line" data-invoice-line data-line-id="' +
    escapeHtml(lineId) +
    '" data-line-index="' +
    index +
    '">' +
    '<td class="invoice-line-number-cell">' +
    '<span class="invoice-line-number" data-line-number data-invoice-drag-handle ' +
    'role="presentation" tabindex="-1" title="Drag to reorder" aria-hidden="true">' +
    escapeHtml(number) +
    '</span>' +
    '<span class="sr-only">Line ' +
    escapeHtml(number) +
    '</span>' +
    '</td>' +
    editableCellHtml(
      'description',
      calculated.description,
      'required placeholder="Description of work or goods" autocomplete="off" spellcheck="true"',
    ) +
    editableCellHtml(
      'quantity',
      calculated.quantity || 1,
      'type="number" min="0.01" step="0.01" inputmode="decimal" required',
    ) +
    editableCellHtml(
      'unitPrice',
      calculated.unitPrice || 0,
      'type="number" min="0" step="0.01" inputmode="decimal" required',
    ) +
    '<td><select data-invoice-field="gstApplicable" name="gstApplicable">' +
    '<option value="true"' +
    (calculated.gstApplicable ? ' selected' : '') +
    '>GST</option>' +
    '<option value="false"' +
    (!calculated.gstApplicable ? ' selected' : '') +
    '>No GST</option></select></td>' +
    '<td class="invoice-line-total" data-line-total>' +
    money(calculated.lineTotal) +
    '</td>' +
    '<td class="invoice-line-actions">' +
    '<button type="button" class="icon-button" data-line-duplicate tabindex="-1" aria-label="Duplicate line">⧉</button>' +
    '<button type="button" class="icon-button" data-line-up tabindex="-1" aria-label="Move line up">↑</button>' +
    '<button type="button" class="icon-button" data-line-down tabindex="-1" aria-label="Move line down">↓</button>' +
    '<button type="button" class="icon-button" data-remove-line tabindex="-1" aria-label="Delete line">×</button>' +
    '</td></tr>'
  );
}

function customerOptionsHtml(customers, selected = '') {
  return (customers || [])
    .map(
      (item) =>
        '<option value="' +
        escapeHtml(item.id) +
        '"' +
        (item.id === selected ? ' selected' : '') +
        '>' +
        escapeHtml(item.displayName) +
        '</option>',
    )
    .join('');
}

function customerPreviewMarkup(customer) {
  if (!customer) return '<span class="muted">Customer details appear after selection.</span>';
  return (
    '<strong>' +
    escapeHtml(customer.displayName) +
    '</strong>' +
    (customer.address ? '<span>' + escapeHtml(customer.address) + '</span>' : '') +
    (customer.email ? '<span>' + escapeHtml(customer.email) + '</span>' : '') +
    (customer.phone ? '<span>' + escapeHtml(customer.phone) + '</span>' : '') +
    (customer.abnTaxId ? '<span>ABN ' + escapeHtml(customer.abnTaxId) + '</span>' : '')
  );
}

function templateOptionsHtml(templates = [], selected = '') {
  if (!templates.length) {
    return '<option value="">Default Aleya layout</option>';
  }
  return (
    '<option value="">Default Aleya layout</option>' +
    templates
      .map(
        (item) =>
          '<option value="' +
          escapeHtml(item.id) +
          '"' +
          (item.id === selected || (!selected && item.isDefault) ? ' selected' : '') +
          '>' +
          escapeHtml(item.name) +
          (item.isDefault ? ' (default)' : '') +
          '</option>',
      )
      .join('')
  );
}

function buildEditorHtml({ profile = {}, customers = [], templates = [], state = null, record = null }) {
  const resolved = withLineClientKeys(
    state || (record ? hydrateEditorState(record) : createEmptyEditorState()),
  );
  const recordState = resolved;
  const lines = recordState.lineItems.map((item, index) => lineRowHtml(item, index)).join('');
  const totals = recordState.totals || calculateInvoiceTotals(recordState.lineItems).totals;
  const logo = logoSrcFromProfile(profile);
  const status = recordState.status || 'Draft';
  const invoiceNumberDisplay = formatInvoiceNumberDisplay(recordState.invoiceNumber);
  const selectedTemplateId =
    recordState.templateId || templates.find((item) => item.isDefault)?.id || '';

  return (
    '<div class="invoice-curtain" data-invoice-editor aria-hidden="true">' +
    '<form class="invoice-workspace" id="invoice-editor-form" novalidate data-record-id="' +
    escapeHtml(recordState.id || '') +
    '" data-payment-state="' +
    escapeHtml(recordState.paymentState || 'Draft') +
    '" data-status="' +
    escapeHtml(status) +
    '" data-invoice-number="' +
    escapeHtml(recordState.invoiceNumber || '') +
    '">' +
    '<header class="invoice-toolbar">' +
    '<div class="invoice-toolbar-brand">' +
    (logo
      ? '<img class="brand-logo" src="' +
        logo +
        '" alt="' +
        escapeHtml(profile.companyName || 'Business logo') +
        '" width="40" height="40">'
      : '<span class="brand-mark">A</span>') +
    '<div><strong>Aleya Invoicing</strong><small>Tax invoice workspace</small></div></div>' +
    '<div class="invoice-toolbar-actions">' +
    '<button type="submit" class="button secondary" data-invoice-action="draft">Save Draft</button>' +
    '<button type="submit" class="button" data-invoice-action="save">Save</button>' +
    '<button type="button" class="button ghost" data-invoice-action="preview">Preview PDF</button>' +
    '<button type="button" class="button ghost" data-invoice-action="download">Download PDF</button>' +
    '<button type="button" class="button ghost" data-invoice-action="cancel">Cancel</button>' +
    '</div></header>' +
    '<div class="invoice-sheet">' +
    '<section class="invoice-doc-header">' +
    '<div class="invoice-company">' +
    (logo
      ? '<img class="invoice-logo brand-logo" src="' +
        logo +
        '" alt="' +
        escapeHtml(profile.companyName || 'Business logo') +
        '" width="52" height="52">'
      : '<div class="invoice-logo brand-mark">' +
        escapeHtml(String(profile.companyName || 'A').trim().charAt(0).toUpperCase() || 'A') +
        '</div>') +
    '<div><h1>' +
    escapeHtml(profile.companyName || 'Your business name') +
    '</h1>' +
    '<p>' +
    escapeHtml(profile.legalName || profile.companyName || '') +
    '</p>' +
    (profile.abnTaxId ? '<p>ABN ' + escapeHtml(profile.abnTaxId) + '</p>' : '') +
    (profile.address ? '<p>' + escapeHtml(profile.address) + '</p>' : '') +
    '</div></div>' +
    '<div class="invoice-meta"><p class="invoice-doc-title">TAX INVOICE</p><dl>' +
    '<div><dt>Invoice number</dt><dd data-invoice-number-display>' +
    escapeHtml(invoiceNumberDisplay) +
    '</dd></div>' +
    '<div><dt>Status</dt><dd><span class="status">' +
    escapeHtml(status) +
    '</span></dd></div>' +
    '<div><dt>Issue date</dt><dd><input data-invoice-field="issueDate" name="issueDate" type="date" required value="' +
    escapeHtml(recordState.issueDate || '') +
    '"></dd></div>' +
    '<div><dt>Due date</dt><dd><input data-invoice-field="dueDate" name="dueDate" type="date" required value="' +
    escapeHtml(recordState.dueDate || '') +
    '"></dd></div>' +
    '</dl></div></section>' +
    '<section class="invoice-section"><div class="invoice-section-grid">' +
    '<div><h2>Bill To</h2>' +
    '<label class="invoice-field">Customer<select data-invoice-field="customerId" name="customerId" required data-customer-select>' +
    '<option value="">Select customer</option>' +
    customerOptionsHtml(customers, recordState.customerId || '') +
    '</select></label>' +
    '<label class="invoice-field">Invoice template<select data-invoice-field="templateId" name="templateId" data-template-select>' +
    templateOptionsHtml(templates, selectedTemplateId) +
    '</select></label>' +
    '<p class="muted invoice-template-hint">PDF export uses this recreated design. Manage templates under Templates.</p>' +
    '<div class="invoice-billto-preview" data-customer-preview>' +
    customerPreviewMarkup(null) +
    '</div></div>' +
    '<div><h2>Invoice title</h2>' +
    '<label class="invoice-field" for="invoice-title-input">' +
    '<span class="invoice-field-label">Invoice title</span>' +
    '<input id="invoice-title-input" data-invoice-field="title" name="title" required value="' +
    escapeHtml(recordState.title || '') +
    '" placeholder="Short job or invoice title" autocomplete="off" spellcheck="true" ' +
    'aria-describedby="invoice-title-error">' +
    '<span class="invoice-field-error" id="invoice-title-error" data-invoice-field-error="title" hidden></span>' +
    '</label></div></div></section>' +
    '<section class="invoice-section">' +
    '<div class="invoice-section-head"><h2>Line items</h2>' +
    '<div class="invoice-section-head-actions">' +
    '<span class="invoice-line-count muted" data-line-count>' +
    escapeHtml(formatLineItemCountLabel(recordState.lineItems.length)) +
    '</span>' +
    '<button type="button" class="button secondary small" data-add-line>Add line</button></div></div>' +
    '<div class="invoice-table-wrap"><table class="invoice-lines-table"><thead><tr>' +
    '<th class="invoice-line-number-col" scope="col" title="Line number">#</th>' +
    '<th>Description</th><th>Qty</th><th>Unit Price</th><th>GST</th><th>Total</th><th class="narrow"></th>' +
    '</tr></thead><tbody data-invoice-lines>' +
    lines +
    '</tbody></table></div>' +
    '<p class="invoice-clipboard-hint muted" data-clipboard-errors hidden></p>' +
    '</section>' +
    '<section class="invoice-footer-grid">' +
    '<div class="invoice-notes-block">' +
    '<label class="invoice-field">Notes<textarea data-invoice-field="notes" name="notes" rows="4" placeholder="Notes for the customer">' +
    escapeHtml(recordState.notes || '') +
    '</textarea></label>' +
    '<label class="invoice-field">Payment terms<input data-invoice-field="paymentTerms" name="paymentTerms" value="' +
    escapeHtml(recordState.paymentTerms || '') +
    '" placeholder="e.g. Payment due within 14 days"></label>' +
    '</div>' +
    '<aside class="invoice-totals" aria-live="polite">' +
    '<div><span>Subtotal</span><strong data-total-subtotal>' +
    money(totals.subtotal) +
    '</strong></div>' +
    '<div><span>GST</span><strong data-total-gst>' +
    money(totals.gstTotal) +
    '</strong></div>' +
    '<div class="invoice-grand"><span>Total</span><strong data-total-grand>' +
    money(totals.total) +
    '</strong></div>' +
    '<p class="muted">GST rate ' +
    Math.round(GST_RATE * 100) +
    '%</p>' +
    '</aside></section>' +
    (status === 'Draft' && recordState.id
      ? '<section class="invoice-danger-zone" aria-label="Danger zone">' +
        '<p class="muted">Delete permanently removes this draft and its line items. Finalised invoices cannot be deleted.</p>' +
        '<button type="button" class="button danger" data-invoice-action="delete">Delete invoice draft</button>' +
        '</section>'
      : '') +
    '</div></form></div>'
  );
}

/**
 * @param {object} deps
 * @param {(path: string, options?: object) => Promise<any>} deps.api
 * @param {() => string|null|undefined} deps.getAccessToken
 * @param {() => object} deps.getProfile
 * @param {() => Array} deps.getCustomers
 * @param {(message: string, error?: boolean) => void} deps.toast
 * @param {() => void} deps.invalidateCache
 * @param {(profile: object) => boolean} deps.isProfileReady
 * @param {(id: string) => Promise<string>} deps.downloadPdf
 * @param {(id: string) => Promise<void>} deps.previewPdf
 * @param {Storage} [deps.storage]
 */
export function createInvoiceEditor(deps) {
  const storage = deps.storage ?? globalThis.localStorage;
  const apiClient = createInvoiceApiClient({
    api: deps.api,
    previewPdf: deps.previewPdf,
    downloadPdf: deps.downloadPdf,
  });

  /** @type {import('./invoice-model.js').InvoiceEditorState} */
  let state = withLineClientKeys(createEmptyEditorState());
  let root = null;
  let form = null;
  let opChain = Promise.resolve();
  let autosaveTimer = null;
  let destroyed = false;
  let baseline = '';
  let closing = false;
  let pendingSubmitAction = 'save';
  let dragRow = null;
  let armedRow = null;
  /** Tracks pointer down on a display cell to distinguish click-to-edit from drag-to-select. */
  let displayPointer = null;

  function field(name) {
    return form?.querySelector(`[data-invoice-field="${name}"]`) || null;
  }

  function setFieldError(fieldPath, message) {
    if (!form) return;
    const errorEl = form.querySelector(`[data-invoice-field-error="${fieldPath}"]`);
    const control = field(fieldPath);
    if (errorEl) {
      const text = String(message || '').trim();
      errorEl.hidden = !text;
      errorEl.textContent = text;
    }
    if (control) {
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    }
  }

  function clearFieldErrors() {
    form?.querySelectorAll('[data-invoice-field-error]').forEach((node) => {
      node.hidden = true;
      node.textContent = '';
    });
    form?.querySelectorAll('[aria-invalid="true"]').forEach((node) => {
      node.removeAttribute('aria-invalid');
    });
  }

  function lineIndexFromRow(row) {
    if (!row) return -1;
    const lineId = row.getAttribute('data-line-id');
    if (lineId) {
      const byId = state.lineItems.findIndex((item) => String(item.clientKey || item.id) === lineId);
      if (byId >= 0) return byId;
    }
    return Number(row.dataset.lineIndex || 0);
  }

  function lineRowByIndex(lineIndex) {
    if (!form) return null;
    const lines = ensureLineClientKeys(state.lineItems);
    const target = lines[lineIndex];
    if (!target) return null;
    const lineId = String(target.clientKey || target.id || '');
    return (
      Array.from(form.querySelectorAll('[data-invoice-line]')).find(
        (node) => node.getAttribute('data-line-id') === lineId,
      ) || form.querySelector(`[data-invoice-line][data-line-index="${lineIndex}"]`)
    );
  }

  function syncDisplayFromInput(cell) {
    if (!cell) return;
    const input = cell.querySelector('[data-invoice-field]');
    const display = cell.querySelector('[data-invoice-display]');
    if (!input || !display) return;
    const fieldName = input.getAttribute('data-invoice-field') || '';
    display.textContent = formatCellDisplayValue(fieldName, input.value);
  }

  function endCellEdit(cell) {
    if (!cell?.classList?.contains('is-editing')) return;
    const input = cell.querySelector('[data-invoice-field]');
    if (input) {
      commitLineControl(input);
      syncDisplayFromInput(cell);
      input.hidden = true;
    }
    cell.classList.remove('is-editing');
  }

  function beginCellEdit(cell, { select = true } = {}) {
    if (!cell || !form) return null;
    const input = cell.querySelector('[data-invoice-field]');
    if (!input) return null;
    form.querySelectorAll('.invoice-editable-cell.is-editing').forEach((open) => {
      if (open !== cell) endCellEdit(open);
    });
    cell.classList.add('is-editing');
    input.hidden = false;
    input.focus({ preventScroll: true });
    if (select && typeof input.select === 'function' && input.tagName === 'INPUT') {
      try {
        input.select();
      } catch {
        /* ignore */
      }
    }
    return input;
  }

  function focusLineField(lineIndex, fieldName, { select = true } = {}) {
    const row = lineRowByIndex(lineIndex);
    if (!row) return null;
    const cell = row.querySelector(`[data-editable-cell="${fieldName}"]`);
    if (cell) return beginCellEdit(cell, { select });
    const control = row.querySelector(`[data-invoice-field="${fieldName}"]`);
    if (!control) return null;
    control.focus({ preventScroll: true });
    if (select && typeof control.select === 'function' && control.tagName === 'INPUT') {
      try {
        control.select();
      } catch {
        /* ignore */
      }
    }
    return control;
  }

  /** Flush any focused control into editor state before building payloads. */
  function commitPendingInput() {
    if (!form) return;
    const active = form.ownerDocument?.activeElement;
    if (!active || !form.contains(active)) return;
    const path = active.getAttribute?.('data-invoice-field');
    if (!path) return;
    const row = active.closest?.('[data-invoice-line]');
    if (row) {
      const index = lineIndexFromRow(row);
      if (index < 0) return;
      const lines = ensureLineClientKeys(state.lineItems).map((item) => ({ ...item }));
      const current = { ...(lines[index] || blankLineItem()) };
      if (path === 'description') current.description = String(active.value ?? '');
      else if (path === 'quantity')
        current.quantity = parseLineNumericInput(active.value, current.quantity);
      else if (path === 'unitPrice')
        current.unitPrice = parseLineNumericInput(active.value, current.unitPrice);
      else if (path === 'gstApplicable') current.gstApplicable = active.value === 'true';
      lines[index] = current;
      state = withRecalculatedTotals({ ...state, lineItems: lines });
      return;
    }
    if (path === 'title') state = patchEditorState(state, { title: String(active.value ?? '') });
    else if (path === 'customerId')
      state = patchEditorState(state, { customerId: String(active.value ?? '') });
    else if (path === 'issueDate')
      state = patchEditorState(state, { issueDate: String(active.value ?? '') });
    else if (path === 'dueDate')
      state = patchEditorState(state, { dueDate: String(active.value ?? '') });
    else if (path === 'notes') state = patchEditorState(state, { notes: String(active.value ?? '') });
    else if (path === 'paymentTerms')
      state = patchEditorState(state, { paymentTerms: String(active.value ?? '') });
    else if (path === 'templateId')
      state = patchEditorState(state, { templateId: String(active.value ?? '') || null });
  }

  function commitLineControl(target) {
    if (!target) return;
    const path = target.getAttribute?.('data-invoice-field');
    if (!path) return;
    const row = target.closest?.('[data-invoice-line]');
    if (!row) return;
    const index = lineIndexFromRow(row);
    if (index < 0) return;
    const lines = ensureLineClientKeys(state.lineItems).map((item) => ({ ...item }));
    const current = { ...(lines[index] || blankLineItem()) };
    if (path === 'description') current.description = String(target.value ?? '');
    else if (path === 'quantity')
      current.quantity = parseLineNumericInput(target.value, current.quantity);
    else if (path === 'unitPrice')
      current.unitPrice = parseLineNumericInput(target.value, current.unitPrice);
    else if (path === 'gstApplicable') current.gstApplicable = target.value === 'true';
    // Write the committed numeric value back into the control so it never snaps to 0.
    if (path === 'quantity') target.value = String(current.quantity);
    if (path === 'unitPrice') target.value = String(current.unitPrice);
    lines[index] = current;
    state = withRecalculatedTotals({ ...state, lineItems: lines });
    refreshTotalsDisplay();
  }

  /**
   * Keep visible line controls aligned with canonical state after paste/commit.
   * Always write values back — including the focused control — so preventDefault
   * paste paths cannot be clobbered by a later focusout reading a stale empty DOM value.
   */
  function syncLineControlsFromState() {
    if (!form) return;
    const lines = ensureLineClientKeys(state.lineItems);
    form.querySelectorAll('[data-invoice-line]').forEach((row) => {
      const index = lineIndexFromRow(row);
      const item = lines[index];
      if (!item) return;
      const qty = row.querySelector('[data-invoice-field="quantity"]');
      const price = row.querySelector('[data-invoice-field="unitPrice"]');
      const desc = row.querySelector('[data-invoice-field="description"]');
      const gst = row.querySelector('[data-invoice-field="gstApplicable"]');
      if (desc) {
        desc.value = String(item.description ?? '');
        syncDisplayFromInput(desc.closest('[data-editable-cell]'));
      }
      if (qty) {
        qty.value = String(item.quantity ?? 1);
        syncDisplayFromInput(qty.closest('[data-editable-cell]'));
      }
      if (price) {
        price.value = String(item.unitPrice ?? 0);
        syncDisplayFromInput(price.closest('[data-editable-cell]'));
      }
      if (gst) gst.value = item.gstApplicable === false ? 'false' : 'true';
    });
  }

  function applyPasteCommit(target, pastedText) {
    const row = target?.closest?.('[data-invoice-line]');
    if (!row) return false;
    const fieldName = target.getAttribute?.('data-invoice-field') || '';
    if (!shouldHandleLinePaste(target, pastedText)) return false;
    const result = applyLinePaste({
      lineItems: state.lineItems,
      startIndex: lineIndexFromRow(row),
      startField: fieldName,
      pastedText,
    });
    if (!result.handled) return false;
    const previousCount = state.lineItems.length;
    state = withRecalculatedTotals({ ...state, lineItems: result.lineItems });
    if (state.lineItems.length !== previousCount) {
      renderLineRows();
    } else {
      syncLineControlsFromState();
      refreshTotalsDisplay();
    }
    if (result.focus) {
      queueMicrotask(() => focusLineField(result.focus.lineIndex, result.focus.field, { select: false }));
    }
    scheduleAutosave();
    return true;
  }

  function navigateLineKeyboard(plan) {
    if (!plan || plan.action === 'native') return;
    if (plan.action === 'add-row') {
      state = withRecalculatedTotals({
        ...state,
        lineItems: [...ensureLineClientKeys(state.lineItems), blankLineItem()],
      });
      renderLineRows();
      // Focus after DOM replacement completes.
      queueMicrotask(() => {
        focusLineField(plan.lineIndex, plan.field);
        scheduleAutosave();
      });
      return;
    }
    if (plan.action === 'focus') {
      queueMicrotask(() => {
        focusLineField(plan.lineIndex, plan.field);
      });
    }
  }

  function syncFormMeta() {
    if (!form) return;
    form.dataset.recordId = state.id || '';
    form.dataset.paymentState = state.paymentState || 'Draft';
    form.dataset.status = state.status || 'Draft';
    form.dataset.invoiceNumber = state.invoiceNumber || '';
    const display = form.querySelector('[data-invoice-number-display]');
    if (display) display.textContent = formatInvoiceNumberDisplay(state.invoiceNumber);
  }

  /** Canonical payload from editor state — never FormData / DOM scrape. */
  function buildPayload() {
    commitPendingInput();
    return buildInvoicePayload(state);
  }

  function serializeState() {
    try {
      return JSON.stringify(buildInvoicePayload(state));
    } catch {
      return '';
    }
  }

  function isDirty() {
    if (!form) return false;
    commitPendingInput();
    return serializeState() !== baseline;
  }

  function markPristine() {
    baseline = serializeState();
  }

  function refreshTotalsDisplay() {
    if (!form) return;
    const active = form.ownerDocument?.activeElement;
    const selection =
      active &&
      form.contains(active) &&
      typeof active.selectionStart === 'number'
        ? {
            el: active,
            start: active.selectionStart,
            end: active.selectionEnd,
            direction: active.selectionDirection || 'none',
          }
        : null;
    const { calculatedItems, totals } = calculateInvoiceTotals(state.lineItems);
    state = {
      ...state,
      totals: { subtotal: totals.subtotal, gstTotal: totals.gstTotal, total: totals.total },
    };
    form.querySelectorAll('[data-invoice-line]').forEach((row, index) => {
      const cell = row.querySelector('[data-line-total]');
      if (cell) cell.textContent = money(calculatedItems[index]?.lineTotal || 0);
      row.dataset.lineIndex = String(index);
      const number = displayLineNumber(index);
      const numberEl = row.querySelector('[data-line-number]');
      if (numberEl) numberEl.textContent = String(number);
      const sr = row.querySelector('.sr-only');
      if (sr) sr.textContent = 'Line ' + number;
    });
    const countEl = form.querySelector('[data-line-count]');
    if (countEl) countEl.textContent = formatLineItemCountLabel(state.lineItems.length);
    const sub = form.querySelector('[data-total-subtotal]');
    const gst = form.querySelector('[data-total-gst]');
    const grand = form.querySelector('[data-total-grand]');
    if (sub) sub.textContent = money(totals.subtotal);
    if (gst) gst.textContent = money(totals.gstTotal);
    if (grand) grand.textContent = money(totals.total);
    if (selection?.el?.isConnected && typeof selection.el.setSelectionRange === 'function') {
      try {
        selection.el.focus({ preventScroll: true });
        selection.el.setSelectionRange(selection.start, selection.end, selection.direction);
      } catch {
        /* ignore */
      }
    }
  }

  function setClipboardErrors(messages = []) {
    const el = form?.querySelector('[data-clipboard-errors]');
    if (!el) return;
    if (!messages.length) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = messages.join(' ');
  }

  function activeLineIndex() {
    const active = form?.ownerDocument?.activeElement;
    const row = active?.closest?.('[data-invoice-line]');
    if (row) return lineIndexFromRow(row);
    return state.lineItems.length - 1;
  }

  function pasteRowsFromText(text, { insertAfterIndex = activeLineIndex() } = {}) {
    const parsed = parseClipboardRows(text);
    if (parsed.errors.length) setClipboardErrors(parsed.errors.map((item) => item.message));
    else setClipboardErrors([]);
    if (!parsed.lines.length) {
      if (parsed.errors.length) deps.toast(parsed.errors[0].message, true);
      return false;
    }
    const inserted = insertLinesAfter({
      lineItems: state.lineItems,
      insertAfterIndex,
      newLines: parsed.lines,
    });
    state = withRecalculatedTotals({ ...state, lineItems: inserted.lineItems });
    renderLineRows();
    queueMicrotask(() => {
      if (inserted.insertedIndexes[0] != null) {
        focusLineField(inserted.insertedIndexes[0], 'description', { select: false });
      }
    });
    scheduleAutosave();
    deps.toast(
      parsed.lines.length === 1 ? 'Pasted 1 line.' : `Pasted ${parsed.lines.length} lines.`,
    );
    return true;
  }

  function duplicateSingleRow(index) {
    commitPendingInput();
    const lines = ensureLineClientKeys(state.lineItems);
    const source = lines[index];
    if (!source) return;
    const inserted = insertLinesAfter({
      lineItems: lines,
      insertAfterIndex: index,
      newLines: [cloneLineItem(source)],
    });
    state = withRecalculatedTotals({ ...state, lineItems: inserted.lineItems });
    renderLineRows();
    queueMicrotask(() => focusLineField(inserted.insertedIndexes[0], 'description', { select: false }));
    scheduleAutosave();
  }

  function renderLineRows() {
    const body = form?.querySelector('[data-invoice-lines]');
    if (!body) return;
    body.innerHTML = state.lineItems.map((item, index) => lineRowHtml(item, index)).join('');
    refreshTotalsDisplay();
  }

  function updateCustomerPreview() {
    const preview = form?.querySelector('[data-customer-preview]');
    if (!preview) return;
    const customer = (deps.getCustomers() || []).find((item) => item.id === state.customerId);
    preview.innerHTML = customerPreviewMarkup(customer || null);
  }

  function captureLocal(recordId = null) {
    commitPendingInput();
    const snapshot = {
      version: 3,
      savedAt: new Date().toISOString(),
      recordId: recordId || state.id || null,
      id: recordId || state.id || null,
      ...buildInvoicePayload(state),
      status: state.status,
      paymentState: state.paymentState,
    };
    writeLocal(storage, snapshot);
    return snapshot;
  }

  function setActionsBusy(busy) {
    // Only toolbar actions may disable. Never disable invoice fields for collection —
    // state remains the source of truth regardless of control disabled flags.
    form?.querySelectorAll('[data-invoice-action]').forEach((button) => {
      if (busy) {
        button.dataset.wasDisabled = button.disabled ? '1' : '0';
        button.disabled = true;
      } else if (button.dataset.wasDisabled !== '1') {
        button.disabled = false;
        delete button.dataset.wasDisabled;
      } else {
        delete button.dataset.wasDisabled;
      }
    });
  }

  function enqueue(work) {
    const run = opChain.then(() => work());
    opChain = run.catch(() => undefined);
    return run;
  }

  async function persist({ quiet = false, source = 'manual' } = {}) {
    if (!form?.isConnected) throw new Error('Invoice form is no longer available. Refresh and try again.');
    commitPendingInput();
    if (state.status === 'Finalised') {
      const error = new Error('Only draft invoices can be edited');
      error.status = 400;
      throw error;
    }
    const validated = validateInvoiceForSave(state);
    if (!validated.ok) {
      const error = new Error(validated.message);
      error.status = 400;
      error.fieldPath = validated.fieldPath;
      setFieldError(validated.fieldPath, validated.message);
      field(validated.fieldPath)?.focus?.();
      throw error;
    }
    clearFieldErrors();
    assertPayloadMatchesVisibleInvoiceNumber(validated.payload, state.invoiceNumber);
    const wasNew = !state.id;
    const previousKeys = ensureLineClientKeys(state.lineItems).map((item) => item.clientKey);
    const saved = await apiClient.saveDraft(state);
    state = withLineClientKeys(applySavedInvoice(state, saved));
    state = {
      ...state,
      lineItems: state.lineItems.map((item, index) => ({
        ...item,
        clientKey: previousKeys[index] || item.clientKey,
      })),
    };
    if (form.isConnected) {
      syncFormMeta();
      markPristine();
      captureLocal(saved.id);
    } else {
      const previous = readLocal(storage);
      if (previous) {
        writeLocal(storage, {
          ...previous,
          recordId: saved.id,
          id: saved.id,
          title: previous.title || validated.payload.title,
        });
      }
    }
    deps.invalidateCache();
    history.replaceState({}, '', '/workspace/invoices/' + saved.id + '/edit');
    if (!quiet && source === 'manual') {
      deps.toast(wasNew ? 'Invoice draft created.' : 'Draft saved.');
    }
    return saved;
  }

  function scheduleAutosave() {
    captureLocal(state.id || null);
    if (form?.dataset.autosaveLocked === 'true') {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      return;
    }
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      void enqueue(async () => {
        if (!form?.isConnected || destroyed) return;
        if (form.dataset.autosaveLocked === 'true') return;
        commitPendingInput();
        let payload;
        try {
          payload = buildInvoicePayload(state);
        } catch {
          return;
        }
        if (!payloadReadyForAutosave(payload)) return;
        try {
          await persist({ quiet: true, source: 'autosave' });
        } catch {
          captureLocal(state.id || null);
        }
      });
    }, INVOICE_EDITOR_AUTOSAVE_MS);
  }

  function applyFieldFromEvent(target, { writeBack = false } = {}) {
    const path = target.getAttribute?.('data-invoice-field');
    if (!path) return;
    const row = target.closest?.('[data-invoice-line]');
    if (row) {
      const index = lineIndexFromRow(row);
      if (index < 0) return;
      const lines = ensureLineClientKeys(state.lineItems).map((item) => ({ ...item }));
      const current = { ...(lines[index] || blankLineItem()) };
      if (path === 'description') current.description = String(target.value ?? '');
      else if (path === 'quantity')
        current.quantity = parseLineNumericInput(target.value, current.quantity);
      else if (path === 'unitPrice')
        current.unitPrice = parseLineNumericInput(target.value, current.unitPrice);
      else if (path === 'gstApplicable') current.gstApplicable = target.value === 'true';
      if (writeBack && path === 'quantity') target.value = String(current.quantity);
      if (writeBack && path === 'unitPrice') target.value = String(current.unitPrice);
      lines[index] = current;
      state = withRecalculatedTotals({ ...state, lineItems: lines });
      return;
    }
    if (path === 'title') state = patchEditorState(state, { title: String(target.value ?? '') });
    else if (path === 'customerId')
      state = patchEditorState(state, { customerId: String(target.value ?? '') });
    else if (path === 'issueDate')
      state = patchEditorState(state, { issueDate: String(target.value ?? '') });
    else if (path === 'dueDate')
      state = patchEditorState(state, { dueDate: String(target.value ?? '') });
    else if (path === 'notes') state = patchEditorState(state, { notes: String(target.value ?? '') });
    else if (path === 'paymentTerms')
      state = patchEditorState(state, { paymentTerms: String(target.value ?? '') });
    else if (path === 'templateId')
      state = patchEditorState(state, { templateId: String(target.value ?? '') || null });
  }

  function moveLine(index, direction) {
    const next = index + direction;
    if (next < 0 || next >= state.lineItems.length) return;
    const lines = ensureLineClientKeys(state.lineItems).map((item) => ({ ...item }));
    const [row] = lines.splice(index, 1);
    lines.splice(next, 0, row);
    state = withRecalculatedTotals({ ...state, lineItems: lines });
    renderLineRows();
    queueMicrotask(() => focusLineField(next, 'description'));
    scheduleAutosave();
  }

  function bindInteractions() {
    form.addEventListener('input', (event) => {
      const path = event.target?.getAttribute?.('data-invoice-field');
      if (path) setFieldError(path, '');
      // Commit on every input (typing, paste fallback, autofill, programmatic InputEvent).
      applyFieldFromEvent(event.target);
      if (event.target.closest('[data-invoice-line], [data-invoice-field]')) refreshTotalsDisplay();
      scheduleAutosave();
    });
    form.addEventListener('change', (event) => {
      // Autofill / steppers / select changes — write numeric values back immediately.
      const path = event.target?.getAttribute?.('data-invoice-field');
      const writeBack = path === 'quantity' || path === 'unitPrice';
      applyFieldFromEvent(event.target, { writeBack });
      if (event.target.matches('[data-invoice-field="customerId"]')) updateCustomerPreview();
      if (
        event.target.matches(
          '[data-invoice-field="gstApplicable"], [data-invoice-field="customerId"], [data-invoice-field="quantity"], [data-invoice-field="unitPrice"]',
        )
      ) {
        refreshTotalsDisplay();
      }
      scheduleAutosave();
    });
    form.addEventListener('paste', (event) => {
      const target = event.target;
      const text = event.clipboardData?.getData('text/plain') ?? '';

      // Spreadsheet/grid paste inserts rows. Plain multi-line description text pastes natively
      // into the focused field so line breaks are preserved outside special modes.
      if (shouldInsertClipboardAsRows(text, target)) {
        event.preventDefault();
        event.stopPropagation();
        pasteRowsFromText(text, { insertAfterIndex: activeLineIndex() });
        return;
      }

      if (!shouldHandleLinePaste(target, text)) return;
      // Intercept before type=number rejects "$350" / "350,00" / multi-cell sheets.
      event.preventDefault();
      event.stopPropagation();
      applyPasteCommit(target, text);
    });
    // Additional commit path (never the only one): clicking elsewhere after paste/type.
    form.addEventListener(
      'focusout',
      (event) => {
        const target = event.target;
        const path = target?.getAttribute?.('data-invoice-field');
        const cell = target?.closest?.('[data-editable-cell]');
        if (cell && path) {
          const next = event.relatedTarget;
          if (next && cell.contains(next)) return;
          endCellEdit(cell);
          scheduleAutosave();
          return;
        }
        if (path === 'quantity' || path === 'unitPrice') {
          commitLineControl(target);
          scheduleAutosave();
        }
      },
      true,
    );
    form.addEventListener('click', (event) => {
      if (event.target.closest('[data-add-line]')) {
        state = withRecalculatedTotals({
          ...state,
          lineItems: [...ensureLineClientKeys(state.lineItems), blankLineItem()],
        });
        renderLineRows();
        queueMicrotask(() => focusLineField(state.lineItems.length - 1, 'description'));
        scheduleAutosave();
        return;
      }
      const duplicateOne = event.target.closest('[data-line-duplicate]');
      if (duplicateOne) {
        const row = duplicateOne.closest('[data-invoice-line]');
        duplicateSingleRow(lineIndexFromRow(row));
        return;
      }
      const remove = event.target.closest('[data-remove-line]');
      if (remove) {
        if (state.lineItems.length <= 1) {
          deps.toast('A tax invoice needs at least one line item.', true);
          return;
        }
        const row = remove.closest('[data-invoice-line]');
        const index = lineIndexFromRow(row);
        const lines = ensureLineClientKeys(state.lineItems).filter((_, i) => i !== index);
        state = withRecalculatedTotals({ ...state, lineItems: lines });
        renderLineRows();
        scheduleAutosave();
        return;
      }
      const up = event.target.closest('[data-line-up]');
      if (up) {
        const row = up.closest('[data-invoice-line]');
        moveLine(lineIndexFromRow(row), -1);
        return;
      }
      const down = event.target.closest('[data-line-down]');
      if (down) {
        const row = down.closest('[data-invoice-line]');
        moveLine(lineIndexFromRow(row), 1);
      }
    });

    form.addEventListener('keydown', (event) => {
      const key = String(event.key || '').toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      const target = event.target;

      if (event.key === 'Escape') {
        const editing = target?.closest?.('.invoice-editable-cell.is-editing');
        if (editing) {
          event.preventDefault();
          endCellEdit(editing);
        }
        return;
      }

      // Display span focused: Enter / printable keys open the editor input.
      const display = target?.closest?.('[data-invoice-display]');
      if (display && !mod) {
        const cell = display.closest('[data-editable-cell]');
        if (event.key === 'Enter' || event.key === 'F2') {
          event.preventDefault();
          beginCellEdit(cell, { select: true });
          return;
        }
        if (event.key.length === 1) {
          event.preventDefault();
          const input = beginCellEdit(cell, { select: false });
          if (input) {
            input.value = event.key;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return;
        }
      }

      if (mod && ['a', 'c', 'v', 'x', 'z', 'y'].includes(key)) {
        // Ctrl/Cmd+C uses the native 'copy' event (serializeNaturalSelection).
        return;
      }

      const row = target?.closest?.('[data-invoice-line]');
      if (!row) return;
      const index = lineIndexFromRow(row);
      const fieldName =
        target.getAttribute?.('data-invoice-field') ||
        target.getAttribute?.('data-invoice-display') ||
        '';

      if (event.altKey && event.key === 'ArrowUp') {
        event.preventDefault();
        moveLine(index, -1);
        return;
      }
      if (event.altKey && event.key === 'ArrowDown') {
        event.preventDefault();
        moveLine(index, 1);
        return;
      }

      if (event.key === 'Enter' && shouldHandleLineEnter(target)) {
        // Commit + recalculate before navigation; never submit the invoice form.
        event.preventDefault();
        event.stopPropagation();
        commitLineControl(target);
        const plan = resolveEnterNavigation({
          field: fieldName,
          lineIndex: index,
          lineCount: state.lineItems.length,
        });
        navigateLineKeyboard(plan);
        scheduleAutosave();
        return;
      }

      if (event.key === 'Tab' && shouldHandleLineTab(target)) {
        const plan = resolveTabNavigation({
          field: fieldName,
          lineIndex: index,
          lineCount: state.lineItems.length,
          shiftKey: Boolean(event.shiftKey),
        });
        if (plan.action === 'native') return;
        event.preventDefault();
        event.stopPropagation();
        commitLineControl(target);
        navigateLineKeyboard(plan);
        scheduleAutosave();
      }
    });

    const disarm = () => {
      form.querySelectorAll('[data-invoice-line][draggable="true"]').forEach((row) => {
        row.removeAttribute('draggable');
      });
      armedRow = null;
    };

    form.addEventListener('pointerdown', (event) => {
      const display = event.target.closest?.('[data-invoice-display]');
      if (display && event.button === 0) {
        displayPointer = {
          display,
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
      } else {
        displayPointer = null;
      }

      const handle = event.target.closest?.('[data-invoice-drag-handle]');
      if (!handle) {
        disarm();
        return;
      }
      const row = handle.closest('[data-invoice-line]');
      if (!row) return;
      armedRow = row;
      row.setAttribute('draggable', 'true');
    });
    form.addEventListener('pointermove', (event) => {
      if (!displayPointer) return;
      const dx = event.clientX - displayPointer.x;
      const dy = event.clientY - displayPointer.y;
      if (Math.hypot(dx, dy) > 4) displayPointer.moved = true;
    });
    form.addEventListener('pointerup', (event) => {
      if (displayPointer) {
        const { display, moved } = displayPointer;
        displayPointer = null;
        if (!moved && display?.isConnected && event.button === 0) {
          beginCellEdit(display.closest('[data-editable-cell]'), { select: true });
        }
      }
      if (!dragRow) disarm();
    });
    form.addEventListener('pointercancel', () => {
      displayPointer = null;
      if (!dragRow) disarm();
    });

    // Clean multi-cell copy: keep native selection highlighting, but write
    // description lists / TSV without action-button chrome.
    form.addEventListener('copy', (event) => {
      const active = event.target;
      const tag = String(active?.tagName || '').toUpperCase();
      if (
        (tag === 'INPUT' || tag === 'TEXTAREA') &&
        typeof active.selectionStart === 'number' &&
        active.selectionEnd > active.selectionStart
      ) {
        return;
      }
      const selection = form.ownerDocument?.getSelection?.();
      const text = serializeNaturalSelection(selection, form);
      if (!text) return;
      event.preventDefault();
      event.clipboardData?.setData('text/plain', text);
    });

    form.addEventListener('dragstart', (event) => {
      const row = event.target.closest?.('[data-invoice-line]');
      const fromHandle = Boolean(event.target.closest?.('[data-invoice-drag-handle]'));
      const allowed = row && row === armedRow && (fromHandle || event.target === row);
      if (!allowed || event.target.closest?.('input, textarea, select')) {
        event.preventDefault();
        disarm();
        return;
      }
      dragRow = row;
      dragRow.classList.add('is-dragging');
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    form.addEventListener('dragend', () => {
      dragRow?.classList.remove('is-dragging');
      dragRow = null;
      disarm();
      form.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
    });
    form.addEventListener('dragover', (event) => {
      const over = event.target.closest('[data-invoice-line]');
      if (!dragRow || !over || over === dragRow) return;
      if (event.target.closest('input, textarea, select')) return;
      event.preventDefault();
      form.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
      over.classList.add('drag-over');
    });
    form.addEventListener('drop', (event) => {
      const over = event.target.closest('[data-invoice-line]');
      if (!dragRow || !over || over === dragRow) return;
      if (event.target.closest('input, textarea, select')) return;
      event.preventDefault();
      const from = lineIndexFromRow(dragRow);
      const to = lineIndexFromRow(over);
      const lines = ensureLineClientKeys(state.lineItems).map((item) => ({ ...item }));
      const [moved] = lines.splice(from, 1);
      lines.splice(to, 0, moved);
      state = withRecalculatedTotals({ ...state, lineItems: lines });
      renderLineRows();
      scheduleAutosave();
    });
  }

  function animateOpen() {
    if (!root) return Promise.resolve();
    root.setAttribute('data-curtain-state', 'opening');
    root.setAttribute('aria-hidden', 'true');
    if (typeof root.animate !== 'function') {
      root.classList.add('is-open');
      root.setAttribute('data-curtain-state', 'open');
      root.setAttribute('aria-hidden', 'false');
      return Promise.resolve();
    }
    const animation = root.animate(
      [{ transform: 'translate3d(0, -100%, 0)' }, { transform: 'translate3d(0, 0, 0)' }],
      { duration: OPEN_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
    );
    return animation.finished.finally(() => {
      root.classList.add('is-open');
      root.setAttribute('data-curtain-state', 'open');
      root.setAttribute('aria-hidden', 'false');
    });
  }

  function animateClose() {
    if (!root) return Promise.resolve();
    if (typeof root.animate !== 'function') {
      root.remove();
      root = null;
      form = null;
      return Promise.resolve();
    }
    root.classList.add('is-closing');
    root.classList.remove('is-open');
    root.setAttribute('data-curtain-state', 'closing');
    const animation = root.animate(
      [{ transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(0, -100%, 0)' }],
      { duration: OPEN_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
    );
    return animation.finished.finally(() => {
      root?.remove();
      root = null;
      form = null;
    });
  }

  function applyReadOnlyUi() {
    if (state.status !== 'Finalised' || !form) return;
    form
      .querySelectorAll(
        '[data-invoice-field], [data-add-line], [data-remove-line], [data-line-up], [data-line-down]',
      )
      .forEach((control) => {
        control.disabled = true;
      });
    form.querySelectorAll('[data-invoice-action="draft"], [data-invoice-action="save"]').forEach(
      (control) => {
        control.disabled = true;
        control.hidden = true;
      },
    );
  }

  async function open(record = null) {
    destroyed = false;
    document.querySelector('[data-invoice-editor]')?.remove();
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }

    const customers = deps.getCustomers() || [];
    if (!customers.length) {
      deps.toast('Create a customer before creating an invoice.', true);
      history.replaceState({}, '', '/workspace/customers');
      return { redirected: 'customers' };
    }

    let templates = [];
    try {
      const payload = await deps.api('/api/invoice-templates');
      templates = payload?.templates || [];
    } catch {
      templates = [];
    }
    const defaultTemplate = templates.find((item) => item.isDefault) || templates[0] || null;

    const local = !record?.id && snapshotRecoverable(readLocal(storage)) ? readLocal(storage) : null;
    if (!record?.id && local?.recordId) {
      try {
        const persisted = await apiClient.readInvoice(local.recordId);
        if (persisted?.id && persisted.status === 'Draft') {
          history.replaceState({}, '', '/workspace/invoices/' + persisted.id + '/edit');
          clearLocal(storage);
          deps.toast('Restored your invoice draft after refresh.');
          return open(persisted);
        }
      } catch {
        /* fall through */
      }
    }

    if (record?.id) {
      state = withLineClientKeys(hydrateEditorState(record));
      clearLocal(storage);
    } else if (local) {
      state = withLineClientKeys(hydrateEditorState(local));
      deps.toast('Restored unsaved invoice details from this browser session.');
    } else {
      state = withLineClientKeys(
        createEmptyEditorState({
          templateId: defaultTemplate?.id || null,
          paymentTerms: defaultTemplate?.design?.termsAndConditions || '',
          notes: defaultTemplate?.design?.notesPlaceholder || '',
        }),
      );
    }
    if (!state.templateId && defaultTemplate?.id) {
      state = patchEditorState(state, { templateId: defaultTemplate.id });
    }

    document.body.insertAdjacentHTML(
      'beforeend',
      buildEditorHtml({
        profile: deps.getProfile() || {},
        customers,
        templates,
        state,
      }),
    );
    root = document.querySelector('[data-invoice-editor]');
    form = document.querySelector('#invoice-editor-form');
    if (!root || !form) return { redirected: null };
    syncFormMeta();
    applyReadOnlyUi();
    bindInteractions();
    updateCustomerPreview();
    refreshTotalsDisplay();
    markPristine();
    await animateOpen();
    const active = form.ownerDocument?.activeElement;
    if (!(active && form.contains(active))) {
      field('title')?.focus();
    }
    return { redirected: null };
  }

  async function close({ force = false, animate = true } = {}) {
    if (!root) return true;
    if (!force && isDirty()) {
      if (!window.confirm('You have unsaved changes. Discard them and leave this form?')) return false;
    }
    if (closing) return true;
    closing = true;
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    try {
      if (animate) await animateClose();
      else {
        root.remove();
        root = null;
        form = null;
      }
      destroyed = true;
      return true;
    } finally {
      closing = false;
    }
  }

  async function handleAction(action) {
    if (!form) return;
    commitPendingInput();
    if (action === 'cancel') return { type: 'cancel' };
    if (action === 'draft' || action === 'save') {
      pendingSubmitAction = action;
      return { type: 'submit-pending', action };
    }
    if (action === 'delete') {
      if (!state.id) {
        throw new Error('Save the invoice draft before deleting it.');
      }
      if (state.status !== 'Draft') {
        throw new Error('Only draft invoices can be deleted');
      }
      return {
        type: 'delete-request',
        invoiceId: state.id,
        invoiceNumber: formatInvoiceNumberDisplay(state.invoiceNumber),
        title: String(state.title || '').trim() || 'Untitled invoice',
        customerId: state.customerId,
      };
    }
    if (action === 'preview' || action === 'download') {
      const validated = validateInvoiceForSave(state);
      if (!validated.ok) {
        const error = new Error(validated.message);
        error.status = 400;
        error.fieldPath = validated.fieldPath;
        setFieldError(validated.fieldPath, validated.message);
        field(validated.fieldPath)?.focus?.();
        throw error;
      }
      assertPayloadMatchesVisibleInvoiceNumber(validated.payload, state.invoiceNumber);
      if (!deps.isProfileReady(deps.getProfile())) {
        throw new Error('Save your business name and address in Aleya Settings before generating PDFs.');
      }
      setActionsBusy(true);
      try {
        const previousKeys = ensureLineClientKeys(state.lineItems).map((item) => item.clientKey);
        const saved = await enqueue(() =>
          apiClient.ensurePersistedForPdf(state, {
            isDirty: isDirty(),
            persist: () => persist({ quiet: true, source: 'preview' }),
          }),
        );
        state = withLineClientKeys(applySavedInvoice(state, saved));
        state = {
          ...state,
          lineItems: state.lineItems.map((item, index) => ({
            ...item,
            clientKey: previousKeys[index] || item.clientKey,
          })),
        };
        syncFormMeta();
        if (action === 'preview') {
          await apiClient.previewPdf(saved.id);
          deps.toast('PDF preview opened.');
        } else {
          const name = await apiClient.downloadPdf(saved.id);
          deps.toast(name + ' downloaded.');
        }
        return { type: action, saved, payload: validated.payload };
      } finally {
        setActionsBusy(false);
      }
    }
    return { type: 'noop' };
  }

  async function handleSubmit(submitterAction) {
    const action = submitterAction || pendingSubmitAction || 'save';
    pendingSubmitAction = 'save';
    const wasNew = !state.id;
    setActionsBusy(true);
    try {
      const saved = await enqueue(() => persist({ quiet: true, source: 'manual' }));
      if (action === 'draft') {
        deps.toast(wasNew ? 'Invoice draft created.' : 'Draft saved.');
        return { type: 'draft', saved };
      }
      clearLocal(storage);
      deps.toast(wasNew ? 'Invoice draft created.' : 'Invoice saved.');
      await close({ force: true, animate: true });
      return { type: 'save', saved };
    } finally {
      setActionsBusy(false);
    }
  }

  return {
    open,
    close,
    isOpen: () => Boolean(root && form),
    isDirty,
    getForm: () => form,
    getState: () => {
      commitPendingInput();
      return state;
    },
    buildPayload,
    handleAction,
    handleSubmit,
    clearLocal: () => clearLocal(storage),
    captureLocal,
    focusField(fieldPath) {
      const control =
        form?.querySelector(`[data-invoice-field="${fieldPath}"]`) ||
        (fieldPath === 'lineItems' ? form?.querySelector('[data-invoice-field="description"]') : null);
      control?.focus?.();
      if (control && typeof control.select === 'function' && control.type !== 'number') control.select();
    },
  };
}

export {
  buildEditorHtml,
  lineRowHtml,
  snapshotRecoverable,
  readLocal as readInvoiceEditorLocal,
  clearLocal as clearInvoiceEditorLocal,
  formatInvoiceNumberDisplay,
  normalizeInvoiceNumber,
  assertPayloadMatchesVisibleInvoiceNumber,
  buildInvoicePayload,
  hydrateEditorState,
  createEmptyEditorState,
  withLineClientKeys,
};
