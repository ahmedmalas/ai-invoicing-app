import { describe, expect, it } from 'vitest';

import { createCreditNoteSchema } from '../../src/domain/credit-notes/validation.js';

describe('credit note validation', () => {
  it('accepts full credit payload', () => {
    const parsed = createCreditNoteSchema.parse({
      linkedInvoiceId: '550e8400-e29b-41d4-a716-446655440000',
      issueDate: '2026-07-07',
      reason: 'Full reversal',
      type: 'Full',
    });
    expect(parsed.type).toBe('Full');
  });

  it('rejects partial credit without amounts', () => {
    expect(() =>
      createCreditNoteSchema.parse({
        linkedInvoiceId: '550e8400-e29b-41d4-a716-446655440000',
        issueDate: '2026-07-07',
        reason: 'Invalid partial',
        type: 'Partial',
      }),
    ).toThrow('Partial credit requires lineItems or adjustmentAmount');
  });
});
