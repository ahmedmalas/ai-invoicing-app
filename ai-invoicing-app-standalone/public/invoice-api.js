/**
 * Canonical invoice API client.
 *
 * UI handlers must not each implement fetch / error parsing.
 * All write bodies must come from buildInvoicePayload → typed transforms.
 */

import {
  buildInvoicePayload,
  toCreateDraftBody,
  toUpdateDraftBody,
  validateInvoiceForSave,
} from './invoice-model.js';
import { assertPayloadMatchesVisibleInvoiceNumber } from './invoice-number.js';

/**
 * @param {object} deps
 * @param {(path: string, options?: object) => Promise<any>} deps.api
 * @param {(id: string) => Promise<void>} [deps.previewPdf]
 * @param {(id: string) => Promise<string>} [deps.downloadPdf]
 */
export function createInvoiceApiClient(deps) {
  async function createDraft(editorState) {
    const validated = validateInvoiceForSave(editorState);
    if (!validated.ok) {
      const error = new Error(validated.message);
      error.status = 400;
      error.fieldPath = validated.fieldPath;
      throw error;
    }
    assertPayloadMatchesVisibleInvoiceNumber(
      validated.payload,
      editorState.invoiceNumber,
    );
    return deps.api('/api/invoices', {
      method: 'POST',
      body: JSON.stringify(toCreateDraftBody(validated.payload)),
    });
  }

  async function updateDraft(editorState) {
    if (!editorState?.id) {
      throw new Error('Cannot update an invoice without an id.');
    }
    const validated = validateInvoiceForSave(editorState);
    if (!validated.ok) {
      const error = new Error(validated.message);
      error.status = 400;
      error.fieldPath = validated.fieldPath;
      throw error;
    }
    assertPayloadMatchesVisibleInvoiceNumber(
      validated.payload,
      editorState.invoiceNumber,
    );
    return deps.api('/api/invoices/' + editorState.id, {
      method: 'PUT',
      body: JSON.stringify(
        toUpdateDraftBody(validated.payload, editorState.paymentState || 'Draft'),
      ),
    });
  }

  async function saveDraft(editorState) {
    if (editorState?.status === 'Finalised') {
      const error = new Error('Only draft invoices can be edited');
      error.status = 400;
      throw error;
    }
    let saved = editorState?.id
      ? await updateDraft(editorState)
      : await createDraft(editorState);
    if (!Array.isArray(saved.lineItems)) {
      saved = await readInvoice(saved.id);
    }
    return saved;
  }

  async function readInvoice(invoiceId) {
    return deps.api('/api/invoices/' + invoiceId);
  }

  async function deleteDraft(invoiceId) {
    await deps.api('/api/invoices/' + invoiceId, { method: 'DELETE' });
  }

  async function finaliseInvoice(invoiceId) {
    return deps.api('/api/invoices/' + invoiceId + '/finalise', { method: 'POST' });
  }

  async function previewPdf(invoiceId) {
    if (!deps.previewPdf) throw new Error('PDF preview is not configured.');
    return deps.previewPdf(invoiceId);
  }

  async function downloadPdf(invoiceId) {
    if (!deps.downloadPdf) throw new Error('PDF download is not configured.');
    return deps.downloadPdf(invoiceId);
  }

  /**
   * Ensure a persisted invoice exists for PDF, using the same payload builder
   * as save / autosave when a dirty draft must be written first.
   */
  async function ensurePersistedForPdf(editorState, { isDirty, persist }) {
    const payload = buildInvoicePayload(editorState);
    assertPayloadMatchesVisibleInvoiceNumber(payload, editorState.invoiceNumber);
    const validated = validateInvoiceForSave(payload);
    if (!validated.ok) {
      const error = new Error(validated.message);
      error.status = 400;
      error.fieldPath = validated.fieldPath;
      throw error;
    }
    if (editorState.id && (editorState.status === 'Finalised' || !isDirty)) {
      const saved = await readInvoice(editorState.id);
      assertPayloadMatchesVisibleInvoiceNumber(
        { ...payload, invoiceNumber: saved.invoiceNumber ?? null },
        saved.invoiceNumber ?? null,
      );
      return saved;
    }
    return persist();
  }

  return {
    createDraft,
    updateDraft,
    saveDraft,
    readInvoice,
    deleteDraft,
    finaliseInvoice,
    previewPdf,
    downloadPdf,
    ensurePersistedForPdf,
  };
}
