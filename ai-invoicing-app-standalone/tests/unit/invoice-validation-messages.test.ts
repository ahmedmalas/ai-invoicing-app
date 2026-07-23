import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ZodError } from 'zod';

const createDraftSchema = z.object({
  customerId: z.string().uuid(),
  title: z.string().trim().min(1, 'Invoice title is required.'),
  issueDate: z.string().min(1, 'Issue date is required.'),
  dueDate: z.string().min(1, 'Due date is required.'),
  lineItems: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
        gstApplicable: z.boolean(),
      }),
    )
    .min(1, 'Add at least one line item.'),
});

function validationMessageFromZod(error: ZodError): string {
  const titleIssue = error.issues.find((issue) => issue.path[0] === 'title');
  return titleIssue ? 'Invoice title is required.' : error.issues[0]?.message || 'Validation failed';
}

describe('invoice validation messages', () => {
  it('returns a field-level title message for empty title', () => {
    const result = createDraftSchema.safeParse({
      customerId: '11111111-1111-4111-8111-111111111111',
      title: '',
      issueDate: '2026-07-20',
      dueDate: '2026-08-03',
      lineItems: [
        {
          description: 'Labour',
          quantity: 1,
          unitPrice: 100,
          gstApplicable: true,
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(validationMessageFromZod(result.error)).toBe('Invoice title is required.');
    expect(result.error.issues[0]?.path).toEqual(['title']);
  });

  it('accepts a complete valid create payload', () => {
    const result = createDraftSchema.safeParse({
      customerId: '11111111-1111-4111-8111-111111111111',
      title: 'Site visit',
      issueDate: '2026-07-20',
      dueDate: '2026-08-03',
      lineItems: [
        {
          description: 'Labour',
          quantity: 1,
          unitPrice: 100,
          gstApplicable: true,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects whitespace-only titles with the Invoice title message', () => {
    const result = createDraftSchema.safeParse({
      customerId: '11111111-1111-4111-8111-111111111111',
      title: '   ',
      issueDate: '2026-07-20',
      dueDate: '2026-08-03',
      lineItems: [
        {
          description: 'Labour',
          quantity: 1,
          unitPrice: 100,
          gstApplicable: true,
        },
      ],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(validationMessageFromZod(result.error)).toBe('Invoice title is required.');
    expect(validationMessageFromZod(result.error)).not.toMatch(/^nvoice/i);
  });
});
