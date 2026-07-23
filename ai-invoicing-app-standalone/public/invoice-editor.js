/**
 * Canonical invoice editor (rebuild).
 *
 * One source of truth while mounted:
 *   - editable fields: live control `.value` via data-invoice-field
 *   - invoice number: form.dataset.invoiceNumber (server-owned; never an input)
 * One payload builder (never FormData) — includes invoiceNumber for preview/save parity.
 * One serialised operation queue for autosave / save / preview / download.
 * Action buttons may disable; form fields never disable for payload collection.
 */

import { calculateInvoiceTotals, calculateLineItem } from './invoice-totals.js';
import {
  assertPayloadMatchesVisibleInvoiceNumber,
  formatInvoiceNumberDisplay,
  normalizeInvoiceNumber,
} from './invoice-number.js';
import { logoSrcFromProfile } from './logo-studio-ui.js';

export const INVOICE_EDITOR_STORAGE_KEY = 'aleya-invoice-editor-v2';
export const INVOICE_EDITOR_AUTOSAVE_MS = 1200;

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

const todayOffset = (offset = 0) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
};

function readLocal(storage) {
  try {
    const raw = storage?.getItem?.(INVOICE_EDITOR_STORAGE_KEY);
    if (!raw) return null;
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
  } catch {
    /* ignore */
  }
}

function snapshotRecoverable(snapshot) {
  if (!snapshot) return false;
  const hasTitle = Boolean(String(snapshot.title || '').trim());
  const hasCustomer = Boolean(String(snapshot.customerId || '').trim());
  const hasLine = (snapshot.lineItems || []).some((item) => String(item?.description || '').trim());
  return hasTitle || hasCustomer || hasLine;
}

