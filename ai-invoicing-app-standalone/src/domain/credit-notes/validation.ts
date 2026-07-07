import { z } from 'zod';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function isValidIsoCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const creditNoteLineItemSchema = z.object({
  description: z.string().min(1),
  amount: z.number().positive(),
});

export const createCreditNoteSchema = z
  .object({
    linkedInvoiceId: z.string().uuid(),
    issueDate: isoDateSchema.refine(isValidIsoCalendarDate, 'issueDate must be a valid ISO date'),
    reason: z.string().min(1),
    type: z.enum(['Full', 'Partial']),
    lineItems: z.array(creditNoteLineItemSchema).optional(),
    adjustmentAmount: z.number().positive().optional(),
  })
  .refine(
    (body) => {
      if (body.type === 'Full') {
        return true;
      }
      return (body.lineItems && body.lineItems.length > 0) || body.adjustmentAmount !== undefined;
    },
    {
      message: 'Partial credit requires lineItems or adjustmentAmount',
      path: ['lineItems'],
    },
  );
