import { calculateInvoiceTotals, calculateLineItem, readLineItemsFromForm } from './invoice-totals.js';

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const money = (value) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(value || 0));

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

export function invoiceWorkspaceLineRow(item = {}, index = 0) {
  const calculated = calculateLineItem(item);
  return (
    '<tr class="invoice-line" data-invoice-line data-line-index="' +
    index +
    '" draggable="true">' +
    '<td class="invoice-line-handle" title="Drag to reorder"><button type="button" class="icon-button" data-line-drag tabindex="-1" aria-label="Reorder line">⋮⋮</button></td>' +
    '<td><input name="description" value="' +
    escapeHtml(calculated.description) +
    '" required placeholder="Description of work or goods" autocomplete="off"></td>' +
    '<td><input name="quantity" type="number" min="0.01" step="0.01" value="' +
    escapeHtml(calculated.quantity || 1) +
    '" required></td>' +
    '<td><input name="unitPrice" type="number" min="0" step="0.01" value="' +
    escapeHtml(calculated.unitPrice || 0) +
    '" required></td>' +
    '<td><select name="gstApplicable"><option value="true"' +
    (calculated.gstApplicable ? ' selected' : '') +
    '>GST</option><option value="false"' +
    (!calculated.gstApplicable ? ' selected' : '') +
    '>No GST</option></select></td>' +
    '<td class="invoice-line-total" data-line-total>' +
    money(calculated.lineTotal) +
    '</td>' +
    '<td class="invoice-line-actions">' +
    '<button type="button" class="icon-button" data-line-up aria-label="Move line up">↑</button>' +
    '<button type="button" class="icon-button" data-line-down aria-label="Move line down">↓</button>' +
    '<button type="button" class="icon-button" data-remove-invoice-line aria-label="Delete line">×</button>' +
    '</td></tr>'
  );
}

export function refreshInvoiceWorkspaceTotals(form) {
  if (!form) return { totals: { subtotal: 0, gstTotal: 0, total: 0 } };
  const { calculatedItems, totals } = calculateInvoiceTotals(readLineItemsFromForm(form));
  form.querySelectorAll('[data-invoice-line]').forEach((row, index) => {
    const totalCell = row.querySelector('[data-line-total]');
    if (totalCell) totalCell.textContent = money(calculatedItems[index]?.lineTotal || 0);
    row.dataset.lineIndex = String(index);
  });
  const subtotalEl = form.querySelector('[data-total-subtotal]');
  const gstEl = form.querySelector('[data-total-gst]');
  const grandEl = form.querySelector('[data-total-grand]');
  if (subtotalEl) subtotalEl.textContent = money(totals.subtotal);
  if (gstEl) gstEl.textContent = money(totals.gstTotal);
  if (grandEl) grandEl.textContent = money(totals.total);
  return { calculatedItems, totals };
}

export function reindexInvoiceLines(form) {
  const body = form?.querySelector('[data-invoice-lines]');
  if (!body) return;
  [...body.querySelectorAll('[data-invoice-line]')].forEach((row, index) => {
    row.dataset.lineIndex = String(index);
  });
}

export function moveInvoiceLine(form, row, direction) {
  if (!form || !row) return false;
  const body = form.querySelector('[data-invoice-lines]');
  if (!body) return false;
  if (direction < 0 && row.previousElementSibling) {
    body.insertBefore(row, row.previousElementSibling);
  } else if (direction > 0 && row.nextElementSibling) {
    body.insertBefore(row.nextElementSibling, row);
  } else {
    return false;
  }
  reindexInvoiceLines(form);
  refreshInvoiceWorkspaceTotals(form);
  row.querySelector('[name="description"]')?.focus();
  return true;
}

