import { z } from 'zod';

import {
  DOCUMENT_TEMPLATE_TARGETS,
  invoiceTemplateDesignSchema,
  type DocumentTemplateTarget,
  type InvoiceTemplateDesign,
} from './invoice-template-design.js';

export interface InvoiceTemplate {
  id: string;
  name: string;
  isDefault: boolean;
  design: InvoiceTemplateDesign;
  originalFilename: string | null;
  originalMimeType: string | null;
  /** Present when listing with includeOriginal; omitted from list summaries. */
  originalFileBase64?: string | null;
  businessEntityId: string | null;
  documentTargets: DocumentTemplateTarget[];
  source: 'imported' | 'manual' | 'duplicated';
  createdAt: string;
  updatedAt: string;
}

export const createInvoiceTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  design: invoiceTemplateDesignSchema,
  isDefault: z.boolean().optional(),
  originalFilename: z.string().max(260).nullable().optional(),
  originalMimeType: z.string().max(120).nullable().optional(),
  originalFileBase64: z.string().max(6_500_000).nullable().optional(),
  businessEntityId: z.string().max(80).nullable().optional(),
  documentTargets: z.array(z.enum(DOCUMENT_TEMPLATE_TARGETS)).min(1).optional(),
  source: z.enum(['imported', 'manual', 'duplicated']).optional(),
  applyBusinessDefaults: z.boolean().optional(),
});

export const updateInvoiceTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  design: invoiceTemplateDesignSchema.optional(),
  isDefault: z.boolean().optional(),
  businessEntityId: z.string().max(80).nullable().optional(),
  documentTargets: z.array(z.enum(DOCUMENT_TEMPLATE_TARGETS)).min(1).optional(),
  applyBusinessDefaults: z.boolean().optional(),
});

export type CreateInvoiceTemplateInput = z.infer<typeof createInvoiceTemplateSchema>;
export type UpdateInvoiceTemplateInput = z.infer<typeof updateInvoiceTemplateSchema>;

export function mapInvoiceTemplateRow(
  row: Record<string, unknown>,
  options?: { includeOriginal?: boolean },
): InvoiceTemplate {
  const designJson: unknown =
    typeof row.design_json === 'string' ? JSON.parse(row.design_json) : row.design_json;
  const design = invoiceTemplateDesignSchema.parse(designJson);
  const targetsRaw: unknown =
    typeof row.document_targets_json === 'string'
      ? JSON.parse(row.document_targets_json)
      : row.document_targets_json;
  const documentTargets = z.array(z.enum(DOCUMENT_TEMPLATE_TARGETS)).parse(targetsRaw);
  const template: InvoiceTemplate = {
    id: String(row.id),
    name: String(row.name),
    isDefault: Number(row.is_default) === 1 || row.is_default === true,
    design,
    originalFilename: (row.original_filename as string | null) ?? null,
    originalMimeType: (row.original_mime_type as string | null) ?? null,
    businessEntityId: (row.business_entity_id as string | null) ?? null,
    documentTargets,
    source: z.enum(['imported', 'manual', 'duplicated']).parse(row.source),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
  if (options?.includeOriginal) {
    template.originalFileBase64 = (row.original_file_base64 as string | null) ?? null;
  }
  return template;
}

export const DEFAULT_DOCUMENT_TARGETS: DocumentTemplateTarget[] = [
  'invoice',
  'quote',
  'credit_note',
  'statement',
  'receipt',
];
