import { describe, expect, it } from 'vitest';

import {
  listInvoiceTitleControls,
  readCanonicalInvoiceTitle,
  syncCanonicalInvoiceTitle,
} from '../../public/invoice-title.js';
import {
  collectInvoiceWorkspacePayload,
  invoicePayloadIsAutosaveReady,
} from '../../public/invoice-workspace-payload.js';

type FakeControl = {
  name?: string;
  value: string;
  disabled?: boolean;
  isContentEditable?: boolean;
  textContent?: string;
  matches?: (selector: string) => boolean;
  getAttribute?: (name: string) => string | null;
};

function createTitleForm(options: {
  title?: string;
  hiddenTitle?: string;
  contentEditableTitle?: string;
  disableTitle?: boolean;
  customerId?: string;
  description?: string;
}) {
  const titleInput: FakeControl = {
    name: 'title',
    value: options.title ?? '',
    disabled: Boolean(options.disableTitle),
    isContentEditable: false,
    matches(selector: string) {
      return selector.includes('name="title"') || selector.includes('[name="title"]');
    },
    getAttribute(name: string) {
      if (name === 'name') return 'title';
      if (name === 'data-invoice-title') return '';
      return null;
    },
  };
  const hiddenTitle: FakeControl | null =
    options.hiddenTitle !== undefined
      ? {
          name: 'title',
          value: options.hiddenTitle,
          disabled: false,
          isContentEditable: false,
          matches() {
            return true;
          },
          getAttribute(name: string) {
            if (name === 'name') return 'title';
            return null;
          },
        }
      : null;
  const contentEditable: FakeControl | null =
    options.contentEditableTitle !== undefined
      ? {
          value: '',
          textContent: options.contentEditableTitle,
          isContentEditable: true,
          matches(selector: string) {
            return selector.includes('data-invoice-title');
          },
          getAttribute(name: string) {
            if (name === 'data-invoice-title-display') return '';
            if (name === 'contenteditable') return 'true';
            return null;
          },
        }
      : null;

  const customer: FakeControl = {
    name: 'customerId',
    value: options.customerId ?? '11111111-1111-4111-8111-111111111111',
  };
  const issueDate: FakeControl = { name: 'issueDate', value: '2026-07-22' };
  const endDate: FakeControl = { name: 'endDate', value: '2026-08-05' };
  const description: FakeControl = {
    name: 'description',
    value: options.description ?? 'Labour',
  };
  const quantity: FakeControl = { name: 'quantity', value: '1' };
  const unitPrice: FakeControl = { name: 'unitPrice', value: '100' };
  const gst: FakeControl = { name: 'gstApplicable', value: 'true' };

  const named = {
    title: titleInput,
    customerId: customer,
    issueDate,
    endDate,
  };

  const titleControls = [titleInput, hiddenTitle, contentEditable].filter(Boolean) as FakeControl[];

  const row = {
    querySelector(selector: string) {
      if (selector.includes('description')) return description;
      if (selector.includes('quantity')) return quantity;
      if (selector.includes('unitPrice')) return unitPrice;
      if (selector.includes('gstApplicable')) return gst;
      return null;
    },
  };

  const form = {
    ownerDocument: { activeElement: null as FakeControl | null },
    contains(node: unknown) {
      return titleControls.includes(node as FakeControl) || node === customer;
    },
    querySelector(selector: string) {
      const name = selector.match(/name="([^"]+)"/)?.[1];
      if (name && named[name as keyof typeof named]) return named[name as keyof typeof named];
      if (selector.includes('data-invoice-title') && !selector.includes('display')) return titleInput;
      return null;
    },
    querySelectorAll(selector: string) {
      if (
        selector.includes('name="title"') ||
        selector.includes('[data-invoice-title]') ||
        selector.includes('data-invoice-title-display')
      ) {
        return titleControls;
      }
      if (selector === '[data-invoice-line]') return [row];
      const name = selector.match(/name="([^"]+)"/)?.[1];
      if (name && named[name as keyof typeof named]) return [named[name as keyof typeof named]];
      return [];
    },
  };

  return { form, titleInput, hiddenTitle, contentEditable };
}

describe('invoice title canonical binding', () => {
  it('reads the visible title even when the title input is disabled (FormData would omit it)', () => {
    const { form, titleInput } = createTitleForm({
      title: 'Site Visit Title',
      disableTitle: true,
    });
    expect(titleInput.disabled).toBe(true);
    // Simulate what FormData would return for a disabled control.
    const formDataTitle = titleInput.disabled ? undefined : titleInput.value;
    expect(formDataTitle).toBeUndefined();

    const payload = collectInvoiceWorkspacePayload(form);
    expect(payload.title).toBe('Site Visit Title');
    expect(invoicePayloadIsAutosaveReady(payload)).toBe(true);
  });

  it('synchronises a contenteditable header into the canonical name="title" field', () => {
    const { form, titleInput, contentEditable } = createTitleForm({
      title: '',
      contentEditableTitle: 'Visible Header Name',
    });
    expect(titleInput.value).toBe('');
    const synced = syncCanonicalInvoiceTitle(form);
    expect(synced).toBe('Visible Header Name');
    expect(titleInput.value).toBe('Visible Header Name');
    expect(contentEditable?.textContent).toBe('Visible Header Name');
    expect(collectInvoiceWorkspacePayload(form).title).toBe('Visible Header Name');
  });

  it('does not allow a blank hidden duplicate to override a populated visible title', () => {
    const { form, titleInput, hiddenTitle } = createTitleForm({
      title: 'Keep This Title',
      hiddenTitle: '',
    });
    expect(listInvoiceTitleControls(form).length).toBe(2);
    const title = readCanonicalInvoiceTitle(form);
    expect(title).toBe('Keep This Title');
    expect(titleInput.value).toBe('Keep This Title');
    expect(hiddenTitle?.value).toBe('Keep This Title');
  });

  it('still rejects whitespace-only titles', () => {
    const { form } = createTitleForm({ title: '   ' });
    const payload = collectInvoiceWorkspacePayload(form);
    expect(payload.title).toBe('');
    expect(invoicePayloadIsAutosaveReady(payload)).toBe(false);
  });

  it('keeps the exact visible non-whitespace title in the submitted payload', () => {
    const { form } = createTitleForm({ title: '  Exact Visible Title  ' });
    const payload = collectInvoiceWorkspacePayload(form);
    expect(payload.title).toBe('Exact Visible Title');
  });
});
