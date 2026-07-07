import { z } from 'zod';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function isValidIsoCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const paymentAllocationSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().positive(),
});

export const createCustomerPaymentSchema = z
  .object({
    customerId: z.string().uuid(),
    paymentDate: isoDateSchema.refine(isValidIsoCalendarDate, 'paymentDate must be a valid ISO date'),
    paymentMethod: z.string().min(1),
    reference: z.string().min(1),
    amount: z.number().positive(),
    notes: z.string().optional(),
    allocations: z.array(paymentAllocationSchema).min(1),
  })
  .refine(
    (body) => body.allocations.reduce((sum, allocation) => sum + allocation.amount, 0) <= body.amount,
    {
      message: 'allocation total must be less than or equal to payment amount',
      path: ['allocations'],
    },
  );

export const listCustomerPaymentsQuerySchema = z
  .object({
    customerId: z.string().uuid().optional(),
    invoiceId: z.string().uuid().optional(),
    from: isoDateSchema.refine(isValidIsoCalendarDate, 'from must be a valid ISO date').optional(),
    to: isoDateSchema.refine(isValidIsoCalendarDate, 'to must be a valid ISO date').optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'from must be less than or equal to to',
    path: ['from'],
  });
