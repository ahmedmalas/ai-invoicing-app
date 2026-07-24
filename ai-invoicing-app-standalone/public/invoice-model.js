/**
 * Canonical invoice domain model (client).
 *
 * One editor state. One payload builder. No DOM scraping. No FormData.
 * All create / update / autosave / preview / download / finalise pathways
 * derive from buildInvoicePayload(editorState).
 */

import { calculateInvoiceTotals } from './invoice-totals.js';
import { normalizeInvoiceNumber } from './invoice-number.js';

export const INVOICE_MODEL_VERSION = 3;
export const GST_RATE = 0.1;
export const DEFAULT_CURRENCY = 'AUD';

/** @typedef {'Draft' | 'Finalised'} InvoiceStatus */

/**
 * @typedef {object} InvoiceLineItemState
 * @property {string} [id]
 * @property {string} description
 * @property {number} quantity
 * @property {number} unitPrice
 * @property {boolean} gstApplicable
 * @property {string | null} [productId]
 */

/**
 * @typedef {object} InvoiceEditorState
 * @property {string | null} id
 * @property {InvoiceStatus} status
 * @property {string} paymentState
 * @property {string | null} invoiceNumber
 * @property {string} title
 * @property {string} customerId
 * @property {string} issueDate
 * @property {string} dueDate
 * @property {string} currency
 * @property {InvoiceLineItemState[]} lineItems
 * @property {string} notes
 * @property {string} paymentTerms
 * @property {{ gstRate: number }} tax
 * @property {{ subtotal: number, gstTotal: number, total: number }} totals
 * @property {number} version
 * @property {string | null} updatedAt
 * @property {string | null} createdAt
 */

/**
 * @typedef {object} InvoiceCanonicalPayload
 * @property {string} customerId
 * @property {string} title
 * @property {string} issueDate
 * @property {string} dueDate
 * @property {string | null} invoiceNumber
 * @property {string} [notes]
 * @property {string} [paymentTerms]
 * @property {Array<{
 *   description: string,
 *   quantity: number,
 *   unitPrice: number,
 *   gstApplicable: boolean,
 *   productId?: string | null
 * }>} lineItems
 */

function todayOffset(offset = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
}

function asString(value) {
  if (value == null) return '';
  return String(value);
}

function normalizeLineItem(item = {}) {
  const quantity = Number(item.quantity);
  const unitPrice = Number(item.unitPrice);
  const gstApplicable =
    item.gstApplicable !== false &&
    item.gstApplicable !== 'false' &&
    item.gstApplicable !== 0 &&
    item.gstApplicable !== '0';
  /** @type {InvoiceLineItemState} */
  const line = {
    description: asString(item.description),
    quantity: Number.isFinite(quantity) ? quantity : 0,
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
    gstApplicable,
  };
  if (item.id) line.id = String(item.id);
  if ('productId' in item) {
    line.productId = item.productId == null || item.productId === '' ? null : String(item.productId);
  }
  return line;
}

/**
 * Explicit read-time normalisation for production-era / legacy stored shapes.
 * Old localStorage snapshots used `recordId` instead of `id`.
 * Some records omitted currency / tax / version.
 *
 * @param {unknown} record
 * @returns {object}
 */
export function normalizeLegacyInvoiceRecord(record) {
  if (!record || typeof record !== 'object') return {};
  const source = /** @type {Record<string, unknown>} */ (record);
  const id =
    (typeof source.id === 'string' && source.id) ||
    (typeof source.recordId === 'string' && source.recordId) ||
    null;
  const lineItemsRaw = Array.isArray(source.lineItems)
    ? source.lineItems
    : Array.isArray(source.lines)
      ? source.lines
      : [];
  return {
    ...source,
    id,
    title: asString(source.title ?? source.invoiceTitle ?? ''),
    customerId: asString(source.customerId ?? source.customer_id ?? ''),
    issueDate: asString(source.issueDate ?? source.issue_date ?? ''),
    dueDate: asString(source.dueDate ?? source.due_date ?? ''),
    notes: asString(source.notes ?? ''),
    paymentTerms: asString(source.paymentTerms ?? source.payment_terms ?? ''),
    templateId: asString(source.templateId ?? source.template_id ?? '') || null,
    invoiceNumber: normalizeInvoiceNumber(source.invoiceNumber ?? source.invoice_number),
    status: source.status === 'Finalised' ? 'Finalised' : 'Draft',
    paymentState: asString(source.paymentState ?? source.payment_state ?? 'Draft') || 'Draft',
    currency: asString(source.currency || DEFAULT_CURRENCY) || DEFAULT_CURRENCY,
    lineItems: lineItemsRaw.map((item) => normalizeLineItem(item)),
    updatedAt: source.updatedAt ? asString(source.updatedAt) : null,
    createdAt: source.createdAt ? asString(source.createdAt) : null,
  };
}

