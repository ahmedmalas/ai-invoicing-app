import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  assertAttachmentAction,
  type AttachmentAuthContext,
} from '../domain/attachments/permissions.js';
import {
  attachmentLibraryQuerySchema,
  updateAttachmentSchema,
  uploadAttachmentSchema,
} from '../domain/attachments/types.js';
import {
  extractReceiptFields,
  extractTextForReceiptOcr,
} from '../domain/attachments/receipt-ocr.js';
import { normalizeAttachmentMime } from '../domain/attachments/types.js';

function authContext(request: { auth: { isAdmin: boolean; canWrite: boolean } }): AttachmentAuthContext {
  return {
    isAdmin: request.auth.isAdmin,
    canWrite: request.auth.canWrite,
    isReadOnly: !request.auth.isAdmin && !request.auth.canWrite,
  };
}

export const attachmentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/attachments', async (request) => {
    assertAttachmentAction(authContext(request), 'view');
    const query = attachmentLibraryQuerySchema.parse(request.query);
    return await app.db.listAttachments(query);
  });

  app.get('/attachments/storage', async (request) => {
    assertAttachmentAction(authContext(request), 'view');
    return await app.db.getStorageUsage();
  });

  app.patch('/attachments/storage', async (request) => {
    assertAttachmentAction(authContext(request), 'edit');
    if (!request.auth.isAdmin) throw new Error('AUTH_FORBIDDEN');
    const body = z
      .object({
        retentionDays: z.number().int().min(1).max(3650).optional(),
        softDeleteRetentionDays: z.number().int().min(1).max(3650).optional(),
      })
      .parse(request.body);
    return await app.db.updateStorageSettings({
      ...(body.retentionDays !== undefined ? { retentionDays: body.retentionDays } : {}),
      ...(body.softDeleteRetentionDays !== undefined
        ? { softDeleteRetentionDays: body.softDeleteRetentionDays }
        : {}),
    });
  });

  app.get('/attachments/:attachmentId', async (request, reply) => {
    assertAttachmentAction(authContext(request), 'view');
    const params = z.object({ attachmentId: z.string().uuid() }).parse(request.params);
    const query = z
      .object({
        includeContent: z
          .enum(['0', '1', 'true', 'false'])
          .optional()
          .transform((value) => value === '1' || value === 'true'),
      })
      .parse(request.query);
    const attachment = await app.db.getAttachmentById(params.attachmentId, {
      includeContent: query.includeContent,
      includeDeleted: true,
    });
    if (!attachment) return reply.code(404).send({ message: 'ATTACHMENT_NOT_FOUND' });
    return attachment;
  });

  app.get('/attachments/:attachmentId/content', async (request, reply) => {
    assertAttachmentAction(authContext(request), 'download');
    const params = z.object({ attachmentId: z.string().uuid() }).parse(request.params);
    const attachment = await app.db.getAttachmentById(params.attachmentId, {
      includeContent: true,
    });
    if (!attachment?.contentBase64) {
      return reply.code(404).send({ message: 'ATTACHMENT_NOT_FOUND' });
    }
    const buffer = Buffer.from(attachment.contentBase64, 'base64');
    return reply
      .code(200)
      .header('Content-Type', attachment.mimeType)
      .header('Content-Disposition', `inline; filename="${attachment.filename}"`)
      .header('Cache-Control', 'private, max-age=60')
      .send(buffer);
  });

  app.get('/attachments/:attachmentId/versions', async (request, reply) => {
    assertAttachmentAction(authContext(request), 'view');
    const params = z.object({ attachmentId: z.string().uuid() }).parse(request.params);
    const existing = await app.db.getAttachmentById(params.attachmentId, { includeDeleted: true });
    if (!existing) return reply.code(404).send({ message: 'ATTACHMENT_NOT_FOUND' });
    const versions = await app.db.listAttachmentVersions(params.attachmentId);
    return { versions };
  });

  app.post('/attachments', async (request, reply) => {
    assertAttachmentAction(authContext(request), 'upload');
    const body = uploadAttachmentSchema.parse(request.body);
    try {
      const attachment = await app.db.uploadAttachment({
        ...body,
        uploadedByName: body.uploadedByName ?? request.auth.userId,
      });
      return reply.code(201).send(attachment);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ATTACHMENT_UPLOAD_FAILED';
      if (
        [
          'UNSUPPORTED_ATTACHMENT_FORMAT',
          'EMPTY_ATTACHMENT_FILE',
          'ATTACHMENT_FILE_TOO_LARGE',
          'INVALID_ATTACHMENT_PAYLOAD',
        ].includes(message)
      ) {
        return reply.code(400).send({ message });
      }
      throw error;
    }
  });

  app.post('/attachments/ocr-preview', async (request) => {
    assertAttachmentAction(authContext(request), 'upload');
    const body = z
      .object({
        filename: z.string().min(1).max(260),
        mimeType: z.string().min(1).max(120),
        contentBase64: z.string().min(1).max(6_500_000),
      })
      .parse(request.body);
    const mimeType = normalizeAttachmentMime(body.mimeType, body.filename);
    const bytes = Buffer.from(body.contentBase64, 'base64');
    const text = await extractTextForReceiptOcr(mimeType, bytes);
    return { ocr: extractReceiptFields(text) };
  });

  app.patch('/attachments/:attachmentId', async (request, reply) => {
    assertAttachmentAction(authContext(request), 'edit');
    const params = z.object({ attachmentId: z.string().uuid() }).parse(request.params);
    const body = updateAttachmentSchema.parse(request.body);
    try {
      return await app.db.updateAttachment(params.attachmentId, body);
    } catch (error) {
      if (error instanceof Error && error.message === 'ATTACHMENT_NOT_FOUND') {
        return reply.code(404).send({ message: 'ATTACHMENT_NOT_FOUND' });
      }
      throw error;
    }
  });

  app.delete('/attachments/:attachmentId', async (request, reply) => {
    assertAttachmentAction(authContext(request), 'delete');
    const params = z.object({ attachmentId: z.string().uuid() }).parse(request.params);
    const query = z
      .object({
        purge: z
          .enum(['0', '1', 'true', 'false'])
          .optional()
          .transform((value) => value === '1' || value === 'true'),
      })
      .parse(request.query);
    try {
      if (query.purge) {
        if (!request.auth.isAdmin) throw new Error('AUTH_FORBIDDEN');
        await app.db.purgeAttachment(params.attachmentId);
      } else {
        await app.db.softDeleteAttachment(params.attachmentId);
      }
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === 'ATTACHMENT_NOT_FOUND') {
        return reply.code(404).send({ message: 'ATTACHMENT_NOT_FOUND' });
      }
      throw error;
    }
  });

  app.post('/attachments/:attachmentId/restore', async (request, reply) => {
    assertAttachmentAction(authContext(request), 'restore');
    const params = z.object({ attachmentId: z.string().uuid() }).parse(request.params);
    try {
      return await app.db.restoreAttachment(params.attachmentId);
    } catch (error) {
      if (error instanceof Error && error.message === 'ATTACHMENT_NOT_FOUND') {
        return reply.code(404).send({ message: 'ATTACHMENT_NOT_FOUND' });
      }
      throw error;
    }
  });

  app.get('/entities/:entityType/:entityId/attachments', async (request) => {
    assertAttachmentAction(authContext(request), 'view');
    const params = z
      .object({
        entityType: uploadAttachmentSchema.shape.parentEntityType,
        entityId: z.string().min(1).max(80),
      })
      .parse(request.params);
    const query = attachmentLibraryQuerySchema.parse({
      ...(typeof request.query === 'object' && request.query ? request.query : {}),
      parentEntityType: params.entityType,
      parentEntityId: params.entityId,
    });
    return await app.db.listAttachments(query);
  });
};
