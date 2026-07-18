import { z } from 'zod';

export const ATTACHMENT_PARENT_TYPES = [
  'customer',
  'job',
  'quote',
  'invoice',
  'expense',
  'payment',
  'product',
  'supplier',
  'vehicle',
  'employee',
  'equipment',
] as const;

export type AttachmentParentType = (typeof ATTACHMENT_PARENT_TYPES)[number];

export const JOB_PHOTO_STAGES = ['before', 'during', 'after', 'completed'] as const;
export type JobPhotoStage = (typeof JOB_PHOTO_STAGES)[number];

export const ATTACHMENT_CATEGORIES = [
  'receipt',
  'invoice',
  'job_photo',
  'warranty',
  'manual',
  'contract',
  'supporting',
  'other',
] as const;

export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];

export const SUPPORTED_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
] as const;

export const MAX_ATTACHMENT_BYTES = 4_500_000;

export const attachmentTransformSchema = z.object({
  rotationDeg: z.number().int().min(0).max(359).default(0),
  crop: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
    })
    .nullable()
    .default(null),
  annotations: z
    .array(
      z.object({
        id: z.string(),
        tool: z.enum(['pen', 'highlight', 'arrow', 'text']),
        color: z.string().max(32),
        points: z.array(z.object({ x: z.number(), y: z.number() })).max(2000),
        text: z.string().max(400).optional(),
      }),
    )
    .default([]),
});

export type AttachmentTransform = z.infer<typeof attachmentTransformSchema>;

export const receiptOcrSchema = z.object({
  merchant: z.string().max(200).nullable(),
  date: z.string().max(40).nullable(),
  total: z.number().nullable(),
  gst: z.number().nullable(),
  invoiceNumber: z.string().max(80).nullable(),
  referenceNumber: z.string().max(80).nullable(),
  confidence: z.number().min(0).max(1),
  rawTextPreview: z.string().max(2000).optional(),
});

export type ReceiptOcrResult = z.infer<typeof receiptOcrSchema>;

export interface AttachmentRecord {
  id: string;
  parentEntityType: AttachmentParentType;
  parentEntityId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  category: AttachmentCategory;
  tags: string[];
  caption: string | null;
  notes: string | null;
  jobPhotoStage: JobPhotoStage | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  capturedAt: string | null;
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  transform: AttachmentTransform;
  receiptOcr: ReceiptOcrResult | null;
  storageBackend: 'db_base64';
  checksumSha256: string;
  version: number;
  contentBase64?: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const uploadAttachmentSchema = z.object({
  parentEntityType: z.enum(ATTACHMENT_PARENT_TYPES),
  parentEntityId: z.string().min(1).max(80),
  filename: z.string().trim().min(1).max(260),
  mimeType: z.string().trim().min(1).max(120),
  contentBase64: z.string().min(1).max(6_500_000),
  category: z.enum(ATTACHMENT_CATEGORIES).default('supporting'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  caption: z.string().trim().max(400).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  jobPhotoStage: z.enum(JOB_PHOTO_STAGES).nullable().optional(),
  gpsLatitude: z.number().min(-90).max(90).nullable().optional(),
  gpsLongitude: z.number().min(-180).max(180).nullable().optional(),
  capturedAt: z.string().datetime().nullable().optional(),
  uploadedByName: z.string().trim().max(120).nullable().optional(),
  transform: attachmentTransformSchema.optional(),
  runReceiptOcr: z.boolean().optional(),
});

export type UploadAttachmentInput = z.infer<typeof uploadAttachmentSchema>;

export const updateAttachmentSchema = z.object({
  filename: z.string().trim().min(1).max(260).optional(),
  category: z.enum(ATTACHMENT_CATEGORIES).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  caption: z.string().trim().max(400).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  jobPhotoStage: z.enum(JOB_PHOTO_STAGES).nullable().optional(),
  gpsLatitude: z.number().min(-90).max(90).nullable().optional(),
  gpsLongitude: z.number().min(-180).max(180).nullable().optional(),
  capturedAt: z.string().datetime().nullable().optional(),
  transform: attachmentTransformSchema.optional(),
  receiptOcr: receiptOcrSchema.nullable().optional(),
});

export type UpdateAttachmentInput = z.infer<typeof updateAttachmentSchema>;

export const attachmentLibraryQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  parentEntityType: z.enum(ATTACHMENT_PARENT_TYPES).optional(),
  parentEntityId: z.string().max(80).optional(),
  category: z.enum(ATTACHMENT_CATEGORIES).optional(),
  tag: z.string().trim().max(40).optional(),
  mimeType: z.string().trim().max(120).optional(),
  jobPhotoStage: z.enum(JOB_PHOTO_STAGES).optional(),
  includeDeleted: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((value) => value === '1' || value === 'true'),
  deletedOnly: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((value) => value === '1' || value === 'true'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type AttachmentLibraryQuery = z.infer<typeof attachmentLibraryQuerySchema>;

export function normalizeAttachmentMime(mimeType: string, filename: string): string {
  const lower = mimeType.toLowerCase().trim();
  if (lower && lower !== 'application/octet-stream') {
    if (lower === 'image/jpg') return 'image/jpeg';
    return lower;
  }
  const ext = filename.toLowerCase().split('.').pop() || '';
  const byExt: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    heic: 'image/heic',
    heif: 'image/heif',
    webp: 'image/webp',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
  };
  return byExt[ext] || lower || 'application/octet-stream';
}

export function isSupportedAttachmentMime(mimeType: string, filename: string): boolean {
  const normalized = normalizeAttachmentMime(mimeType, filename);
  return (SUPPORTED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(normalized);
}

export function defaultTransform(): AttachmentTransform {
  return attachmentTransformSchema.parse({});
}