/**
 * @param {Partial<InvoiceEditorState> & Record<string, unknown>} [seed]
 * @returns {InvoiceEditorState}
 */
export function createEmptyEditorState(seed = {}) {
  const normalized = normalizeLegacyInvoiceRecord(seed);
  const lineItems =
    Array.isArray(normalized.lineItems) && normalized.lineItems.length
      ? normalized.lineItems.map((item) => normalizeLineItem(item))
      : [normalizeLineItem({ description: '', quantity: 1, unitPrice: 0, gstApplicable: true })];
  const { totals } = calculateInvoiceTotals(lineItems);
  return {
    id: normalized.id || null,
    status: normalized.status === 'Finalised' ? 'Finalised' : 'Draft',
    paymentState: normalized.paymentState || 'Draft',
    invoiceNumber: normalizeInvoiceNumber(normalized.invoiceNumber),
    title: asString(normalized.title),
    customerId: asString(normalized.customerId),
    issueDate: asString(normalized.issueDate) || todayOffset(0),
    dueDate: asString(normalized.dueDate) || todayOffset(14),
    currency: normalized.currency || DEFAULT_CURRENCY,
    lineItems,
    notes: asString(normalized.notes),
    paymentTerms: asString(normalized.paymentTerms),
    templateId: normalized.templateId || null,
    tax: { gstRate: GST_RATE },
    totals: {
      subtotal: totals.subtotal,
      gstTotal: totals.gstTotal,
      total: totals.total,
    },
    version: INVOICE_MODEL_VERSION,
    updatedAt: normalized.updatedAt || null,
    createdAt: normalized.createdAt || null,
  };
}

/**
 * Hydrate editor state from a server invoice or local snapshot.
 * @param {unknown} record
 * @returns {InvoiceEditorState}
 */
export function hydrateEditorState(record) {
  return createEmptyEditorState(normalizeLegacyInvoiceRecord(record));
}

/**
 * Recompute deterministic totals into state (immutable-style return).
 * @param {InvoiceEditorState} state
 * @returns {InvoiceEditorState}
 */
export function withRecalculatedTotals(state) {
  const { totals } = calculateInvoiceTotals(state.lineItems);
  return {
    ...state,
    totals: {
      subtotal: totals.subtotal,
      gstTotal: totals.gstTotal,
      total: totals.total,
    },
  };
}

/**
 * Patch editable fields. Disabling UI never touches this state.
 * @param {InvoiceEditorState} state
 * @param {Partial<InvoiceEditorState>} patch
 * @returns {InvoiceEditorState}
 */
export function patchEditorState(state, patch) {
  const next = {
    ...state,
    ...patch,
    lineItems: Array.isArray(patch.lineItems)
      ? patch.lineItems.map((item) => normalizeLineItem(item))
      : state.lineItems,
    tax: patch.tax ? { gstRate: Number(patch.tax.gstRate) || GST_RATE } : state.tax,
    invoiceNumber:
      'invoiceNumber' in patch
        ? normalizeInvoiceNumber(patch.invoiceNumber)
        : state.invoiceNumber,
  };
  return withRecalculatedTotals(next);
}

/**
 * Canonical payload for every network write / preview path.
 * Pure: does not read the DOM.
 *
 * @param {InvoiceEditorState} editorState
 * @returns {InvoiceCanonicalPayload}
 */
export function buildInvoicePayload(editorState) {
  if (!editorState || typeof editorState !== 'object') {
    throw new Error('Invoice editor state is missing.');
  }
  const lineItems = (editorState.lineItems || []).map((item) => {
    const line = {
      description: asString(item.description).trim(),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      gstApplicable: item.gstApplicable !== false,
    };
    if ('productId' in item) {
      line.productId = item.productId == null ? null : item.productId;
    }
    return line;
  });

  const notes = asString(editorState.notes).trim();
  const paymentTerms = asString(editorState.paymentTerms).trim();

  /** @type {InvoiceCanonicalPayload} */
  const payload = {
    customerId: asString(editorState.customerId).trim(),
    title: asString(editorState.title).trim(),
    issueDate: asString(editorState.issueDate).trim(),
    dueDate: asString(editorState.dueDate).trim(),
    invoiceNumber: normalizeInvoiceNumber(editorState.invoiceNumber),
    lineItems,
  };
  if (notes) payload.notes = notes;
  if (paymentTerms) payload.paymentTerms = paymentTerms;
  payload.templateId = asString(editorState.templateId).trim() || null;
  return payload;
}