export function buildInvoiceWorkspaceHtml({
  profile = {},
  customers = [],
  record = null,
  moneyFormat = money,
}) {
  const editing = Boolean(record);
  const status = record?.paymentState || record?.status || 'Draft';
  const invoiceNumber = record?.invoiceNumber || 'Draft';
  const lines = record?.lineItems?.length
    ? record.lineItems.map((item, index) => invoiceWorkspaceLineRow(item, index)).join('')
    : invoiceWorkspaceLineRow({}, 0);
  const customer = customers.find((item) => item.id === record?.customerId);
  const customerControl = editing
    ? '<input type="hidden" name="customerId" value="' +
      escapeHtml(record.customerId) +
      '"><div class="invoice-billto-static"><strong>' +
      escapeHtml(customer?.displayName || 'Customer') +
      '</strong>' +
      (customer?.address ? '<span>' + escapeHtml(customer.address) + '</span>' : '') +
      (customer?.email ? '<span>' + escapeHtml(customer.email) + '</span>' : '') +
      (customer?.phone ? '<span>' + escapeHtml(customer.phone) + '</span>' : '') +
      (customer?.abnTaxId ? '<span>ABN ' + escapeHtml(customer.abnTaxId) + '</span>' : '') +
      '</div>'
    : '<label class="invoice-field">Customer<select name="customerId" required data-customer-select><option value="">Select customer</option>' +
      customerOptionsHtml(customers, record?.customerId) +
      '</select></label><div class="invoice-billto-preview" data-customer-preview><span class="muted">Customer details appear after selection.</span></div>';

  const { totals } = calculateInvoiceTotals(record?.lineItems || [{ quantity: 1, unitPrice: 0, gstApplicable: true }]);

  return (
    '<div class="invoice-curtain" data-invoice-curtain aria-hidden="true">' +
    '<form class="invoice-workspace" id="invoice-workspace-form" data-record-id="' +
    escapeHtml(record?.id || '') +
    '" data-payment-state="' +
    escapeHtml(record?.paymentState || 'Draft') +
    '" data-status="' +
    escapeHtml(record?.status || 'Draft') +
    '">' +
    '<header class="invoice-toolbar">' +
    '<div class="invoice-toolbar-brand"><span class="brand-mark">A</span><div><strong>Aleya Invoicing</strong><small>Tax invoice workspace</small></div></div>' +
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
    '<div class="invoice-logo brand-mark">A</div>' +
    '<div><h1>' +
    escapeHtml(profile.companyName || 'Your business name') +
    '</h1>' +
    '<p>' +
    escapeHtml(profile.legalName || profile.companyName || '') +
    '</p>' +
    (profile.abnTaxId ? '<p>ABN ' + escapeHtml(profile.abnTaxId) + '</p>' : '') +
    (profile.address ? '<p>' + escapeHtml(profile.address) + '</p>' : '') +
    (profile.email || profile.phone
      ? '<p>' +
        escapeHtml([profile.email, profile.phone].filter(Boolean).join(' · ')) +
        '</p>'
      : '') +
    '</div></div>' +
    '<div class="invoice-meta">' +
    '<p class="invoice-doc-title">TAX INVOICE</p>' +
    '<dl>' +
    '<div><dt>Invoice</dt><dd data-invoice-number>' +
    escapeHtml(invoiceNumber) +
    '</dd></div>' +
    '<div><dt>Status</dt><dd><span class="status ' +
    escapeHtml(String(status).replaceAll(' ', '-')) +
    '">' +
    escapeHtml(status) +
    '</span></dd></div>' +
    '<div><dt>Issue date</dt><dd><input name="issueDate" type="date" required value="' +
    escapeHtml(record?.issueDate || '') +
    '"></dd></div>' +
    '<div><dt>Due date</dt><dd><input name="endDate" type="date" required value="' +
    escapeHtml(record?.dueDate || '') +
    '"></dd></div>' +
    '</dl></div></section>' +
    '<section class="invoice-section">' +
    '<div class="invoice-section-grid">' +
    '<div><h2>Bill To</h2>' +
    customerControl +
    '</div>' +
    '<div><h2>Invoice title</h2><label class="invoice-field"><input name="title" required value="' +
    escapeHtml(record?.title || '') +
    '" placeholder="Short job or invoice title"></label></div>' +
    '</div></section>' +
    '<section class="invoice-section">' +
    '<div class="invoice-section-head"><h2>Line items</h2>' +
    '<button type="button" class="button secondary small" data-add-invoice-line>Add line</button></div>' +
    '<div class="invoice-table-wrap"><table class="invoice-lines-table"><thead><tr>' +
    '<th class="narrow"></th><th>Description</th><th>Qty</th><th>Unit Price</th><th>GST</th><th>Total</th><th class="narrow"></th>' +
    '</tr></thead><tbody data-invoice-lines>' +
    lines +
    '</tbody></table></div></section>' +
    '<section class="invoice-footer-grid">' +
    '<div class="invoice-notes-block">' +
    '<label class="invoice-field">Notes<textarea name="notes" rows="4" placeholder="Notes for the customer">' +
    escapeHtml(record?.notes || '') +
    '</textarea></label>' +
    '<label class="invoice-field">Payment terms<input name="paymentTerms" value="' +
    escapeHtml(record?.paymentTerms || '') +
    '" placeholder="e.g. Payment due within 14 days"></label>' +
    '<div class="invoice-bank"><h3>Bank details</h3>' +
    (profile.companyName || profile.abnTaxId || profile.email
      ? '<p>' +
        escapeHtml(profile.companyName || 'Business') +
        (profile.abnTaxId ? '<br>ABN ' + escapeHtml(profile.abnTaxId) : '') +
        (profile.email ? '<br>' + escapeHtml(profile.email) : '') +
        (profile.phone ? '<br>' + escapeHtml(profile.phone) : '') +
        '</p><p class="muted">Update bank account instructions in notes if required.</p>'
      : '<p class="muted">Add your business profile in Settings to show payment details here.</p>') +
    '</div></div>' +
    '<aside class="invoice-totals" aria-live="polite">' +
    '<div><span>Subtotal</span><strong data-total-subtotal>' +
    moneyFormat(totals.subtotal) +
    '</strong></div>' +
    '<div><span>GST</span><strong data-total-gst>' +
    moneyFormat(totals.gstTotal) +
    '</strong></div>' +
    '<div class="invoice-grand"><span>Grand Total</span><strong data-total-grand>' +
    moneyFormat(totals.total) +
    '</strong></div>' +
    '</aside></section>' +
    '</div></form></div>'
  );
}

