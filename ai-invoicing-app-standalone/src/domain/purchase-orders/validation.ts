import { z } from 'zod';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function isValidIsoCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const purchaseOrderLineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  gstApplicable: z.boolean(),
});

const draftBaseSchema = z.object({
  supplierId: z.string().uuid(),
  issueDate: isoDateSchema.refine(isValidIsoCalendarDate, 'issueDate must be a valid ISO date'),
  expectedDeliveryDate: isoDateSchema
    .refine(isValidIsoCalendarDate, 'expectedDeliveryDate must be a valid ISO date')
    .optional(),
  supplierReference: z.string().min(1).optional(),
  currency: z.string().min(3).max(3),
  notes: z.string().optional(),
  lineItems: z.array(purchaseOrderLineItemSchema).min(1),
});

export const createPurchaseOrderDraftSchema = draftBaseSchema;
export const updatePurchaseOrderDraftSchema = draftBaseSchema.omit({ supplierId: true });

export const listPurchaseOrdersQuerySchema = z
  .object({
    supplierId: z.string().uuid().optional(),
    purchaseOrderNumber: z.string().min(1).optional(),
    status: z.enum(['Draft', 'Approved', 'Closed', 'Cancelled']).optional(),
    billingStatus: z.enum(['unbilled', 'partially_billed', 'fully_billed']).optional(),
    fromIssueDate: isoDateSchema.refine(isValidIsoCalendarDate, 'fromIssueDate must be a valid ISO date').optional(),
    toIssueDate: isoDateSchema.refine(isValidIsoCalendarDate, 'toIssueDate must be a valid ISO date').optional(),
    fromExpectedDeliveryDate: isoDateSchema
      .refine(isValidIsoCalendarDate, 'fromExpectedDeliveryDate must be a valid ISO date')
      .optional(),
    toExpectedDeliveryDate: isoDateSchema
      .refine(isValidIsoCalendarDate, 'toExpectedDeliveryDate must be a valid ISO date')
      .optional(),
  })
  .refine((query) => !query.fromIssueDate || !query.toIssueDate || query.fromIssueDate <= query.toIssueDate, {
    message: 'fromIssueDate must be less than or equal to toIssueDate',
    path: ['fromIssueDate'],
  })
  .refine(
    (query) =>
      !query.fromExpectedDeliveryDate ||
      !query.toExpectedDeliveryDate ||
      query.fromExpectedDeliveryDate <= query.toExpectedDeliveryDate,
    {
      message: 'fromExpectedDeliveryDate must be less than or equal to toExpectedDeliveryDate',
      path: ['fromExpectedDeliveryDate'],
    },
  );

export const createSupplierBillFromPurchaseOrderSchema = z.object({
  lineItems: z
    .array(
      z.object({
        purchaseOrderLineItemId: z.string().uuid(),
        quantity: z.number().positive(),
      }),
    )
    .min(1)
    .optional(),
});

export const closePurchaseOrderSchema = z.object({
  closeReason: z.string().min(1).optional(),
  closedDate: isoDateSchema.refine(isValidIsoCalendarDate, 'closedDate must be a valid ISO date').optional(),
  closedBy: z.string().min(1).optional(),
});
