import { describe, expect, it } from 'vitest';

function isInvoiceWorkspacePath(path: string) {
  return path === '/workspace/invoices/new' || /^\/workspace\/invoices\/[^/]+\/edit$/.test(path);
}

function parseInvoiceWorkspacePath(path: string) {
  if (path === '/workspace/invoices/new') return { mode: 'create', id: null };
  const match = path.match(/^\/workspace\/invoices\/([^/]+)\/edit$/);
  if (match) return { mode: 'edit', id: match[1] };
  return null;
}

describe('invoice workspace routing', () => {
  it('recognises create and edit workspace paths without using the drawer', () => {
    expect(isInvoiceWorkspacePath('/workspace/invoices/new')).toBe(true);
    expect(isInvoiceWorkspacePath('/workspace/invoices/inv_123/edit')).toBe(true);
    expect(isInvoiceWorkspacePath('/workspace/invoices')).toBe(false);
    expect(isInvoiceWorkspacePath('/workspace/customers')).toBe(false);
  });

  it('parses create and edit routes for the full-page editor', () => {
    expect(parseInvoiceWorkspacePath('/workspace/invoices/new')).toEqual({
      mode: 'create',
      id: null,
    });
    expect(parseInvoiceWorkspacePath('/workspace/invoices/abc-uuid/edit')).toEqual({
      mode: 'edit',
      id: 'abc-uuid',
    });
    expect(parseInvoiceWorkspacePath('/workspace/invoices')).toBeNull();
  });
});
