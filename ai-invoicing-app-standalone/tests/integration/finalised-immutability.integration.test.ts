import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/db/database.js';

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('finalised invoice immutability at persistence level', () => {
  it('blocks direct SQL mutation of immutable finalised invoice data', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ai-business-os-immutability-'));
    createdDirs.push(tempDir);
    const dbPath = join(tempDir, 'immutability.sqlite');

    const appDb = createDatabase(dbPath);
    const customer = appDb.createCustomer({ displayName: 'Immutability Pty Ltd' });
    const draft = appDb.createInvoiceDraft({
      customerId: customer.id,
      title: 'Immutable invoice',
      issueDate: '2026-07-07',
      dueDate: '2026-07-21',
      notes: 'Original notes',
      paymentTerms: '14 days',
      lineItems: [{ description: 'Dev', quantity: 2, unitPrice: 100, gstApplicable: true }],
    });
    const finalised = appDb.finaliseInvoice(draft.id);

    const raw = new Database(dbPath);

    expect(() =>
      raw.prepare('UPDATE invoices SET notes = ? WHERE id = ?').run('Tamper attempt', finalised.id),
    ).toThrow(/IMMUTABLE_FINALISED_INVOICE/);

    expect(() =>
      raw
        .prepare('UPDATE invoices SET issue_date = ?, due_date = ? WHERE id = ?')
        .run('2026-01-01', '2026-01-10', finalised.id),
    ).toThrow(/IMMUTABLE_FINALISED_INVOICE/);

    expect(() =>
      raw
        .prepare(
          'UPDATE invoice_line_items SET description = ? WHERE invoice_id = ?',
        )
        .run('Changed line', finalised.id),
    ).toThrow(/IMMUTABLE_FINALISED_INVOICE_LINE_ITEMS/);

    expect(() =>
      raw
        .prepare(
          'INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, gst_applicable, line_subtotal, line_gst, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'line-insert-test',
          finalised.id,
          'Injected',
          1,
          1,
          0,
          1,
          0,
          1,
        ),
    ).toThrow(/IMMUTABLE_FINALISED_INVOICE_LINE_ITEMS/);

    expect(() =>
      raw
        .prepare('DELETE FROM invoice_line_items WHERE invoice_id = ?')
        .run(finalised.id),
    ).toThrow(/IMMUTABLE_FINALISED_INVOICE_LINE_ITEMS/);

    expect(() =>
      raw
        .prepare('UPDATE invoice_snapshots SET snapshot_json = ? WHERE invoice_id = ?')
        .run('{"tampered":true}', finalised.id),
    ).toThrow(/IMMUTABLE_INVOICE_SNAPSHOT/);

    expect(() =>
      raw.prepare('DELETE FROM invoice_snapshots WHERE invoice_id = ?').run(finalised.id),
    ).toThrow(/IMMUTABLE_INVOICE_SNAPSHOT/);

    expect(() =>
      raw
        .prepare('INSERT INTO invoice_snapshots (id, invoice_id, snapshot_json, created_at) VALUES (?, ?, ?, ?)')
        .run('extra-snapshot', finalised.id, '{"tampered":true}', new Date().toISOString()),
    ).toThrow(/IMMUTABLE_INVOICE_SNAPSHOT/);

    expect(() =>
      raw.prepare('UPDATE documents SET title = ? WHERE entity_id = ?').run('Tampered doc', finalised.id),
    ).toThrow(/IMMUTABLE_FINALISED_INVOICE_DOCUMENT/);

    expect(() =>
      raw.prepare('DELETE FROM documents WHERE entity_id = ?').run(finalised.id),
    ).toThrow(/IMMUTABLE_FINALISED_INVOICE_DOCUMENT/);

    expect(() =>
      raw
        .prepare(
          'INSERT INTO documents (id, document_type, title, entity_id, searchable_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'extra-doc',
          'invoice',
          'Injected document',
          finalised.id,
          'Injected',
          new Date().toISOString(),
          new Date().toISOString(),
        ),
    ).toThrow(/IMMUTABLE_FINALISED_INVOICE_DOCUMENT/);

    expect(() =>
      raw.prepare('DELETE FROM invoices WHERE id = ?').run(finalised.id),
    ).toThrow(/IMMUTABLE_FINALISED_INVOICE/);

    const otherDraft = appDb.createInvoiceDraft({
      customerId: customer.id,
      title: 'Other draft',
      issueDate: '2026-07-08',
      dueDate: '2026-07-22',
      lineItems: [{ description: 'Other', quantity: 1, unitPrice: 50, gstApplicable: false }],
    });
    const movableLine = raw
      .prepare('SELECT id FROM invoice_line_items WHERE invoice_id = ? LIMIT 1')
      .get(otherDraft.id) as { id: string };
    expect(() =>
      raw
        .prepare('UPDATE invoice_line_items SET invoice_id = ? WHERE id = ?')
        .run(finalised.id, movableLine.id),
    ).toThrow(/IMMUTABLE_FINALISED_INVOICE_LINE_ITEMS/);

    raw.prepare('UPDATE invoices SET payment_state = ? WHERE id = ?').run('Paid', finalised.id);
    raw.prepare('UPDATE invoices SET reminder_state = ? WHERE id = ?').run('Stopped', finalised.id);

    const persisted = appDb.getInvoiceById(finalised.id);
    expect(persisted?.paymentState).toBe('Paid');
    expect(persisted?.reminderState).toBe('Stopped');
    expect(persisted?.notes).toBe('Original notes');

    raw.close();
    appDb.close();
  });
});
