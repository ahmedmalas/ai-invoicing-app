import { readLineItemsFromForm } from './invoice-totals.js';
import {
  readCanonicalInvoiceTitle,
  readNamedFormValue,
  syncCanonicalInvoiceTitle,
} from './invoice-title.js';

/**
 * Build the create/update invoice body from the live workspace form.
 * Reads control `.value` (and contenteditable text) — never FormData alone —
 * so disabled fields and title mirrors stay bound to the visible header.
 */
export function collectInvoiceWorkspacePayload(form) {
  syncCanonicalInvoiceTitle(form);
  const title = readCanonicalInvoiceTitle(form);
  const customerId = readNamedFormValue(form, 'customerId');
  const issueDate = readNamedFormValue(form, 'issueDate');
  const dueDate = readNamedFormValue(form, 'endDate');
  const notes = readNamedFormValue(form, 'notes');
  const paymentTerms = readNamedFormValue(form, 'paymentTerms');
  const lineItems = readLineItemsFromForm(form);
  if (!lineItems.length) throw new Error('Add at least one line item.');
  if (lineItems.some((item) => !item.description)) throw new Error('Each line needs a description.');
  return {
    customerId,
    title,
    issueDate,
    dueDate,
    ...(notes ? { notes } : {}),
    ...(paymentTerms ? { paymentTerms } : {}),
    lineItems,
  };
}

export function invoicePayloadIsAutosaveReady(body) {
  return Boolean(
    body?.customerId &&
      String(body.title || '').trim() &&
      Array.isArray(body.lineItems) &&
      body.lineItems.length &&
      body.lineItems.every((item) => String(item.description || '').trim() && Number(item.quantity) > 0),
  );
}
