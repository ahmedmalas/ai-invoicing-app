import { ZodError, z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import {
  assertCreateInvoiceNumber,
  assertUpdateInvoiceNumber,
} from '../domain/invoices/invoice-number.js';
import { generateInvoicePdfBuffer } from '../services/pdf-service.js';
import {
  getInvoiceTemplateBinding,
  resolveInvoiceTemplateForPdf,
  setInvoiceTemplateBinding,
} from '../domain/templates/invoice-template-store.js';
import { parsePagination } from './pagination.js';

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  gstApplicable: z.boolean(),
  productId: z.string().uuid().optional().nullable(),
});

const invoiceNumberSchema = z.string().trim().min(1).nullable().optional();

const createDraftSchema = z.object({
  customerId: z.string().uuid(),
  title: z.string().trim().min(1, 'Invoice title is required.'),
  issueDate: z.string().min(1, 'Issue date is required.'),
  dueDate: z.string().min(1, 'Due date is required.'),
  notes: z.string().optional(),
  paymentTerms: z.string().optional(),
  invoiceNumber: invoiceNumberSchema,
  lineItems: z.array(lineItemSchema).min(1, 'Add at least one line item.'),
  templateId: z.string().uuid().nullable().optional(),
});

const updateDraftSchema = z.object({
  title: z.string().trim().min(1, 'Invoice title is required.'),
  issueDate: z.string().min(1, 'Issue date is required.'),
  dueDate: z.string().min(1, 'Due date is required.'),
  notes: z.string().optional(),
  paymentTerms: z.string().optional(),
  invoiceNumber: invoiceNumberSchema,
  lineItems: z.array(lineItemSchema).min(1, 'Add at least one line item.'),
  paymentState: z.enum(['Draft', 'Sent', 'Awaiting Payment', 'Paid', 'Cancelled']),
  templateId: z.string().uuid().nullable().optional(),
});

