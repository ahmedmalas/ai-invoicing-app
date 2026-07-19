import { z } from 'zod';

const money = z.number().nonnegative();
const positiveQty = z.number().positive();
const nonNegQty = z.number().nonnegative();

export const productGstStatusSchema = z.enum(['gst', 'gst_free']);
export const bundleKindSchema = z.enum(['kit', 'service_package', 'assembly']);
export const stockBucketSchema = z.enum([
  'on_hand',
  'available',
  'reserved',
  'incoming',
  'damaged',
  'returned',
]);
export const stockMovementTypeSchema = z.enum([
  'purchase_receipt',
  'invoice_issue',
  'job_consume',
  'manual_adjustment',
  'return',
  'transfer',
  'write_off',
  'stocktake_adjustment',
  'bundle_assembly',
  'reservation',
  'reservation_release',
]);
export const stocktakeTypeSchema = z.enum(['full', 'partial', 'cycle']);
export const stocktakeStatusSchema = z.enum([
  'Draft',
  'In Progress',
  'Submitted',
  'Approved',
  'Cancelled',
]);

export const createProductSchema = z.object({
  sku: z.string().min(1).max(64),
  barcode: z.string().min(1).max(128).optional().nullable(),
  qrPayload: z.string().min(1).max(512).optional().nullable(),
  name: z.string().min(1).max(200),
  description: z.string().max(4000).optional().nullable(),
  category: z.string().max(120).optional().nullable(),
  brand: z.string().max(120).optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  unitOfMeasure: z.string().min(1).max(32).default('ea'),
  costPrice: money.default(0),
  sellPrice: money.default(0),
  gstStatus: productGstStatusSchema.default('gst'),
  trackStock: z.boolean().default(true),
  minimumStockLevel: nonNegQty.default(0),
  reorderQuantity: nonNegQty.default(0),
  storageLocation: z.string().max(120).optional().nullable(),
  weight: z.number().nonnegative().optional().nullable(),
  lengthMm: z.number().nonnegative().optional().nullable(),
  widthMm: z.number().nonnegative().optional().nullable(),
  heightMm: z.number().nonnegative().optional().nullable(),
  imageUrl: z.string().url().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  isActive: z.boolean().default(true),
  isBundle: z.boolean().default(false),
  bundleKind: bundleKindSchema.optional().nullable(),
  openingStock: nonNegQty.optional(),
  bundleComponents: z
    .array(
      z.object({
        componentProductId: z.string().uuid(),
        quantity: positiveQty,
      }),
    )
    .optional(),
});

export const updateProductSchema = createProductSchema.partial().omit({ openingStock: true });

export const listProductsQuerySchema = z.object({
  q: z.string().min(1).optional(),
  sku: z.string().min(1).optional(),
  barcode: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  supplierId: z.string().uuid().optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  lowStock: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

export const adjustStockSchema = z.object({
  productId: z.string().uuid(),
  quantityDelta: z.number().refine((n) => n !== 0, 'quantityDelta must be non-zero'),
  movementType: stockMovementTypeSchema.default('manual_adjustment'),
  bucket: stockBucketSchema.default('on_hand'),
  unitCost: money.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  referenceType: z.string().max(64).optional().nullable(),
  referenceId: z.string().uuid().optional().nullable(),
});

export const transferStockSchema = z.object({
  productId: z.string().uuid(),
  quantity: positiveQty,
  fromBucket: stockBucketSchema,
  toBucket: stockBucketSchema,
  notes: z.string().max(2000).optional().nullable(),
});

export const receivePurchaseOrderSchema = z.object({
  lineItems: z
    .array(
      z.object({
        purchaseOrderLineItemId: z.string().uuid(),
        quantityReceived: positiveQty,
        productId: z.string().uuid().optional(),
      }),
    )
    .min(1),
  notes: z.string().max(2000).optional().nullable(),
});

export const createStocktakeSchema = z.object({
  type: stocktakeTypeSchema.default('full'),
  notes: z.string().max(2000).optional().nullable(),
  productIds: z.array(z.string().uuid()).optional(),
});

export const updateStocktakeCountsSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        countedQuantity: nonNegQty,
        notes: z.string().max(1000).optional().nullable(),
      }),
    )
    .min(1),
});

export const jobMaterialSchema = z.object({
  productId: z.string().uuid(),
  quantity: positiveQty,
  notes: z.string().max(1000).optional().nullable(),
});

export const setJobMaterialsSchema = z.object({
  materials: z.array(jobMaterialSchema).default([]),
});

export const lookupCodeSchema = z.object({
  code: z.string().min(1).max(128),
});
