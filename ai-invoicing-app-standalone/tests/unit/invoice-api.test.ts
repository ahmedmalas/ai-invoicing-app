import { afterEach, describe, expect, it } from 'vitest';

import { createInvoiceApiClient } from '../../public/invoice-api.js';
import {
  buildInvoicePayload,
  createEmptyEditorState,
  toCreateDraftBody,
  toUpdateDraftBody,
} from '../../public/invoice-model.js';

const CUSTOMER = '11111111-1111-4111-8111-111111111111';

describe('invoice API client', () => {
  const calls: Array<{ path: string; options?: object }> = [];

  afterEach(() => {
    calls.length = 0;
  });

  function client(overrides: Record<string, unknown> = {}) {
    return createInvoiceApiClient({
      api: async (path, options) => {
        if (options === undefined) {
          calls.push({ path });
        } else {
          calls.push({ path, options });
        }
        const method =
          options && typeof options === 'object' && 'method' in options
            ? String((options as { method?: string }).method || '')
            : '';
        const bodyText =
          options && typeof options === 'object' && 'body' in options
            ? String((options as { body?: unknown }).body ?? '')
            : '';
        if (path === '/api/invoices' && method === 'POST') {
          return {
            id: '55555555-5555-4555-8555-555555555555',
            status: 'Draft',
            invoiceNumber: null,
            lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
            ...JSON.parse(bodyText),
          };
        }
        if (path.startsWith('/api/invoices/') && method === 'PUT') {
          return {
            id: path.split('/')[3],
            status: 'Draft',
            invoiceNumber: null,
            lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
            ...JSON.parse(bodyText),
          };
        }
        if (path.startsWith('/api/invoices/') && !method) {
          return {
            id: path.split('/')[3],
            status: 'Draft',
            invoiceNumber: null,
            title: 'Loaded',
            lineItems: [],
          };
        }
        return { ok: true };
      },
      ...overrides,
    });
  }

  it('create and update both derive from buildInvoicePayload transforms', async () => {
    const state = createEmptyEditorState({
      customerId: CUSTOMER,
      title: 'API job',
      issueDate: '2026-07-22',
      dueDate: '2026-08-05',
      lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
    });
    const canonical = buildInvoicePayload(state);
    await client().createDraft(state);
    expect(calls[0]?.path).toBe('/api/invoices');
    expect(JSON.parse(String((calls[0]?.options as { body: string }).body))).toEqual(
      toCreateDraftBody(canonical),
    );

    const withId = { ...state, id: '55555555-5555-4555-8555-555555555555' };
    await client().updateDraft(withId);
    expect(calls[1]?.path).toBe('/api/invoices/55555555-5555-4555-8555-555555555555');
    expect(JSON.parse(String((calls[1]?.options as { body: string }).body))).toEqual(
      toUpdateDraftBody(canonical, 'Draft'),
    );
  });

  it('rejects empty title before calling the network', async () => {
    const state = createEmptyEditorState({
      customerId: CUSTOMER,
      title: '   ',
      issueDate: '2026-07-22',
      dueDate: '2026-08-05',
      lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
    });
    await expect(client().createDraft(state)).rejects.toThrow(/title is required/i);
    expect(calls).toHaveLength(0);
  });

  it('finalise and delete use dedicated endpoints', async () => {
    const api = client();
    await api.finaliseInvoice('55555555-5555-4555-8555-555555555555');
    await api.deleteDraft('55555555-5555-4555-8555-555555555555');
    expect(calls.map((call) => [call.path, (call.options as { method?: string } | undefined)?.method])).toEqual([
      ['/api/invoices/55555555-5555-4555-8555-555555555555/finalise', 'POST'],
      ['/api/invoices/55555555-5555-4555-8555-555555555555', 'DELETE'],
    ]);
  });
});
