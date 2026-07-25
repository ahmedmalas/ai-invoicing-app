import { describe, expect, it, beforeEach } from 'vitest';

import { resetAleyaRegistryForTests, getAleyaRegistry } from '../../src/ai/registry.js';
import { ensureAleyaToolsRegistered } from '../../src/ai/tools/register-all.js';

describe('Aleya AI action registry', () => {
  beforeEach(() => {
    resetAleyaRegistryForTests();
  });

  it('registers a broad M1 tool surface without a hardcoded intent list', () => {
    const registry = ensureAleyaToolsRegistered(getAleyaRegistry());
    const names = registry.names();
    expect(names.length).toBeGreaterThanOrEqual(28);
    for (const required of [
      'create_invoice_draft',
      'update_invoice_draft',
      'manage_invoice_lines',
      'search_invoices',
      'get_invoice',
      'duplicate_invoice',
      'reuse_previous_invoice',
      'finalise_invoice',
      'prepare_invoice_pdf',
      'prepare_invoice_email',
      'record_payment',
      'create_customer',
      'search_customers',
      'list_templates',
      'bulk_create_drafts_from_rows',
      'bulk_update_invoices',
      'undo_last_ai_edit',
      'list_registered_tools',
      'diagnose_invoice_issues',
    ]) {
      expect(names).toContain(required);
    }
  });

  it('marks irreversible tools as confirmation-required', () => {
    const registry = ensureAleyaToolsRegistered(getAleyaRegistry());
    expect(registry.get('finalise_invoice')?.confirmation).toBe('required');
    expect(registry.get('record_payment')?.confirmation).toBe('required');
    expect(registry.get('delete_invoice_draft')?.confirmation).toBe('required');
    expect(registry.get('create_invoice_draft')?.confirmation).toBe('none');
    expect(registry.get('manage_invoice_lines')?.confirmation).toBe('none');
  });

  it('exposes tools for dynamic discovery', async () => {
    const registry = ensureAleyaToolsRegistered(getAleyaRegistry());
    const listed = await registry.execute('list_registered_tools', {}, {
      db: {} as never,
      userId: 'test',
      organizationId: 'org',
      conversationId: 'conv',
      visibleState: {},
      approvedTokens: new Set(),
      requestConfirmation: () => {
        throw new Error('not expected');
      },
      pushUndo: async () => 'x',
      undoLast: async () => ({ ok: false, code: 'x', message: 'x' }),
      logAudit: async () => undefined,
      now: () => new Date(),
    });
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect((listed.data as { count: number }).count).toBeGreaterThanOrEqual(24);
    }
  });
});
