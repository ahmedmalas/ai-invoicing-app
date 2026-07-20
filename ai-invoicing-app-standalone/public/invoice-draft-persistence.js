/**
 * Client-side draft recovery for the invoice workspace.
 * Uses localStorage so drafts survive refresh and full browser restart
 * until a successful server save (or the user cancels/closes the workspace).
 */

export const INVOICE_DRAFT_STORAGE_KEY = 'aleya-invoice-workspace-draft-v1';

function defaultDraftStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readInvoiceDraftSnapshot(storage = defaultDraftStorage()) {
  try {
    const raw = storage?.getItem?.(INVOICE_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearInvoiceDraftSnapshot(storage = defaultDraftStorage()) {
  try {
    storage?.removeItem?.(INVOICE_DRAFT_STORAGE_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

function fieldValue(form, name) {
  const field = form?.querySelector?.(`[name="${name}"]`);
  return field?.value != null ? String(field.value) : '';
}

export function buildInvoiceDraftSnapshot(form, { recordId = null } = {}) {
  if (!form) return null;
  const lineItems = [...form.querySelectorAll('[data-invoice-line]')].map((row) => ({
    description: row.querySelector('[name="description"]')?.value ?? '',
    quantity: row.querySelector('[name="quantity"]')?.value ?? '1',
    unitPrice: row.querySelector('[name="unitPrice"]')?.value ?? '0',
    gstApplicable: row.querySelector('[name="gstApplicable"]')?.value ?? 'true',
  }));
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    recordId: recordId || form.dataset.recordId || null,
    pathname: globalThis.location?.pathname || '',
    customerId: fieldValue(form, 'customerId'),
    title: fieldValue(form, 'title'),
    issueDate: fieldValue(form, 'issueDate'),
    dueDate: fieldValue(form, 'endDate'),
    notes: fieldValue(form, 'notes'),
    paymentTerms: fieldValue(form, 'paymentTerms'),
    lineItems,
  };
}

export function writeInvoiceDraftSnapshot(form, options = {}, storage = defaultDraftStorage()) {
  const snapshot = buildInvoiceDraftSnapshot(form, options);
  if (!snapshot) return null;
  // Never poison a good local draft by overwriting a non-empty title/customer with blanks
  // after a remount or failed recovery.
  const previous = readInvoiceDraftSnapshot(storage);
  if (previous) {
    if (!String(snapshot.title || '').trim() && String(previous.title || '').trim()) {
      snapshot.title = previous.title;
    }
    if (!String(snapshot.customerId || '').trim() && String(previous.customerId || '').trim()) {
      snapshot.customerId = previous.customerId;
    }
    if (!snapshot.recordId && previous.recordId) {
      snapshot.recordId = previous.recordId;
    }
    const hasLines = (snapshot.lineItems || []).some((item) =>
      String(item?.description || '').trim(),
    );
    const previousHasLines = (previous.lineItems || []).some((item) =>
      String(item?.description || '').trim(),
    );
    if (!hasLines && previousHasLines) {
      snapshot.lineItems = previous.lineItems;
    }
  }
  try {
    storage?.setItem?.(INVOICE_DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* ignore quota / private mode */
  }
  return snapshot;
}

export function snapshotLooksRecoverable(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const hasTitle = Boolean(String(snapshot.title || '').trim());
  const hasCustomer = Boolean(String(snapshot.customerId || '').trim());
  const hasLine = (snapshot.lineItems || []).some((item) => String(item?.description || '').trim());
  return hasTitle || hasCustomer || hasLine;
}

export function applyInvoiceDraftSnapshot(form, snapshot) {
  if (!form || !snapshot) return false;
  const setValue = (name, value) => {
    const field = form.querySelector(`[name="${name}"]`);
    if (field != null && value != null && value !== '') field.value = value;
  };
  setValue('customerId', snapshot.customerId);
  setValue('title', snapshot.title);
  setValue('issueDate', snapshot.issueDate);
  setValue('endDate', snapshot.dueDate);
  setValue('notes', snapshot.notes);
  setValue('paymentTerms', snapshot.paymentTerms);
  if (snapshot.recordId) form.dataset.recordId = snapshot.recordId;

  const body = form.querySelector('[data-invoice-lines]');
  const lines = Array.isArray(snapshot.lineItems) ? snapshot.lineItems : [];
  if (body && lines.length) {
    body.innerHTML = lines
      .map((item, index) => {
        const gst = item.gstApplicable === false || item.gstApplicable === 'false' ? 'false' : 'true';
        return (
          '<tr class="invoice-line" data-invoice-line data-line-index="' +
          index +
          '" draggable="true">' +
          '<td class="invoice-line-handle" title="Drag to reorder"><button type="button" class="icon-button" data-line-drag tabindex="-1" aria-label="Reorder line">⋮⋮</button></td>' +
          '<td><input name="description" value="' +
          escapeAttr(item.description) +
          '" required placeholder="Description of work or goods" autocomplete="off"></td>' +
          '<td><input name="quantity" type="number" min="0.01" step="0.01" value="' +
          escapeAttr(item.quantity || 1) +
          '" required></td>' +
          '<td><input name="unitPrice" type="number" min="0" step="0.01" value="' +
          escapeAttr(item.unitPrice || 0) +
          '" required></td>' +
          '<td><select name="gstApplicable"><option value="true"' +
          (gst === 'true' ? ' selected' : '') +
          '>GST</option><option value="false"' +
          (gst === 'false' ? ' selected' : '') +
          '>No GST</option></select></td>' +
          '<td class="invoice-line-total" data-line-total></td>' +
          '<td class="invoice-line-actions">' +
          '<button type="button" class="icon-button" data-line-up aria-label="Move line up">↑</button>' +
          '<button type="button" class="icon-button" data-line-down aria-label="Move line down">↓</button>' +
          '<button type="button" class="icon-button" data-remove-invoice-line aria-label="Delete line">×</button>' +
          '</td></tr>'
        );
      })
      .join('');
  }
  return true;
}

function escapeAttr(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
