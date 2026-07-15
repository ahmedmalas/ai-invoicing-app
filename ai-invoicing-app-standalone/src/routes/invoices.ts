import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { generateInvoicePdfBuffer } from '../services/pdf-service.js';
import { parsePagination } from './pagination.js';

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  gstApplicable: z.boolean(),
});

const createDraftSchema = z.object({
  customerId: z.string().uuid(),
  title: z.string().min(1),
  issueDate: z.string().min(1),
  dueDate: z.string().min(1),
  notes: z.string().optional(),
  paymentTerms: z.string().optional(),
  lineItems: z.array(lineItemSchema).min(1),
});

const updateDraftSchema = z.object({
  title: z.string().min(1),
  issueDate: z.string().min(1),
  dueDate: z.string().min(1),
  notes: z.string().optional(),
  paymentTerms: z.string().optional(),
  lineItems: z.array(lineItemSchema).min(1),
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
    const body = createDraftSchema.parse(request.body);
    const invoice = await app.db.createInvoiceDraft(body);
    return reply.code(201).send(invoice);
  });

  app.put('/invoices/:invoiceId', async (request) => {
    const params = z.object({ invoiceId: z.string().uuid() }).parse(request.params);
    const body = updateDraftSchema.parse(request.body);
    return await app.db.updateInvoiceDraft(params.invoiceId, body);
  });

  app.get('/invoices/:invoiceId', async (request, reply) => {
    const params = z.object({ invoiceId: z.string().uuid() }).parse(request.params);
    const invoice = await app.db.getInvoiceById(params.invoiceId);
    if (!invoice) {
      return reply.code(404).send({ message: 'Invoice not found' });
    }
    return invoice;
  });

  app.delete('/invoices/:invoiceId', async (request, reply) => {
    const params = z.object({ invoiceId: z.string().uuid() }).parse(request.params);
    await app.db.deleteInvoiceDraft(params.invoiceId);
    return reply.code(204).send();
  });

  app.post('/invoices/:invoiceId/finalise', async (request) => {
    const params = z.object({ invoiceId: z.string().uuid() }).parse(request.params);
    return await app.db.finaliseInvoice(params.invoiceId);
  });

  app.get('/invoices/:invoiceId/pdf', async (request, reply) => {
    const params = z.object({ invoiceId: z.string().uuid() }).parse(request.params);
    const invoice = await app.db.getInvoiceById(params.invoiceId);
    if (!invoice) {
      return reply.code(404).send({ message: 'Invoice not found' });
    }

    const customer = await app.db.getCustomerById(invoice.customerId);
    if (!customer) {
      return reply.code(400).send({ message: 'Invoice customer missing' });
    }

    const businessProfile = await app.db.getBusinessProfile();
    const pdfBuffer = await generateInvoicePdfBuffer({
      invoice,
      lineItems: invoice.lineItems,
      customer,
      businessProfile,
    });

    return reply
      .code(200)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${invoice.invoiceNumber ?? invoice.id}.pdf"`)
      .send(pdfBuffer);
  });
};
