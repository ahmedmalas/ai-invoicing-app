import { describe, expect, it } from 'vitest';

import {
  scoreTransactionMatches,
  selectAutoAllocations,
} from '../../src/domain/reconciliation/matching.js';
import type { MatchableInvoice } from '../../src/domain/reconciliation/matching.js';

const invoice = (overrides: Partial<MatchableInvoice> = {}): MatchableInvoice => ({
  invoiceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  invoiceNumber: 'INV-1001',
  customerId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  customerName: 'Acme Plumbing',
  issueDate: '2026-07-01',
  dueDate: '2026-07-15',
  title: 'Kitchen reno',
  outstanding: 150,
  ...overrides,
});

describe('bank matching engine', () => {
  it('scores high confidence when invoice number and exact amount match', () => {
    const suggestions = scoreTransactionMatches(
      {
        bookedDate: '2026-07-16',
        amount: 150,
        description: 'Payment for INV-1001',
        reference: 'INV-1001',
        counterpartyName: 'Acme Plumbing',
      },
      [invoice()],
    );

    expect(suggestions[0]?.confidenceBand).toBe('high');
    expect(suggestions[0]?.confidence).toBeGreaterThanOrEqual(0.85);
    expect(selectAutoAllocations(150, suggestions)).toHaveLength(1);
  });

  it('keeps medium confidence for customer+amount without invoice number', () => {
    const suggestions = scoreTransactionMatches(
      {
        bookedDate: '2026-07-16',
        amount: 150,
        description: 'Transfer from Acme Plumbing',
        reference: null,
        counterpartyName: 'Acme Plumbing',
      },
      [invoice()],
    );

    expect(suggestions[0]?.confidenceBand).toBe('medium');
    expect(selectAutoAllocations(150, suggestions)).toHaveLength(0);
  });

  it('supports partial payments against outstanding balance', () => {
    const suggestions = scoreTransactionMatches(
      {
        bookedDate: '2026-07-16',
        amount: 50,
        description: 'Deposit INV-1001',
        reference: 'INV-1001',
        counterpartyName: 'Acme Plumbing',
      },
      [invoice({ outstanding: 150 })],
    );

    expect(suggestions[0]?.amount).toBe(50);
    expect(suggestions[0]?.reasons.some((reason) => /partial/i.test(reason))).toBe(true);
  });

  it('can stack multiple high-confidence invoices for one deposit', () => {
    const suggestions = scoreTransactionMatches(
      {
        bookedDate: '2026-07-18',
        amount: 200,
        description: 'INV-1001 INV-1002 Acme Plumbing',
        reference: 'BATCH',
        counterpartyName: 'Acme Plumbing',
      },
      [
        invoice({ invoiceNumber: 'INV-1001', outstanding: 120 }),
        invoice({
          invoiceId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          invoiceNumber: 'INV-1002',
          outstanding: 80,
        }),
      ],
    );

    const auto = selectAutoAllocations(200, suggestions);
    expect(auto.length).toBeGreaterThanOrEqual(1);
    expect(auto.reduce((sum, item) => sum + item.amount, 0)).toBeCloseTo(200, 2);
  });
});
