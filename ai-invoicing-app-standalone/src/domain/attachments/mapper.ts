import { z } from 'zod';

import {
  ATTACHMENT_CATEGORIES,
  ATTACHMENT_PARENT_TYPES,
  JOB_PHOTO_STAGES,
  attachmentTransformSchema,
  defaultTransform,
  receiptOcrSchema,
  type AttachmentRecord,
} from './types.js';

export function mapAttachmentRow(
  row: Record<string, unknown>,
  options?: { includeContent?: boolean },
): AttachmentRecord {
  const tagsRaw: unknown =
    typeof row.tags_json === 'string' ? JSON.parse(row.tags_json) : row.tags_json;
  const tags = z.array(z.string()).catch([]).parse(tagsRaw ?? []);

  const transformRaw: unknown =
    typeof row.transform_json === 'string'
      ? JSON.parse(row.transform_json)
      : row.transform_json;
  const transform = attachmentTransformSchema.catch(defaultTransform()).parse(transformRaw ?? {});

  const ocrRaw: unknown =
    typeof row.receipt_ocr_json === 'string'
      ? JSON.parse(row.receipt_ocr_json)
      : row.receipt_ocr_json;
  let receiptOcr: AttachmentRecord['receiptOcr'] = null;
  if (ocrRaw != null) {
    const parsedOcr = receiptOcrSchema.safeParse(ocrRaw);
    receiptOcr = parsedOcr.success ? parsedOcr.data : null;
  }

  const stageRaw = row.job_photo_stage;
  let jobPhotoStage: AttachmentRecord['jobPhotoStage'] = null;
  if (stageRaw != null && stageRaw !== '') {
    const parsedStage = z.enum(JOB_PHOTO_STAGES).safeParse(stageRaw);
    jobPhotoStage = parsedStage.success ? parsedStage.data : null;
  }

  const record: AttachmentRecord = {
    id: String(row.id),
    parentEntityType: z.enum(ATTACHMENT_PARENT_TYPES).parse(row.parent_entity_type),
    parentEntityId: String(row.parent_entity_id),
    filename: String(row.filename),
    mimeType: String(row.mime_type),
    byteSize: Number(row.byte_size),
    category: z.enum(ATTACHMENT_CATEGORIES).parse(row.category),
    tags,
    caption: (row.caption as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    jobPhotoStage,
    gpsLatitude: row.gps_latitude == null ? null : Number(row.gps_latitude),
    gpsLongitude: row.gps_longitude == null ? null : Number(row.gps_longitude),
    capturedAt: (row.captured_at as string | null) ?? null,
    uploadedByUserId: (row.uploaded_by_user_id as string | null) ?? null,
    uploadedByName: (row.uploaded_by_name as string | null) ?? null,
    transform,
    receiptOcr,
    storageBackend: 'db_base64',
    checksumSha256: String(row.checksum_sha256),
    version: Number(row.version ?? 1),
    deletedAt: (row.deleted_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };

  if (options?.includeContent) {
    record.contentBase64 = (row.content_base64 as string | null) ?? null;
  }
  return record;
}

export const ATTACHMENT_LIST_COLUMNS = `
  id, parent_entity_type, parent_entity_id, filename, mime_type, byte_size, category,
  tags_json, caption, notes, job_photo_stage, gps_latitude, gps_longitude, captured_at,
  uploaded_by_user_id, uploaded_by_name, transform_json, receipt_ocr_json, storage_backend,
  checksum_sha256, version, deleted_at, created_at, updated_at
`;
