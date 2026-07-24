import { z } from 'zod';

import {
  invoiceTemplateDesignSchema,
  type InvoiceTemplateDesign,
} from './invoice-template-design.js';

export const invoiceTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  isDefault: z.boolean(),
  design: invoiceTemplateDesignSchema,
  originalFilename: z.string().max(260).nullable(),
  originalMimeType: z.string().max(120).nullable(),
  /** Optional small preview data URL retained after import (not a full PDF vault). */
  originalPreviewDataUrl: z.string().max(900_000).nullable().optional(),
  source: z.enum(['imported', 'manual', 'duplicated']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type InvoiceTemplate = z.infer<typeof invoiceTemplateSchema>;

export const createInvoiceTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  isDefault: z.boolean().default(true),
  design: invoiceTemplateDesignSchema,
  originalFilename: z.string().max(260).nullable().optional(),
  originalMimeType: z.string().max(120).nullable().optional(),
  originalPreviewDataUrl: z.string().max(900_000).nullable().optional(),
  source: z.enum(['imported', 'manual', 'duplicated']).default('imported'),
  applyBusinessDefaults: z.boolean().default(false),
});

export type CreateInvoiceTemplateInput = z.infer<typeof createInvoiceTemplateSchema>;

export const updateInvoiceTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  isDefault: z.boolean().optional(),
  design: invoiceTemplateDesignSchema.optional(),
});

export type UpdateInvoiceTemplateInput = z.infer<typeof updateInvoiceTemplateSchema>;

export function omitOriginalPreview(template: InvoiceTemplate): InvoiceTemplate {
  const { originalPreviewDataUrl: _ignored, ...rest } = template;
  return { ...rest, originalPreviewDataUrl: null };
}

export type { InvoiceTemplateDesign };