function lineRowHtml(item = {}, index = 0) {
  const calculated = calculateLineItem(item);
  return (
    '<tr class="invoice-line" data-invoice-line data-line-index="' +
    index +
    '">' +
    '<td class="invoice-line-handle">' +
    '<span class="invoice-line-drag-handle" data-invoice-drag-handle role="button" tabindex="0" aria-label="Reorder line">⋮⋮</span>' +
    '</td>' +
    '<td><input data-invoice-field="description" name="description" value="' +
    escapeHtml(calculated.description) +
    '" required placeholder="Description of work or goods" autocomplete="off" spellcheck="true"></td>' +
    '<td><input data-invoice-field="quantity" name="quantity" type="number" min="0.01" step="0.01" value="' +
    escapeHtml(calculated.quantity || 1) +
    '" required></td>' +
    '<td><input data-invoice-field="unitPrice" name="unitPrice" type="number" min="0" step="0.01" value="' +
    escapeHtml(calculated.unitPrice || 0) +
    '" required></td>' +
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
    '<button type="button" class="icon-button" data-line-up aria-label="Move line up">↑</button>' +
    '<button type="button" class="icon-button" data-line-down aria-label="Move line down">↓</button>' +
    '<button type="button" class="icon-button" data-remove-line aria-label="Delete line">×</button>' +
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

function buildEditorHtml({ profile = {}, customers = [], record = {} }) {
  const lines = (record.lineItems?.length
    ? record.lineItems
    : [{ description: '', quantity: 1, unitPrice: 0, gstApplicable: true }]
  )
    .map((item, index) => lineRowHtml(item, index))
    .join('');
  const { totals } = calculateInvoiceTotals(
    record.lineItems?.length
      ? record.lineItems
      : [{ quantity: 1, unitPrice: 0, gstApplicable: true }],
  );
  const logo = logoSrcFromProfile(profile);
  const status = record.status || 'Draft';
  const invoiceNumber = normalizeInvoiceNumber(record.invoiceNumber);
  const invoiceNumberDisplay = formatInvoiceNumberDisplay(invoiceNumber);

  return (
    '<div class="invoice-curtain" data-invoice-editor aria-hidden="true">' +
    '<form class="invoice-workspace" id="invoice-editor-form" novalidate data-record-id="' +
    escapeHtml(record.id || '') +
    '" data-payment-state="' +
    escapeHtml(record.paymentState || 'Draft') +
    '" data-status="' +
    escapeHtml(status) +
    '" data-invoice-number="' +
    escapeHtml(invoiceNumber || '') +
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
    escapeHtml(record.issueDate || '') +
    '"></dd></div>' +
    '<div><dt>Due date</dt><dd><input data-invoice-field="dueDate" name="dueDate" type="date" required value="' +
    escapeHtml(record.dueDate || '') +
    '"></dd></div>' +
    '</dl></div></section>' +
    '<section class="invoice-section"><div class="invoice-section-grid">' +
    '<div><h2>Bill To</h2>' +
    '<label class="invoice-field">Customer<select data-invoice-field="customerId" name="customerId" required data-customer-select>' +
    '<option value="">Select customer</option>' +
    customerOptionsHtml(customers, record.customerId || '') +
    '</select></label>' +
    '<div class="invoice-billto-preview" data-customer-preview>' +
    customerPreviewMarkup(null) +
    '</div></div>' +
    '<div><h2>Invoice title</h2>' +
    '<label class="invoice-field" for="invoice-title-input">' +
    '<span class="invoice-field-label">Invoice title</span>' +
    '<input id="invoice-title-input" data-invoice-field="title" name="title" required value="' +
    escapeHtml(record.title || '') +
    '" placeholder="Short job or invoice title" autocomplete="off" spellcheck="true" ' +
    'aria-describedby="invoice-title-error">' +
    '<span class="invoice-field-error" id="invoice-title-error" data-invoice-field-error="title" hidden></span>' +
    '</label></div></div></section>' +
    '<section class="invoice-section">' +
    '<div class="invoice-section-head"><h2>Line items</h2>' +
    '<button type="button" class="button secondary small" data-add-line>Add line</button></div>' +
    '<div class="invoice-table-wrap"><table class="invoice-lines-table"><thead><tr>' +
    '<th class="narrow"></th><th>Description</th><th>Qty</th><th>Unit Price</th><th>GST</th><th>Total</th><th class="narrow"></th>' +
    '</tr></thead><tbody data-invoice-lines>' +
    lines +
    '</tbody></table></div></section>' +
    '<section class="invoice-footer-grid">' +
    '<div class="invoice-notes-block">' +
    '<label class="invoice-field">Notes<textarea data-invoice-field="notes" name="notes" rows="4" placeholder="Notes for the customer">' +
    escapeHtml(record.notes || '') +
    '</textarea></label>' +
    '<label class="invoice-field">Payment terms<input data-invoice-field="paymentTerms" name="paymentTerms" value="' +
    escapeHtml(record.paymentTerms || '') +
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
    (status === 'Draft' && record.id
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

  function field(name) {
    return form?.querySelector(`[data-invoice-field="${name}"]`) || null;
  }

  function fieldValue(name) {
    const control = field(name);
    // Always read live `.value` — never FormData. Disabled controls still expose value.
    return control ? String(control.value ?? '') : '';
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

  function readLineItems() {
    if (!form) return [];
    return [...form.querySelectorAll('[data-invoice-line]')].map((row) => ({
      description: String(row.querySelector('[data-invoice-field="description"]')?.value || '').trim(),
      quantity: Number(row.querySelector('[data-invoice-field="quantity"]')?.value || 0),
      unitPrice: Number(row.querySelector('[data-invoice-field="unitPrice"]')?.value || 0),
      gstApplicable: row.querySelector('[data-invoice-field="gstApplicable"]')?.value === 'true',
    }));
  }

  function readCanonicalInvoiceNumber() {
    return normalizeInvoiceNumber(form?.dataset.invoiceNumber);
  }

  function syncInvoiceNumberDisplay(invoiceNumber) {
    if (!form) return;
    const normalized = normalizeInvoiceNumber(invoiceNumber);
    form.dataset.invoiceNumber = normalized || '';
    const display = form.querySelector('[data-invoice-number-display]');
    if (display) display.textContent = formatInvoiceNumberDisplay(normalized);
  }

  /** Canonical payload — live control values + server-owned invoiceNumber. Never FormData. */
  function buildPayload() {
    const lineItems = readLineItems();
    if (!lineItems.length) {
      const error = new Error('Add at least one line item.');
      error.fieldPath = 'lineItems';
      throw error;
    }
    if (lineItems.some((item) => !item.description)) {
      const error = new Error('Each line needs a description.');
      error.fieldPath = 'lineItems';
      throw error;
    }
    const notes = fieldValue('notes').trim();
    const paymentTerms = fieldValue('paymentTerms').trim();
    const invoiceNumber = readCanonicalInvoiceNumber();
    return {
      customerId: fieldValue('customerId'),
      title: fieldValue('title').trim(),
      issueDate: fieldValue('issueDate'),
      dueDate: fieldValue('dueDate'),
      invoiceNumber,
      ...(notes ? { notes } : {}),
      ...(paymentTerms ? { paymentTerms } : {}),
      lineItems,
    };
  }

  function payloadReady(body) {
    return Boolean(
      body?.customerId &&
        String(body.title || '').trim() &&
        Array.isArray(body.lineItems) &&
        body.lineItems.length &&
        body.lineItems.every(
          (item) => String(item.description || '').trim() && Number(item.quantity) > 0,
        ),
    );
  }

  function requireTitle(body) {
    if (String(body.title || '').trim()) {
      setFieldError('title', '');
      return;
    }
    const error = new Error('Invoice title is required.');
    error.status = 400;
    error.fieldPath = 'title';
    setFieldError('title', error.message);
    field('title')?.focus?.();
    throw error;
  }

  function serializeState() {
    try {
      return JSON.stringify(buildPayload());
    } catch {
      return '';
    }
  }

  function isDirty() {
    if (!form) return false;
    return serializeState() !== baseline;
  }

  function markPristine() {
    baseline = serializeState();
  }

  function refreshTotals() {
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
    const { calculatedItems, totals } = calculateInvoiceTotals(readLineItems());
    form.querySelectorAll('[data-invoice-line]').forEach((row, index) => {
      const cell = row.querySelector('[data-line-total]');
      if (cell) cell.textContent = money(calculatedItems[index]?.lineTotal || 0);
      row.dataset.lineIndex = String(index);
    });
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

  function updateCustomerPreview() {
    const select = field('customerId');
    const preview = form?.querySelector('[data-customer-preview]');
    if (!select || !preview) return;
    const customer = (deps.getCustomers() || []).find((item) => item.id === select.value);
    preview.innerHTML = customerPreviewMarkup(customer || null);
  }

  function captureLocal(recordId = null) {
    if (!form) return null;
    let body;
    try {
      body = buildPayload();
    } catch {
      body = {
        customerId: fieldValue('customerId'),
        title: fieldValue('title').trim(),
        issueDate: fieldValue('issueDate'),
        dueDate: fieldValue('dueDate'),
        notes: fieldValue('notes'),
        paymentTerms: fieldValue('paymentTerms'),
        lineItems: readLineItems(),
      };
    }
    const snapshot = {
      version: 2,
      savedAt: new Date().toISOString(),
      recordId: recordId || form.dataset.recordId || null,
      ...body,
    };
    writeLocal(storage, snapshot);
    return snapshot;
  }

  function applyLocal(snapshot) {
    if (!form || !snapshot) return;
    const set = (name, value) => {
      const control = field(name);
      if (!control || value == null || value === '') return;
      if (form.ownerDocument?.activeElement === control) return;
      control.value = value;
    };
    set('customerId', snapshot.customerId);
    set('title', snapshot.title);
    set('issueDate', snapshot.issueDate);
    set('dueDate', snapshot.dueDate);
    set('notes', snapshot.notes);
    set('paymentTerms', snapshot.paymentTerms);
    if (snapshot.recordId) form.dataset.recordId = snapshot.recordId;
    const body = form.querySelector('[data-invoice-lines]');
    if (body && Array.isArray(snapshot.lineItems) && snapshot.lineItems.length) {
      const active = form.ownerDocument?.activeElement;
      if (!(active && body.contains(active))) {
        body.innerHTML = snapshot.lineItems.map((item, index) => lineRowHtml(item, index)).join('');
      }
    }
  }

  function setActionsBusy(busy) {
    // Only toolbar actions may disable. Never disable invoice fields — FormData (and
    // some browsers) omit disabled controls, which previously surfaced a false
    // "Invoice title is required." while the title was still visible.
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
    if (form.dataset.status === 'Finalised') {
      const error = new Error('Only draft invoices can be edited');
      error.status = 400;
      throw error;
    }
    const body = buildPayload();
    requireTitle(body);
    assertPayloadMatchesVisibleInvoiceNumber(body, readCanonicalInvoiceNumber());
    const recordId = form.dataset.recordId || '';
    let saved;
    if (recordId) {
      const { customerId: _customerId, ...invoiceBody } = body;
      saved = await deps.api('/api/invoices/' + recordId, {
        method: 'PUT',
        body: JSON.stringify({
          ...invoiceBody,
          paymentState: form.dataset.paymentState || 'Draft',
        }),
      });
    } else {
      saved = await deps.api('/api/invoices', { method: 'POST', body: JSON.stringify(body) });
    }
    if (!Array.isArray(saved.lineItems)) {
      saved = await deps.api('/api/invoices/' + saved.id);
    }
    if (form.isConnected) {
      form.dataset.recordId = saved.id;
      form.dataset.paymentState = saved.paymentState || 'Draft';
      form.dataset.status = saved.status || 'Draft';
      syncInvoiceNumberDisplay(saved.invoiceNumber);
      markPristine();
      captureLocal(saved.id);
    } else {
      const previous = readLocal(storage);
      if (previous) writeLocal(storage, { ...previous, recordId: saved.id, title: previous.title || body.title });
    }
    deps.invalidateCache();
    history.replaceState({}, '', '/workspace/invoices/' + saved.id + '/edit');
    if (!quiet && source === 'manual') {
      deps.toast(recordId ? 'Draft saved.' : 'Invoice draft created.');
    }
    return saved;
  }

  function scheduleAutosave() {
    captureLocal(form?.dataset.recordId || null);
    // Test harness may set data-autosave-locked="true" to assert localStorage
    // recovery before the first server draft exists.
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
        let body;
        try {
          body = buildPayload();
        } catch {
          return;
        }
        if (!payloadReady(body)) return;
        try {
          await persist({ quiet: true, source: 'autosave' });
        } catch {
          captureLocal(form?.dataset.recordId || null);
        }
      });
    }, INVOICE_EDITOR_AUTOSAVE_MS);
  }

  function reindexLines() {
    form?.querySelectorAll('[data-invoice-line]').forEach((row, index) => {
      row.dataset.lineIndex = String(index);
    });
  }

  function moveLine(row, direction) {
    const body = form?.querySelector('[data-invoice-lines]');
    if (!body || !row) return;
    if (direction < 0 && row.previousElementSibling) body.insertBefore(row, row.previousElementSibling);
    else if (direction > 0 && row.nextElementSibling) body.insertBefore(row.nextElementSibling, row);
    else return;
    reindexLines();
    refreshTotals();
    row.querySelector('[data-invoice-field="description"]')?.focus();
    scheduleAutosave();
  }

  function bindInteractions() {
    form.addEventListener('input', (event) => {
      const path = event.target?.getAttribute?.('data-invoice-field');
      if (path) setFieldError(path, '');
      if (event.target.closest('[data-invoice-line], [data-invoice-field]')) refreshTotals();
      scheduleAutosave();
    });
    form.addEventListener('change', (event) => {
      if (event.target.matches('[data-invoice-field="customerId"]')) updateCustomerPreview();
      if (event.target.matches('[data-invoice-field="gstApplicable"], [data-invoice-field="customerId"]')) {
        refreshTotals();
      }
      scheduleAutosave();
    });
    form.addEventListener('click', (event) => {
      if (event.target.closest('[data-add-line]')) {
        const body = form.querySelector('[data-invoice-lines]');
        const index = body?.querySelectorAll('[data-invoice-line]').length || 0;
        body?.insertAdjacentHTML('beforeend', lineRowHtml({}, index));
        refreshTotals();
        body?.querySelector('[data-invoice-line]:last-child [data-invoice-field="description"]')?.focus();
        scheduleAutosave();
        return;
      }
      const remove = event.target.closest('[data-remove-line]');
      if (remove) {
        const rows = form.querySelectorAll('[data-invoice-line]');
        if (rows.length <= 1) {
          deps.toast('A tax invoice needs at least one line item.', true);
          return;
        }
        remove.closest('[data-invoice-line]')?.remove();
        reindexLines();
        refreshTotals();
        scheduleAutosave();
        return;
      }
      const up = event.target.closest('[data-line-up]');
      if (up) {
        moveLine(up.closest('[data-invoice-line]'), -1);
        return;
      }
      const down = event.target.closest('[data-line-down]');
      if (down) moveLine(down.closest('[data-invoice-line]'), 1);
    });

    form.addEventListener('keydown', (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        ['a', 'c', 'x', 'v', 'z', 'y'].includes(String(event.key || '').toLowerCase())
      ) {
        return;
      }
      const row = event.target.closest?.('[data-invoice-line]');
      if (!row) return;
      if (event.altKey && event.key === 'ArrowUp') {
        event.preventDefault();
        moveLine(row, -1);
      } else if (event.altKey && event.key === 'ArrowDown') {
        event.preventDefault();
        moveLine(row, 1);
      }
    });

    const disarm = () => {
      form.querySelectorAll('[data-invoice-line][draggable="true"]').forEach((row) => {
        row.removeAttribute('draggable');
      });
      armedRow = null;
    };

    form.addEventListener('pointerdown', (event) => {
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
    form.addEventListener('pointerup', () => {
      if (!dragRow) disarm();
    });
    form.addEventListener('pointercancel', () => {
      if (!dragRow) disarm();
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
      const body = form.querySelector('[data-invoice-lines]');
      const rows = [...body.querySelectorAll('[data-invoice-line]')];
      const from = rows.indexOf(dragRow);
      const to = rows.indexOf(over);
      if (from < to) body.insertBefore(dragRow, over.nextElementSibling);
      else body.insertBefore(dragRow, over);
      reindexLines();
      refreshTotals();
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
    // Finalised invoices stay open for PDF preview/download. Persist paths reject edits.
    let seed = record;
    const local = !record?.id && snapshotRecoverable(readLocal(storage)) ? readLocal(storage) : null;
    if (!record?.id && local?.recordId) {
      try {
        const persisted = await deps.api('/api/invoices/' + local.recordId);
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

    const defaults = {
      issueDate: seed?.issueDate || todayOffset(0),
      dueDate: seed?.dueDate || todayOffset(14),
      ...(seed || {}),
    };
    const recordForHtml = seed?.id
      ? defaults
      : {
          issueDate: defaults.issueDate,
          dueDate: defaults.dueDate,
          ...(local
            ? {
                customerId: local.customerId,
                title: local.title,
                notes: local.notes,
                paymentTerms: local.paymentTerms,
                lineItems: local.lineItems,
                id: local.recordId || '',
              }
            : {}),
        };

    document.body.insertAdjacentHTML(
      'beforeend',
      buildEditorHtml({
        profile: deps.getProfile() || {},
        customers,
        record: recordForHtml,
      }),
    );
    root = document.querySelector('[data-invoice-editor]');
    form = document.querySelector('#invoice-editor-form');
    if (!root || !form) return { redirected: null };
    syncInvoiceNumberDisplay(recordForHtml.invoiceNumber);

    if (form.dataset.status === 'Finalised') {
      form.querySelectorAll('[data-invoice-field], [data-add-line], [data-remove-line], [data-line-up], [data-line-down]').forEach(
        (control) => {
          control.disabled = true;
        },
      );
      form.querySelectorAll('[data-invoice-action="draft"], [data-invoice-action="save"]').forEach(
        (control) => {
          control.disabled = true;
          control.hidden = true;
        },
      );
    }

    if (!seed?.id) {
      field('issueDate').value = defaults.issueDate;
      field('dueDate').value = defaults.dueDate;
      if (local) {
        applyLocal(local);
        deps.toast('Restored unsaved invoice details from this browser session.');
      }
    } else {
      clearLocal(storage);
    }

    bindInteractions();
    updateCustomerPreview();
    refreshTotals();
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
    if (action === 'cancel') return { type: 'cancel' };
    if (action === 'draft' || action === 'save') {
      pendingSubmitAction = action;
      return { type: 'submit-pending', action };
    }
    if (action === 'delete') {
      const recordId = form.dataset.recordId || '';
      if (!recordId) {
        throw new Error('Save the invoice draft before deleting it.');
      }
      if (form.dataset.status !== 'Draft') {
        throw new Error('Only draft invoices can be deleted');
      }
      return {
        type: 'delete-request',
        invoiceId: recordId,
        invoiceNumber: formatInvoiceNumberDisplay(readCanonicalInvoiceNumber()),
        title: fieldValue('title').trim() || 'Untitled invoice',
        customerId: fieldValue('customerId'),
      };
    }
    if (action === 'preview' || action === 'download') {
      let body;
      try {
        body = buildPayload();
      } catch (error) {
        error.fieldPath = error.fieldPath || 'lineItems';
        throw error;
      }
      if (!payloadReady(body)) {
        const missingTitle = !String(body.title || '').trim();
        const error = new Error(
          missingTitle
            ? 'Invoice title is required.'
            : 'Add a customer, title, and at least one line item before previewing.',
        );
        error.status = 400;
        error.fieldPath = missingTitle ? 'title' : 'customerId';
        if (missingTitle) setFieldError('title', error.message);
        field(error.fieldPath)?.focus?.();
        throw error;
      }
      const visibleNumber = readCanonicalInvoiceNumber();
      assertPayloadMatchesVisibleInvoiceNumber(body, visibleNumber);
      if (!deps.isProfileReady(deps.getProfile())) {
        throw new Error('Save your business name and address in Aleya Settings before generating PDFs.');
      }
      setActionsBusy(true);
      try {
        const recordId = form.dataset.recordId || '';
        const isFinalised = form.dataset.status === 'Finalised';
        // Existing saved invoices (especially issued ones) must preview from the
        // persisted record — never invent a number and never PUT a finalised invoice.
        let saved;
        if (recordId && (isFinalised || !isDirty())) {
          saved = await enqueue(() => deps.api('/api/invoices/' + recordId));
          syncInvoiceNumberDisplay(saved.invoiceNumber);
          assertPayloadMatchesVisibleInvoiceNumber(
            { ...body, invoiceNumber: normalizeInvoiceNumber(saved.invoiceNumber) },
            normalizeInvoiceNumber(saved.invoiceNumber),
          );
        } else {
          saved = await enqueue(() => persist({ quiet: true, source: 'preview' }));
        }
        if (action === 'preview') {
          await deps.previewPdf(saved.id);
          deps.toast('PDF preview opened.');
        } else {
          const name = await deps.downloadPdf(saved.id);
          deps.toast(name + ' downloaded.');
        }
        return { type: action, saved, payload: body };
      } finally {
        setActionsBusy(false);
      }
    }
    return { type: 'noop' };
  }

  async function handleSubmit(submitterAction) {
    const action = submitterAction || pendingSubmitAction || 'save';
    pendingSubmitAction = 'save';
    const wasNew = !form?.dataset.recordId;
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
  buildPayloadFromForm,
  lineRowHtml,
  snapshotRecoverable,
  readLocal as readInvoiceEditorLocal,
  clearLocal as clearInvoiceEditorLocal,
  formatInvoiceNumberDisplay,
  normalizeInvoiceNumber,
  assertPayloadMatchesVisibleInvoiceNumber,
};

/** Test helper: payload from a mounted form element. */
function buildPayloadFromForm(formEl) {
  const read = (name) => String(formEl.querySelector(`[data-invoice-field="${name}"]`)?.value || '');
  const lineItems = [...formEl.querySelectorAll('[data-invoice-line]')].map((row) => ({
    description: String(row.querySelector('[data-invoice-field="description"]')?.value || '').trim(),
    quantity: Number(row.querySelector('[data-invoice-field="quantity"]')?.value || 0),
    unitPrice: Number(row.querySelector('[data-invoice-field="unitPrice"]')?.value || 0),
    gstApplicable: row.querySelector('[data-invoice-field="gstApplicable"]')?.value === 'true',
  }));
  return {
    customerId: read('customerId'),
    title: read('title').trim(),
    issueDate: read('issueDate'),
    dueDate: read('dueDate'),
    invoiceNumber: normalizeInvoiceNumber(formEl.dataset?.invoiceNumber),
    ...(read('notes').trim() ? { notes: read('notes').trim() } : {}),
    ...(read('paymentTerms').trim() ? { paymentTerms: read('paymentTerms').trim() } : {}),
    lineItems,
  };
}
