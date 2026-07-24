import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  analyzeInvoiceDocument,
  isSupportedImportMime,
} from '../domain/templates/analyze-invoice-document.js';
import { invoiceTemplateDesignSchema } from '../domain/templates/invoice-template-design.js';
import { createInvoiceTemplateSchema } from '../domain/templates/invoice-template.js';
import {
  createInvoiceTemplate,
  deleteInvoiceTemplate,
  duplicateInvoiceTemplate,
  getDefaultInvoiceTemplate,
  getInvoiceTemplateById,
  listInvoiceTemplates,
  setDefaultInvoiceTemplate,
  updateInvoiceTemplate,
} from '../domain/templates/invoice-template-store.js';
import { generateInvoicePdfBuffer } from '../services/pdf-service.js';

const importAnalyzeSchema = z.object({
  filename: z.string().trim().min(1).max(260),
  mimeType: z.string().trim().min(1).max(120),
  contentBase64: z.string().min(1).max(5_500_000),
});

const approveSchema = createInvoiceTemplateSchema.extend({
  name: z.string().trim().min(1).max(120).default('Imported invoice template'),
  isDefault: z.boolean().default(true),
  applyBusinessDefaults: z.boolean().default(true),
  source: z.enum(['imported', 'manual', 'duplicated']).default('imported'),
});

const previewSchema = z.object({
  design: invoiceTemplateDesignSchema,
  title: z.string().max(160).optional(),
});

export const invoiceTemplateRoutes: FastifyPluginAsync = async (app) => {
  app.get('/invoice-templates', async () => {
    const templates = await listInvoiceTemplates(app.db);
    return {
      templates: templates.map((item) => ({
        ...item,
        originalPreviewDataUrl: item.originalPreviewDataUrl ? '[stored]' : null,
        hasOriginalPreview: Boolean(item.originalPreviewDataUrl),
      })),
      count: templates.length,
    };
  });

  app.get('/invoice-templates/default', async () => {
    const template = await getDefaultInvoiceTemplate(app.db);
    return { template };
  });

  app.get('/invoice-templates/:templateId', async (request, reply) => {
    const params = z.object({ templateId: z.string().uuid() }).parse(request.params);
    const template = await getInvoiceTemplateById(app.db, params.templateId);
    if (!template) return reply.code(404).send({ message: 'INVOICE_TEMPLATE_NOT_FOUND' });
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
    if (!bytes.length || bytes.length > 4_000_000) {
      return reply.code(400).send({ message: 'IMPORT_FILE_TOO_LARGE' });
    }
    const result = await analyzeInvoiceDocument({
      filename: body.filename,
      mimeType: body.mimeType,
      bytes,
    });
    const previewDataUrl = body.mimeType.startsWith('image/')
      ? `data:${body.mimeType};base64,${body.contentBase64.slice(0, 800_000)}`
      : null;
    return {
      ...result,
      originalFilename: body.filename,
      originalMimeType: body.mimeType,
      originalPreviewDataUrl: previewDataUrl,
      // Echo a short content hash so the client can keep the full file for on-screen PDF preview.
      contentBytes: bytes.length,
    };
  });

  app.post('/invoice-templates/approve', async (request, reply) => {
    const body = approveSchema.parse(request.body);
    const template = await createInvoiceTemplate(app.db, body);
    return reply.code(201).send(template);
  });

  app.post('/invoice-templates/preview-pdf', async (request, reply) => {
    const body = previewSchema.parse(request.body);
    const profile = await app.db.getBusinessProfile();
    const mergedProfile = profile
      ? {
          ...profile,
          companyName: body.design.businessDefaults.companyName || profile.companyName,
          legalName: body.design.businessDefaults.legalName || profile.legalName,
          abnTaxId: body.design.businessDefaults.abnTaxId || profile.abnTaxId,
          email: body.design.businessDefaults.email || profile.email,
          phone: body.design.businessDefaults.phone || profile.phone,
          primaryColor: body.design.colors.primary,
          secondaryColor: body.design.colors.secondary,
        }
      : {
          id: 'preview',
          companyName: body.design.businessDefaults.companyName || 'Business Name',
          legalName: body.design.businessDefaults.legalName,
          abnTaxId: body.design.businessDefaults.abnTaxId,
          address: body.design.businessDefaults.address,
          email: body.design.businessDefaults.email,
          phone: body.design.businessDefaults.phone,
          logoReference: null,
          primaryColor: body.design.colors.primary,
          secondaryColor: body.design.colors.secondary,
          updatedAt: new Date().toISOString(),
        };

    const pdf = await generateInvoicePdfBuffer({
      invoice: {
        id: 'template-preview',
        customerId: '00000000-0000-4000-8000-000000000001',
        title: body.title || 'Template preview',
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        notes: body.design.notesPlaceholder || '',
        paymentTerms: body.design.termsAndConditions || 'Payment due within 7 days',
        invoiceNumber: null,
        status: 'Draft',
        paymentState: 'Draft',
        reminderState: 'None',
        totals: { subtotal: 700, gstTotal: 70, total: 770 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      lineItems: [
        {
          description: 'Labour Hire - Day Shift',
          quantity: 1,
          unitPrice: 350,
          gstApplicable: true,
        },
        {
          description: 'Labour Hire - Night Shift',
          quantity: 1,
          unitPrice: 350,
          gstApplicable: true,
        },
      ],
      customer: {
        id: '00000000-0000-4000-8000-000000000001',
        displayName: 'Sample Customer Pty Ltd',
        email: 'customer@example.test',
        phone: null,
        address: '1 Sample Street',
        abnTaxId: null,
        notes: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      businessProfile: mergedProfile,
      templateDesign: body.design,
      bankDetails: body.design.bankDetails
        ? {
            accountName: body.design.bankDetails.accountName,
            bsb: body.design.bankDetails.bsb,
            accountNumber: body.design.bankDetails.accountNumber,
          }
        : null,
    });
    return reply.type('application/pdf').send(pdf);
  });

  app.patch('/invoice-templates/:templateId', async (request, reply) => {
    const params = z.object({ templateId: z.string().uuid() }).parse(request.params);
    try {
      const template = await updateInvoiceTemplate(
        app.db,
        params.templateId,
        request.body as object,
      );
      return template;
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
      const template = await setDefaultInvoiceTemplate(app.db, params.templateId);
      return template;
    } catch (error) {
      if (error instanceof Error && error.message === 'INVOICE_TEMPLATE_NOT_FOUND') {
        return reply.code(404).send({ message: 'INVOICE_TEMPLATE_NOT_FOUND' });
      }
      throw error;
    }
  });

  app.post('/invoice-templates/:templateId/duplicate', async (request, reply) => {
    const params = z.object({ templateId: z.string().uuid() }).parse(request.params);
    try {
      const template = await duplicateInvoiceTemplate(app.db, params.templateId);
      return reply.code(201).send(template);
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
      await deleteInvoiceTemplate(app.db, params.templateId);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === 'INVOICE_TEMPLATE_NOT_FOUND') {
        return reply.code(404).send({ message: 'INVOICE_TEMPLATE_NOT_FOUND' });
      }
      throw error;
    }
  });
};
