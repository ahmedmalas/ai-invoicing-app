import { createHash, randomUUID } from 'node:crypto';

import { ATTACHMENT_LIST_COLUMNS, mapAttachmentRow } from '../domain/attachments/mapper.js';
import {
  defaultTransform,
  isSupportedAttachmentMime,
  MAX_ATTACHMENT_BYTES,
  normalizeAttachmentMime,
  type AttachmentLibraryQuery,
  type AttachmentRecord,
  type UpdateAttachmentInput,
  type UploadAttachmentInput,
} from '../domain/attachments/types.js';
import {
  extractReceiptFields,
  extractTextForReceiptOcr,
} from '../domain/attachments/receipt-ocr.js';
import type { TimelineEventKey } from '../domain/timeline/taxonomy.js';

type Stmt = {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown;
};

export interface AttachmentSql {
  prepare: (sql: string) => Stmt;
}

export interface AttachmentStoreHelpers {
  nowIso: () => string;
  timeline: (eventKey: TimelineEventKey, entityId: string, payload: unknown) => void | Promise<void>;
  uploadedByUserId?: string | null;
}

async function maybeAwait<T>(value: T | Promise<T>): Promise<T> {
  return await value;
}

function checksumOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createAttachmentStore(sql: AttachmentSql, helpers: AttachmentStoreHelpers) {
  async function getAttachmentById(
    id: string,
    options?: { includeContent?: boolean; includeDeleted?: boolean },
  ): Promise<AttachmentRecord | null> {
    const row = (await maybeAwait(
      sql
        .prepare(
          options?.includeContent
            ? `SELECT *, content_base64 FROM attachments WHERE id = ?`
            : `SELECT ${ATTACHMENT_LIST_COLUMNS} FROM attachments WHERE id = ?`,
        )
        .get(id),
    )) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (!options?.includeDeleted && row.deleted_at) return null;
    return mapAttachmentRow(
      row,
      options?.includeContent ? { includeContent: true } : undefined,
    );
  }

  async function listAttachments(query: AttachmentLibraryQuery): Promise<{
    attachments: AttachmentRecord[];
    count: number;
    totalBytes: number;
  }> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (query.deletedOnly) {
      where.push('deleted_at IS NOT NULL');
    } else if (!query.includeDeleted) {
      where.push('deleted_at IS NULL');
    }
    if (query.parentEntityType) {
      where.push('parent_entity_type = ?');
      params.push(query.parentEntityType);
    }
    if (query.parentEntityId) {
      where.push('parent_entity_id = ?');
      params.push(query.parentEntityId);
    }
    if (query.category) {
      where.push('category = ?');
      params.push(query.category);
    }
    if (query.mimeType) {
      where.push('mime_type = ?');
      params.push(query.mimeType);
    }
    if (query.jobPhotoStage) {
      where.push('job_photo_stage = ?');
      params.push(query.jobPhotoStage);
    }
    if (query.tag) {
      where.push('tags_json LIKE ?');
      params.push(`%${query.tag}%`);
    }
    if (query.q) {
      where.push(
        '(filename LIKE ? OR IFNULL(caption, \'\') LIKE ? OR IFNULL(notes, \'\') LIKE ? OR tags_json LIKE ?)',
      );
      const like = `%${query.q}%`;
      params.push(like, like, like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRow = (await maybeAwait(
      sql
        .prepare(
          `SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS total_bytes
           FROM attachments ${whereSql}`,
        )
        .get(...params),
    )) as { count: number; total_bytes: number };
    const rows = (await maybeAwait(
      sql
        .prepare(
          `SELECT ${ATTACHMENT_LIST_COLUMNS}
           FROM attachments
           ${whereSql}
           ORDER BY created_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, query.limit, query.offset),
    )) as Record<string, unknown>[];

    return {
      attachments: rows.map((row) => mapAttachmentRow(row)),
      count: Number(countRow?.count ?? 0),
      totalBytes: Number(countRow?.total_bytes ?? 0),
    };
  }

  async function uploadAttachment(input: UploadAttachmentInput): Promise<AttachmentRecord> {
    const mimeType = normalizeAttachmentMime(input.mimeType, input.filename);
    if (!isSupportedAttachmentMime(mimeType, input.filename)) {
      throw new Error('UNSUPPORTED_ATTACHMENT_FORMAT');
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(input.contentBase64, 'base64');
    } catch {
      throw new Error('INVALID_ATTACHMENT_PAYLOAD');
    }
    if (!bytes.length) throw new Error('EMPTY_ATTACHMENT_FILE');
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('ATTACHMENT_FILE_TOO_LARGE');

    const id = randomUUID();
    const now = helpers.nowIso();
    const transform = input.transform ?? defaultTransform();
    let receiptOcr = null;
    const shouldOcr =
      input.runReceiptOcr === true ||
      input.category === 'receipt' ||
      input.parentEntityType === 'expense';
    if (shouldOcr) {
      const text = await extractTextForReceiptOcr(mimeType, bytes);
      receiptOcr = extractReceiptFields(text);
    }

    await maybeAwait(
      sql
        .prepare(
          `INSERT INTO attachments (
             id, parent_entity_type, parent_entity_id, filename, mime_type, byte_size, category,
             tags_json, caption, notes, job_photo_stage, gps_latitude, gps_longitude, captured_at,
             uploaded_by_user_id, uploaded_by_name, transform_json, receipt_ocr_json, storage_backend,
             content_base64, checksum_sha256, version, deleted_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
        )
        .run(
          id,
          input.parentEntityType,
          input.parentEntityId,
          input.filename,
          mimeType,
          bytes.length,
          input.category,
          JSON.stringify(input.tags ?? []),
          input.caption ?? null,
          input.notes ?? null,
          input.jobPhotoStage ?? null,
          input.gpsLatitude ?? null,
          input.gpsLongitude ?? null,
          input.capturedAt ?? null,
          helpers.uploadedByUserId ?? null,
          input.uploadedByName ?? null,
          JSON.stringify(transform),
          receiptOcr ? JSON.stringify(receiptOcr) : null,
          'db_base64',
          input.contentBase64,
          checksumOf(bytes),
          now,
          now,
        ),
    );

    await maybeAwait(
      sql
        .prepare(
          `INSERT INTO attachment_versions (
             id, attachment_id, version, filename, mime_type, byte_size, content_base64,
             checksum_sha256, transform_json, created_at, created_by_user_id
           ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          id,
          input.filename,
          mimeType,
          bytes.length,
          input.contentBase64,
          checksumOf(bytes),
          JSON.stringify(transform),
          now,
          helpers.uploadedByUserId ?? null,
        ),
    );

    await helpers.timeline('attachment.uploaded', id, {
      parentEntityType: input.parentEntityType,
      parentEntityId: input.parentEntityId,
      filename: input.filename,
      category: input.category,
      jobPhotoStage: input.jobPhotoStage ?? null,
    });
    await helpers.timeline('attachment.linked', input.parentEntityId, {
      attachmentId: id,
      parentEntityType: input.parentEntityType,
      filename: input.filename,
      category: input.category,
    });

    const created = await getAttachmentById(id, { includeContent: false });
    if (!created) throw new Error('ATTACHMENT_CREATE_FAILED');
    return created;
  }

  async function updateAttachment(
    id: string,
    input: UpdateAttachmentInput,
  ): Promise<AttachmentRecord> {
    const existing = await getAttachmentById(id, { includeContent: true, includeDeleted: false });
    if (!existing) throw new Error('ATTACHMENT_NOT_FOUND');
    const now = helpers.nowIso();
    const nextVersion = existing.version + 1;
    const filename = input.filename ?? existing.filename;
    const transform = input.transform ?? existing.transform;
    const receiptOcr =
      input.receiptOcr === undefined ? existing.receiptOcr : input.receiptOcr;

    await maybeAwait(
      sql
        .prepare(
          `UPDATE attachments SET
             filename = ?,
             category = ?,
             tags_json = ?,
             caption = ?,
             notes = ?,
             job_photo_stage = ?,
             gps_latitude = ?,
             gps_longitude = ?,
             captured_at = ?,
             transform_json = ?,
             receipt_ocr_json = ?,
             version = ?,
             updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(
          filename,
          input.category ?? existing.category,
          JSON.stringify(input.tags ?? existing.tags),
          input.caption === undefined ? existing.caption : input.caption,
          input.notes === undefined ? existing.notes : input.notes,
          input.jobPhotoStage === undefined ? existing.jobPhotoStage : input.jobPhotoStage,
          input.gpsLatitude === undefined ? existing.gpsLatitude : input.gpsLatitude,
          input.gpsLongitude === undefined ? existing.gpsLongitude : input.gpsLongitude,
          input.capturedAt === undefined ? existing.capturedAt : input.capturedAt,
          JSON.stringify(transform),
          receiptOcr ? JSON.stringify(receiptOcr) : null,
          nextVersion,
          now,
          id,
        ),
    );

    await maybeAwait(
      sql
        .prepare(
          `INSERT INTO attachment_versions (
             id, attachment_id, version, filename, mime_type, byte_size, content_base64,
             checksum_sha256, transform_json, created_at, created_by_user_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          id,
          nextVersion,
          filename,
          existing.mimeType,
          existing.byteSize,
          existing.contentBase64 ?? null,
          existing.checksumSha256,
          JSON.stringify(transform),
          now,
          helpers.uploadedByUserId ?? null,
        ),
    );

    await helpers.timeline('attachment.updated', id, {
      parentEntityType: existing.parentEntityType,
      parentEntityId: existing.parentEntityId,
      version: nextVersion,
    });

    const updated = await getAttachmentById(id);
    if (!updated) throw new Error('ATTACHMENT_NOT_FOUND');
    return updated;
  }

  async function softDeleteAttachment(id: string): Promise<void> {
    const existing = await getAttachmentById(id);
    if (!existing) throw new Error('ATTACHMENT_NOT_FOUND');
    const now = helpers.nowIso();
    await maybeAwait(
      sql
        .prepare(
          `UPDATE attachments SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(now, now, id),
    );
    await helpers.timeline('attachment.deleted', id, {
      parentEntityType: existing.parentEntityType,
      parentEntityId: existing.parentEntityId,
      filename: existing.filename,
    });
  }

  async function restoreAttachment(id: string): Promise<AttachmentRecord> {
    const existing = await getAttachmentById(id, { includeDeleted: true });
    if (!existing) throw new Error('ATTACHMENT_NOT_FOUND');
    if (!existing.deletedAt) return existing;
    const now = helpers.nowIso();
    await maybeAwait(
      sql.prepare(`UPDATE attachments SET deleted_at = NULL, updated_at = ? WHERE id = ?`).run(now, id),
    );
    await helpers.timeline('attachment.restored', id, {
      parentEntityType: existing.parentEntityType,
      parentEntityId: existing.parentEntityId,
      filename: existing.filename,
    });
    const restored = await getAttachmentById(id);
    if (!restored) throw new Error('ATTACHMENT_NOT_FOUND');
    return restored;
  }

  async function purgeAttachment(id: string): Promise<void> {
    const existing = await getAttachmentById(id, { includeDeleted: true });
    if (!existing) throw new Error('ATTACHMENT_NOT_FOUND');
    await maybeAwait(sql.prepare(`DELETE FROM attachment_versions WHERE attachment_id = ?`).run(id));
    await maybeAwait(sql.prepare(`DELETE FROM attachments WHERE id = ?`).run(id));
    await helpers.timeline('attachment.purged', id, {
      parentEntityType: existing.parentEntityType,
      parentEntityId: existing.parentEntityId,
      filename: existing.filename,
    });
  }

  async function listAttachmentVersions(id: string): Promise<
    Array<{
      id: string;
      version: number;
      filename: string;
      mimeType: string;
      byteSize: number;
      checksumSha256: string;
      createdAt: string;
      createdByUserId: string | null;
    }>
  > {
    const rows = (await maybeAwait(
      sql
        .prepare(
          `SELECT id, version, filename, mime_type, byte_size, checksum_sha256, created_at, created_by_user_id
           FROM attachment_versions
           WHERE attachment_id = ?
           ORDER BY version DESC`,
        )
        .all(id),
    )) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      version: Number(row.version),
      filename: String(row.filename),
      mimeType: String(row.mime_type),
      byteSize: Number(row.byte_size),
      checksumSha256: String(row.checksum_sha256),
      createdAt: String(row.created_at),
      createdByUserId: (row.created_by_user_id as string | null) ?? null,
    }));
  }

  async function getStorageUsage(): Promise<{
    activeBytes: number;
    deletedBytes: number;
    activeCount: number;
    deletedCount: number;
    retentionDays: number;
    softDeleteRetentionDays: number;
  }> {
    const active = (await maybeAwait(
      sql
        .prepare(
          `SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS bytes
           FROM attachments WHERE deleted_at IS NULL`,
        )
        .get(),
    )) as { count: number; bytes: number };
    const deleted = (await maybeAwait(
      sql
        .prepare(
          `SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS bytes
           FROM attachments WHERE deleted_at IS NOT NULL`,
        )
        .get(),
    )) as { count: number; bytes: number };
    const settings = (await maybeAwait(
      sql
        .prepare(
          `SELECT retention_days, soft_delete_retention_days FROM storage_settings WHERE id = ?`,
        )
        .get('storage-settings'),
    )) as { retention_days: number; soft_delete_retention_days: number } | undefined;

    if (!settings) {
      await maybeAwait(
        sql
          .prepare(
            `INSERT INTO storage_settings (id, retention_days, soft_delete_retention_days, updated_at)
             VALUES ('storage-settings', 365, 30, ?)`,
          )
          .run(helpers.nowIso()),
      );
    }

    return {
      activeBytes: Number(active?.bytes ?? 0),
      deletedBytes: Number(deleted?.bytes ?? 0),
      activeCount: Number(active?.count ?? 0),
      deletedCount: Number(deleted?.count ?? 0),
      retentionDays: Number(settings?.retention_days ?? 365),
      softDeleteRetentionDays: Number(settings?.soft_delete_retention_days ?? 30),
    };
  }

  async function updateStorageSettings(input: {
    retentionDays?: number;
    softDeleteRetentionDays?: number;
  }): Promise<{
    retentionDays: number;
    softDeleteRetentionDays: number;
  }> {
    const current = await getStorageUsage();
    const retentionDays = input.retentionDays ?? current.retentionDays;
    const softDeleteRetentionDays =
      input.softDeleteRetentionDays ?? current.softDeleteRetentionDays;
    await maybeAwait(
      sql
        .prepare(
          `INSERT INTO storage_settings (id, retention_days, soft_delete_retention_days, updated_at)
           VALUES ('storage-settings', ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             retention_days = excluded.retention_days,
             soft_delete_retention_days = excluded.soft_delete_retention_days,
             updated_at = excluded.updated_at`,
        )
        .run(retentionDays, softDeleteRetentionDays, helpers.nowIso()),
    );
    return { retentionDays, softDeleteRetentionDays };
  }

  return {
    listAttachments,
    getAttachmentById,
    uploadAttachment,
    updateAttachment,
    softDeleteAttachment,
    restoreAttachment,
    purgeAttachment,
    listAttachmentVersions,
    getStorageUsage,
    updateStorageSettings,
  };
}

export type AttachmentStore = ReturnType<typeof createAttachmentStore>;