export const invoiceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/invoices', async (request) => {
    const query = z.object({
      customerId: z.string().uuid().optional(),
      status: z.enum(['Draft', 'Finalised']).optional(),
      paymentState: z.enum(['Draft', 'Sent', 'Awaiting Payment', 'Paid', 'Cancelled']).optional(),
    }).parse(request.query);
    const filter: { customerId?: string; status?: 'Draft' | 'Finalised'; paymentState?: 'Draft' | 'Sent' | 'Awaiting Payment' | 'Paid' | 'Cancelled' } = {};
    if (query.customerId) filter.customerId = query.customerId;
    if (query.status) filter.status = query.status;
    if (query.paymentState) filter.paymentState = query.paymentState;
    return { invoices: await app.db.listInvoices(filter, parsePagination(request.query)) };
  });

  app.post('/invoices', async (request, reply) => {
    const started = process.hrtime.bigint();
    try {
      const body = createDraftSchema.parse(request.body);
      assertCreateInvoiceNumber(body.invoiceNumber);
      const { invoiceNumber: _ignoredNumber, templateId, ...draftInput } = body;
      const invoice = await app.db.createInvoiceDraft(draftInput);
      if (templateId) {
        await setInvoiceTemplateBinding(app.db, invoice.id, templateId);
      }
      return reply.code(201).send({ ...invoice, templateId: templateId || null });
    } catch (error) {
      if (!(error instanceof ZodError)) {
        request.log.error(
          {
            event: 'invoice.create.failure',
            requestId: request.id,
            route: '/api/invoices',
            operation: 'createInvoiceDraft',
            durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
            code:
              error && typeof error === 'object' && 'code' in error
                ? (error as { code?: string }).code
                : undefined,
            column:
              error && typeof error === 'object' && 'column' in error
                ? (error as { column?: string }).column
                : undefined,
            table:
              error && typeof error === 'object' && 'table' in error
                ? (error as { table?: string }).table
                : undefined,
          },
          'invoice create failed',
        );
      }
      throw error;
    }
  });

  app.put('/invoices/:invoiceId', async (request) => {
    const started = process.hrtime.bigint();
    const params = z.object({ invoiceId: z.string().uuid() }).parse(request.params);
    try {
      const body = updateDraftSchema.parse(request.body);
      const existing = await app.db.getInvoiceById(params.invoiceId);
      if (!existing) {
        throw new Error('Invoice not found');
      }
      assertUpdateInvoiceNumber(body.invoiceNumber, existing.invoiceNumber);
      const { invoiceNumber: _ignoredNumber, templateId, ...draftInput } = body;
      const updated = await app.db.updateInvoiceDraft(params.invoiceId, draftInput);
      if (templateId !== undefined) {
        await setInvoiceTemplateBinding(app.db, params.invoiceId, templateId);
      }
      return { ...updated, templateId: templateId ?? null };
    } catch (error) {
      if (!(error instanceof ZodError)) {
        request.log.error(
          {
            event: 'invoice.update.failure',
            requestId: request.id,
            route: '/api/invoices/:invoiceId',
            operation: 'updateInvoiceDraft',
            invoiceId: params.invoiceId,
            durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
            code:
              error && typeof error === 'object' && 'code' in error
                ? (error as { code?: string }).code
                : undefined,
            column:
              error && typeof error === 'object' && 'column' in error
                ? (error as { column?: string }).column
                : undefined,
            table:
              error && typeof error === 'object' && 'table' in error
                ? (error as { table?: string }).table
                : undefined,
          },
          'invoice update failed',
        );
      }
      throw error;
    }
  });

  app.get('/invoices/:invoiceId', async (request, reply) => {
    const params = z.object({ invoiceId: z.string().uuid() }).parse(request.params);
    const invoice = await app.db.getInvoiceById(params.invoiceId);
    if (!invoice) {
      return reply.code(404).send({ message: 'Invoice not found' });
    }
    const templateId = await getInvoiceTemplateBinding(app.db, params.invoiceId);
    return { ...invoice, templateId };
  });

  app.delete('/invoices/:invoiceId', async (request, reply) => {
    const started = process.hrtime.bigint();
    const params = z.object({ invoiceId: z.string().uuid() }).parse(request.params);
    try {
      await app.db.deleteInvoiceDraft(params.invoiceId);
      request.log.info(
        {
          event: 'invoice.delete.success',
          requestId: request.id,
          route: '/api/invoices/:invoiceId',
          operation: 'deleteInvoiceDraft',
          invoiceId: params.invoiceId,
          durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
        },
        'invoice draft deleted',
      );
      return reply.code(204).send();
    } catch (error) {
      request.log.error(
        {
          event: 'invoice.delete.failure',
          requestId: request.id,
          route: '/api/invoices/:invoiceId',
          operation: 'deleteInvoiceDraft',
          invoiceId: params.invoiceId,
          durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
          code:
            error && typeof error === 'object' && 'code' in error
              ? (error as { code?: string }).code
              : undefined,
          message: error instanceof Error ? error.message : undefined,
        },
        'invoice draft delete failed',
      );
      throw error;
    }
  });

  app.post('/invoices/:invoiceId/finalise', async (request) => {
    const params = z.object({ invoiceId: z.string().uuid() }).parse(request.params);
    return await app.db.finaliseInvoice(params.invoiceId);
  });

  app.get('/invoices/:invoiceId/pdf', async (request, reply) => {
    const started = process.hrtime.bigint();
    const params = z.object({ invoiceId: z.string().uuid() }).parse(request.params);
    try {
      const invoice = await app.db.getInvoiceById(params.invoiceId);
      if (!invoice) {
        return reply.code(404).send({ message: 'Invoice not found' });
      }

      const customer = await app.db.getCustomerById(invoice.customerId);
      if (!customer) {
        return reply.code(400).send({ message: 'Invoice customer missing' });
      }

      // Finalised invoices keep the branding frozen at issue time.
      const frozenBranding =
        invoice.status === 'Finalised' ? await app.db.getInvoiceBrandingSnapshot(invoice.id) : null;
      const businessProfile = frozenBranding ?? (await app.db.getBusinessProfile());
      const resolvedTemplate = await resolveInvoiceTemplateForPdf(app.db, invoice.id);
      const templateDesign = resolvedTemplate?.design ?? null;
      const profileForPdf =
        templateDesign && businessProfile
          ? {
              ...businessProfile,
              primaryColor: templateDesign.colors.primary || businessProfile.primaryColor,
              secondaryColor: templateDesign.colors.secondary || businessProfile.secondaryColor,
            }
          : businessProfile;
      const pdfBuffer = await generateInvoicePdfBuffer({
        invoice: {
          ...invoice,
          paymentTerms: invoice.paymentTerms || templateDesign?.termsAndConditions || null,
          notes: invoice.notes || templateDesign?.notesPlaceholder || null,
        },
        lineItems: invoice.lineItems,
        customer,
        businessProfile: profileForPdf,
        templateDesign,
        bankDetails: templateDesign?.bankDetails
          ? {
              accountName: templateDesign.bankDetails.accountName,
              bsb: templateDesign.bankDetails.bsb,
              accountNumber: templateDesign.bankDetails.accountNumber,
            }
          : null,
        timeoutMs: 20_000,
      });

      return reply
        .code(200)
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `inline; filename="${invoice.invoiceNumber ?? invoice.id}.pdf"`,
        )
        .send(pdfBuffer);
    } catch (error) {
      request.log.error(
        {
          event: 'invoice.pdf.failure',
          requestId: request.id,
          route: '/api/invoices/:invoiceId/pdf',
          operation: 'generateInvoicePdf',
          invoiceId: params.invoiceId,
          durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
          code:
            error && typeof error === 'object' && 'code' in error
              ? (error as { code?: string }).code
              : undefined,
        },
        'invoice pdf preview failed',
      );
      throw error;
    }
  });
};