export function customerPreviewHtml(customer) {
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

export function bindInvoiceWorkspaceInteractions(form, { onToast } = {}) {
  if (!form || form.dataset.bound === 'true') return;
  form.dataset.bound = 'true';

  let dragRow = null;

  form.addEventListener('input', (event) => {
    if (event.target.closest('[data-invoice-line], [name="title"], [name="notes"], [name="paymentTerms"]')) {
      refreshInvoiceWorkspaceTotals(form);
    }
  });
  form.addEventListener('change', (event) => {
    if (event.target.matches('[name="gstApplicable"], [name="customerId"]')) {
      refreshInvoiceWorkspaceTotals(form);
    }
    if (event.target.matches('[name="customerId"]')) {
      const preview = form.querySelector('[data-customer-preview]');
      if (!preview) return;
      const option = event.target.selectedOptions?.[0];
      const customer = option
        ? {
            displayName: option.textContent || '',
            id: option.value,
          }
        : null;
      // Full customer details are filled by the host via data-customer-preview updates.
      if (!customer?.id) preview.innerHTML = customerPreviewHtml(null);
    }
  });

  form.addEventListener('click', (event) => {
    if (event.target.closest('[data-add-invoice-line]')) {
      const body = form.querySelector('[data-invoice-lines]');
      const index = body?.querySelectorAll('[data-invoice-line]').length || 0;
      body?.insertAdjacentHTML('beforeend', invoiceWorkspaceLineRow({}, index));
      refreshInvoiceWorkspaceTotals(form);
      body?.querySelector('[data-invoice-line]:last-child [name="description"]')?.focus();
      return;
    }
    const remove = event.target.closest('[data-remove-invoice-line]');
    if (remove) {
      const rows = form.querySelectorAll('[data-invoice-line]');
      if (rows.length <= 1) {
        onToast?.('A tax invoice needs at least one line item.', true);
        return;
      }
      remove.closest('[data-invoice-line]')?.remove();
      reindexInvoiceLines(form);
      refreshInvoiceWorkspaceTotals(form);
      return;
    }
    const up = event.target.closest('[data-line-up]');
    if (up) {
      moveInvoiceLine(form, up.closest('[data-invoice-line]'), -1);
      return;
    }
    const down = event.target.closest('[data-line-down]');
    if (down) {
      moveInvoiceLine(form, down.closest('[data-invoice-line]'), 1);
    }
  });

  form.addEventListener('keydown', (event) => {
    const row = event.target.closest?.('[data-invoice-line]');
    if (!row) return;
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      moveInvoiceLine(form, row, -1);
    } else if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      moveInvoiceLine(form, row, 1);
    } else if (event.key === 'Enter' && event.target.matches('input, select')) {
      event.preventDefault();
      const fields = [...row.querySelectorAll('input, select')];
      const index = fields.indexOf(event.target);
      if (index >= 0 && index < fields.length - 1) fields[index + 1].focus();
      else {
        const next = row.nextElementSibling?.querySelector('input, select');
        if (next) next.focus();
        else form.querySelector('[data-add-invoice-line]')?.click();
      }
    }
  });

  form.addEventListener('dragstart', (event) => {
    dragRow = event.target.closest('[data-invoice-line]');
    if (!dragRow) return;
    dragRow.classList.add('is-dragging');
    event.dataTransfer?.setData('text/plain', dragRow.dataset.lineIndex || '0');
    event.dataTransfer.effectAllowed = 'move';
  });
  form.addEventListener('dragend', () => {
    dragRow?.classList.remove('is-dragging');
    dragRow = null;
    form.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
  });
  form.addEventListener('dragover', (event) => {
    const over = event.target.closest('[data-invoice-line]');
    if (!dragRow || !over || over === dragRow) return;
    event.preventDefault();
    form.querySelectorAll('.drag-over').forEach((node) => node.classList.remove('drag-over'));
    over.classList.add('drag-over');
  });
  form.addEventListener('drop', (event) => {
    const over = event.target.closest('[data-invoice-line]');
    if (!dragRow || !over || over === dragRow) return;
    event.preventDefault();
    const body = form.querySelector('[data-invoice-lines]');
    const rows = [...body.querySelectorAll('[data-invoice-line]')];
    const from = rows.indexOf(dragRow);
    const to = rows.indexOf(over);
    if (from < to) body.insertBefore(dragRow, over.nextElementSibling);
    else body.insertBefore(dragRow, over);
    reindexInvoiceLines(form);
    refreshInvoiceWorkspaceTotals(form);
  });

  refreshInvoiceWorkspaceTotals(form);
}

export { calculateInvoiceTotals, readLineItemsFromForm, money as formatMoney, escapeHtml };
