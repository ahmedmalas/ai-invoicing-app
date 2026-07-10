import { z } from 'zod';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function isValidIsoCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const supplierSchema = z.object({
  displayName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  taxId: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
});

export const supplierBillLineItemSchema = z.object({
  id: z.string().uuid().optional(),
  sourcePurchaseOrderLineItemId: z.string().uuid().optional(),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  gstApplicable: z.boolean(),
}).strict();

const supplierBillDraftBaseSchema = z.object({
  supplierId: z.string().uuid(),
  billDate: isoDateSchema.refine(isValidIsoCalendarDate, 'billDate must be a valid ISO date'),
  dueDate: isoDateSchema.refine(isValidIsoCalendarDate, 'dueDate must be a valid ISO date'),
  supplierReference: z.string().min(1).optional(),
  currency: z.string().min(3).max(3),
  notes: z.string().optional(),
  lineItems: z.array(supplierBillLineItemSchema).min(1),
}).strict();

export const createSupplierBillDraftSchema = supplierBillDraftBaseSchema;

export const updateSupplierBillDraftSchema = supplierBillDraftBaseSchema.omit({ supplierId: true });

export const listSupplierBillsQuerySchema = z
  .object({
    supplierId: z.string().uuid().optional(),
    sourcePurchaseOrderId: z.string().uuid().optional(),
    billNumber: z.string().min(1).optional(),
    fromBillDate: isoDateSchema.refine(isValidIsoCalendarDate, 'fromBillDate must be a valid ISO date').optional(),
    toBillDate: isoDateSchema.refine(isValidIsoCalendarDate, 'toBillDate must be a valid ISO date').optional(),
    fromDueDate: isoDateSchema.refine(isValidIsoCalendarDate, 'fromDueDate must be a valid ISO date').optional(),
    toDueDate: isoDateSchema.refine(isValidIsoCalendarDate, 'toDueDate must be a valid ISO date').optional(),
    status: z.enum(['Draft', 'Finalised']).optional(),
    paymentState: z.enum(['Draft', 'Sent', 'Awaiting Payment', 'Paid', 'Cancelled']).optional(),
  })
  .refine((query) => !query.fromBillDate || !query.toBillDate || query.fromBillDate <= query.toBillDate, {
    message: 'fromBillDate must be less than or equal to toBillDate',
    path: ['fromBillDate'],
  })
  .refine((query) => !query.fromDueDate || !query.toDueDate || query.fromDueDate <= query.toDueDate, {
    message: 'fromDueDate must be less than or equal to toDueDate',
    path: ['fromDueDate'],
  });
