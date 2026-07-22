import { ZodError, z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import {
  assertCreateInvoiceNumber,
  assertUpdateInvoiceNumber,
} from '../domain/invoices/invoice-number.js';
import { generateInvoicePdfBuffer } from '../services/pdf-service.js';
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
  title: z.string().min(1, 'Invoice title is required.'),
  issueDate: z.string().min(1, 'Issue date is required.'),
  dueDate: z.string().min(1, 'Due date is required.'),
  notes: z.string().optional(),
  paymentTerms: z.string().optional(),
  invoiceNumber: invoiceNumberSchema,
  lineItems: z.array(lineItemSchema).min(1, 'Add at least one line item.'),
});

const updateDraftSchema = z.object({
  title: z.string().min(1, 'Invoice title is required.'),
  issueDate: z.string().min(1, 'Issue date is required.'),
  dueDate: z.string().min(1, 'Due date is required.'),
  notes: z.string().optional(),
  paymentTerms: z.string().optional(),
  invoiceNumber: invoiceNumberSchema,
  lineItems: z.array(lineItemSchema).min(1, 'Add at least one line item.'),
  paymentState: z.enum(['Draft', 'Sent', 'Awaiting Payment', 'Paid', 'Cancelled']),
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
      const { invoiceNumber: _ignoredNumber, ...draftInput } = body;
      const invoice = await app.db.createInvoiceDraft(draftInput);
      return reply.code(201).send(invoice);
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
      const { invoiceNumber: _ignoredNumber, ...draftInput } = body;
      return await app.db.updateInvoiceDraft(params.invoiceId, draftInput);
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
    return invoice;
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
      const pdfBuffer = await generateInvoicePdfBuffer({
        invoice,
        lineItems: invoice.lineItems,
        customer,
        businessProfile,
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