/**
 * Narrow create body from the canonical payload (POST /api/invoices).
 * @param {InvoiceCanonicalPayload} payload
 */
export function toCreateDraftBody(payload) {
  const { invoiceNumber: _ignored, ...body } = payload;
  return body;
}

/**
 * Narrow update body from the canonical payload (PUT /api/invoices/:id).
 * @param {InvoiceCanonicalPayload} payload
 * @param {string} paymentState
 */
export function toUpdateDraftBody(payload, paymentState = 'Draft') {
  const { customerId: _customerId, invoiceNumber: _ignored, ...rest } = payload;
  return {
    ...rest,
    paymentState: paymentState || 'Draft',
  };
}

/**
 * Frontend validation for user feedback. Backend remains authoritative.
 * @param {InvoiceEditorState | InvoiceCanonicalPayload} input
 * @returns {{ ok: true, payload: InvoiceCanonicalPayload } | { ok: false, message: string, fieldPath: string }}
 */
export function validateInvoiceForSave(input) {
  const payload =
    'lineItems' in input && 'customerId' in input && !('status' in input && 'totals' in input)
      ? /** @type {InvoiceCanonicalPayload} */ (input)
      : buildInvoicePayload(/** @type {InvoiceEditorState} */ (input));

  if (!payload.customerId) {
    return { ok: false, message: 'Select a customer.', fieldPath: 'customerId' };
  }
  if (!payload.title) {
    return { ok: false, message: 'Invoice title is required.', fieldPath: 'title' };
  }
  if (!payload.issueDate) {
    return { ok: false, message: 'Issue date is required.', fieldPath: 'issueDate' };
  }
  if (!payload.dueDate) {
    return { ok: false, message: 'Due date is required.', fieldPath: 'dueDate' };
  }
  if (!Array.isArray(payload.lineItems) || !payload.lineItems.length) {
    return { ok: false, message: 'Add at least one line item.', fieldPath: 'lineItems' };
  }
  for (const item of payload.lineItems) {
    if (!item.description) {
      return { ok: false, message: 'Each line needs a description.', fieldPath: 'lineItems' };
    }
    if (!(Number(item.quantity) > 0)) {
      return { ok: false, message: 'Each line needs a positive quantity.', fieldPath: 'lineItems' };
    }
    if (!(Number(item.unitPrice) >= 0) || Number.isNaN(Number(item.unitPrice))) {
      return { ok: false, message: 'Each line needs a valid unit price.', fieldPath: 'lineItems' };
    }
  }
  return { ok: true, payload };
}

/**
 * Soft readiness check used by autosave (does not throw).
 * @param {InvoiceCanonicalPayload} payload
 */
export function payloadReadyForAutosave(payload) {
  return Boolean(
    payload?.customerId &&
      String(payload.title || '').trim() &&
      Array.isArray(payload.lineItems) &&
      payload.lineItems.length &&
      payload.lineItems.every(
        (item) => String(item.description || '').trim() && Number(item.quantity) > 0,
      ),
  );
}

/**
 * Local draft snapshot recoverable after refresh.
 * @param {unknown} snapshot
 */
export function snapshotRecoverable(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const normalized = normalizeLegacyInvoiceRecord(snapshot);
  const hasTitle = Boolean(String(normalized.title || '').trim());
  const hasCustomer = Boolean(String(normalized.customerId || '').trim());
  const hasLine = (normalized.lineItems || []).some((item) =>
    String(item?.description || '').trim(),
  );
  return hasTitle || hasCustomer || hasLine;
}

/**
 * Apply server record onto current editor state without losing in-flight typing
 * when the server echo matches (id / status / number sync).
 * @param {InvoiceEditorState} state
 * @param {unknown} saved
 * @returns {InvoiceEditorState}
 */
export function applySavedInvoice(state, saved) {
  const hydrated = hydrateEditorState(saved);
  return {
    ...state,
    id: hydrated.id,
    status: hydrated.status,
    paymentState: hydrated.paymentState,
    invoiceNumber: hydrated.invoiceNumber,
    title: hydrated.title,
    customerId: hydrated.customerId,
    issueDate: hydrated.issueDate,
    dueDate: hydrated.dueDate,
    notes: hydrated.notes,
    paymentTerms: hydrated.paymentTerms,
    templateId: hydrated.templateId ?? state.templateId ?? null,
    lineItems: hydrated.lineItems,
    totals: hydrated.totals,
    updatedAt: hydrated.updatedAt,
    createdAt: hydrated.createdAt,
  };
}
