import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  analyzeInvoiceDocument,
  isSupportedImportMime,
} from '../domain/templates/analyze-invoice-document.js';
import {
  createInvoiceTemplateSchema,
  updateInvoiceTemplateSchema,
} from '../domain/templates/invoice-template.js';
import {
  DOCUMENT_TEMPLATE_TARGETS,
  invoiceTemplateDesignSchema,
} from '../domain/templates/invoice-template-design.js';
import { generateTemplatePreviewPdfBuffer } from '../domain/templates/template-pdf.js';

const importAnalyzeSchema = z.object({
  filename: z.string().trim().min(1).max(260),
  mimeType: z.string().trim().min(1).max(120),
  contentBase64: z.string().min(1).max(6_500_000),
});

const approveSchema = createInvoiceTemplateSchema.extend({
  name: z.string().trim().min(1).max(120).default('Imported invoice template'),
  isDefault: z.boolean().default(true),
  applyBusinessDefaults: z.boolean().default(true),
  source: z.enum(['imported', 'manual', 'duplicated']).default('imported'),
});

export const invoiceTemplateRoutes: FastifyPluginAsync = async (app) => {
  app.get('/invoice-templates', async () => {
    const templates = await app.db.listInvoiceTemplates();
    return { templates, count: templates.length };
  });

  app.get('/invoice-templates/default', async (request) => {
    const query = z
      .object({
        target: z.enum(DOCUMENT_TEMPLATE_TARGETS).optional(),
      })
      .parse(request.query);
    const template = await app.db.getDefaultInvoiceTemplate(query.target);
    if (!template) {
      return { template: null };
    }
    return { template };
  });

  app.get('/invoice-templates/:templateId', async (request, reply) => {
    const params = z.object({ templateId: z.string().uuid() }).parse(request.params);
    const query = z
      .object({
        includeOriginal: z
          .enum(['0', '1', 'true', 'false'])
          .optional()
          .transform((value) => value === '1' || value === 'true'),
      })
      .parse(request.query);
    const template = await app.db.getInvoiceTemplateById(params.templateId, {
      includeOriginal: query.includeOriginal,
    });
    if (!template) {
      return reply.code(404).send({ message: 'INVOICE_TEMPLATE_NOT_FOUND' });
    }
    return template;
  });

  app.post('/invoice-templates/analyze', async (request, reply) => {
    const body = importAnalyzeSchema.parse(request.body);
    if (!isSupportedImportMime(body.mimeType, body.filename)) {
      return reply.code(400).send({ message: 'UNSUPPORTED_IMPORT_FORMAT' });
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(body.contentBase64, 'base64');
    } catch {
      return reply.code(400).send({ message: 'INVALID_IMPORT_PAYLOAD' });
    }
    if (!bytes.length) {
      return reply.code(400).send({ message: 'EMPTY_IMPORT_FILE' });
    }

    try {
      const analysis = await analyzeInvoiceDocument({
        filename: body.filename,
        mimeType: body.mimeType,
        bytes,
      });
      return {
        analysis: {
          design: analysis.design,
          detectedElements: analysis.detectedElements,
          strippedTransactionalFields: analysis.strippedTransactionalFields,
          confidence: analysis.confidence,
          extractedTextPreview: analysis.extractedTextPreview,
        },
        original: {
          filename: body.filename,
          mimeType: body.mimeType,
          contentBase64: body.contentBase64,
          sizeBytes: bytes.length,
        },
        message:
          'Invoice design extracted. Review the side-by-side preview, then approve to save as your template.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'IMPORT_ANALYSIS_FAILED';
      if (
        message === 'UNSUPPORTED_IMPORT_FORMAT' ||
        message === 'EMPTY_IMPORT_FILE' ||
        message === 'IMPORT_FILE_TOO_LARGE'
      ) {
        return reply.code(400).send({ message });
      }
      throw error;
    }
  });

  app.post('/invoice-templates/approve', async (request, reply) => {
    const body = approveSchema.parse(request.body);
    const template = await app.db.createInvoiceTemplate({
      ...body,
      source: body.source ?? 'imported',
      isDefault: body.isDefault ?? true,
      applyBusinessDefaults: body.applyBusinessDefaults ?? true,
    });
    return reply.code(201).send(template);
  });

  app.post('/invoice-templates', async (request, reply) => {
    const body = createInvoiceTemplateSchema.parse(request.body);
    const template = await app.db.createInvoiceTemplate(body);
    return reply.code(201).send(template);
  });

  app.patch('/invoice-templates/:templateId', async (request, reply) => {
    const params = z.object({ templateId: z.string().uuid() }).parse(request.params);
    const body = updateInvoiceTemplateSchema.parse(request.body);
    try {
      return await app.db.updateInvoiceTemplate(params.templateId, body);
    } catch (error) {
      if (error instanceof Error && error.message === 'INVOICE_TEMPLATE_NOT_FOUND') {
        return reply.code(404).send({ message: 'INVOICE_TEMPLATE_NOT_FOUND' });
      }
      throw error;
    }
  });

  app.post('/invoice-templates/:templateId/duplicate', async (request, reply) => {
    const params = z.object({ templateId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
      })
      .parse(request.body ?? {});
    try {
      const template = await app.db.duplicateInvoiceTemplate(params.templateId, body.name);
      return reply.code(201).send(template);
    } catch (error) {
      if (error instanceof Error && error.message === 'INVOICE_TEMPLATE_NOT_FOUND') {
        return reply.code(404).send({ message: 'INVOICE_TEMPLATE_NOT_FOUND' });
      }
      throw error;
    }
  });

  app.post('/invoice-templates/:templateId/default', async (request, reply) => {
    const params = z.object({ templateId: z.string().uuid() }).parse(request.params);
    try {
      return await app.db.setDefaultInvoiceTemplate(params.templateId);
    } catch (error) {
      if (error instanceof Error && error.message === 'INVOICE_TEMPLATE_NOT_FOUND') {
        return reply.code(404).send({ message: 'INVOICE_TEMPLATE_NOT_FOUND' });
      }
      throw error;
    }
  });

  app.delete('/invoice-templates/:templateId', async (request, reply) => {
    const params = z.object({ templateId: z.string().uuid() }).parse(request.params);
    try {
      await app.db.deleteInvoiceTemplate(params.templateId);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === 'INVOICE_TEMPLATE_NOT_FOUND') {
        return reply.code(404).send({ message: 'INVOICE_TEMPLATE_NOT_FOUND' });
      }
      throw error;
    }
  });

  app.post('/invoice-templates/preview-pdf', async (request, reply) => {
    const body = z
      .object({
        design: invoiceTemplateDesignSchema,
      })
      .parse(request.body);
    const businessProfile = await app.db.getBusinessProfile();
    const pdfBuffer = await generateTemplatePreviewPdfBuffer({
      design: body.design,
      businessProfile,
    });
    return reply
      .code(200)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', 'inline; filename="template-preview.pdf"')
      .send(pdfBuffer);
  });

  app.get('/invoice-templates/:templateId/preview-pdf', async (request, reply) => {
    const params = z.object({ templateId: z.string().uuid() }).parse(request.params);
    const template = await app.db.getInvoiceTemplateById(params.templateId);
    if (!template) {
      return reply.code(404).send({ message: 'INVOICE_TEMPLATE_NOT_FOUND' });
    }
    const businessProfile = await app.db.getBusinessProfile();
    const pdfBuffer = await generateTemplatePreviewPdfBuffer({
      design: template.design,
      businessProfile,
    });
    return reply
      .code(200)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${template.name}.pdf"`)
      .send(pdfBuffer);
  });

  app.get('/invoice-templates/:templateId/original', async (request, reply) => {
    const params = z.object({ templateId: z.string().uuid() }).parse(request.params);
    const template = await app.db.getInvoiceTemplateById(params.templateId, {
      includeOriginal: true,
    });
    if (!template?.originalFileBase64) {
      return reply.code(404).send({ message: 'ORIGINAL_FILE_NOT_FOUND' });
    }
    const mime = template.originalMimeType || 'application/octet-stream';
    const filename = template.originalFilename || 'original-invoice';
    const buffer = Buffer.from(template.originalFileBase64, 'base64');
    return reply
      .code(200)
      .header('Content-Type', mime)
      .header('Content-Disposition', `inline; filename="${filename}"`)
      .send(buffer);
  });
};
