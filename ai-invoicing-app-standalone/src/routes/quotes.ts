import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { parsePagination } from './pagination.js';

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  gstApplicable: z.boolean(),
});

const quoteBodySchema = z.object({
  customerId: z.string().uuid(),
  title: z.string().min(1),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
  terms: z.string().optional(),
  lineItems: z.array(lineItemSchema).min(1),
}).refine((value) => value.expiryDate >= value.issueDate, {
  message: 'expiryDate must be on or after issueDate',
  path: ['expiryDate'],
});

const quoteStatusSchema = z.enum(['Draft', 'Sent', 'Accepted', 'Declined', 'Expired', 'Converted']);

export const quoteRoutes: FastifyPluginAsync = async (app) => {
  app.get('/quotes', async (request) => {
    const query = z.object({
      customerId: z.string().uuid().optional(),
      status: quoteStatusSchema.optional(),
    }).parse(request.query);
    const filter: { customerId?: string; status?: z.infer<typeof quoteStatusSchema> } = {};
    if (query.customerId) filter.customerId = query.customerId;
    if (query.status) filter.status = query.status;
    return { quotes: await app.db.listQuotes(filter, parsePagination(request.query)) };
  });

  app.post('/quotes', async (request, reply) => {
    const quote = await app.db.createQuote(quoteBodySchema.parse(request.body));
    return reply.code(201).send(quote);
  });

  app.get('/quotes/:quoteId', async (request, reply) => {
    const { quoteId } = z.object({ quoteId: z.string().uuid() }).parse(request.params);
    const quote = await app.db.getQuoteById(quoteId);
    if (!quote) return reply.code(404).send({ message: 'Quote not found' });
    return quote;
  });

  app.put('/quotes/:quoteId', async (request) => {
    const { quoteId } = z.object({ quoteId: z.string().uuid() }).parse(request.params);
    return await app.db.updateQuote(quoteId, quoteBodySchema.parse(request.body));
  });

  app.delete('/quotes/:quoteId', async (request, reply) => {
    const { quoteId } = z.object({ quoteId: z.string().uuid() }).parse(request.params);
    await app.db.deleteQuoteDraft(quoteId);
    return reply.code(204).send();
  });

  app.post('/quotes/:quoteId/status', async (request) => {
    const { quoteId } = z.object({ quoteId: z.string().uuid() }).parse(request.params);
    const { status } = z.object({ status: quoteStatusSchema.exclude(['Converted']) }).parse(request.body);
    return await app.db.transitionQuoteStatus(quoteId, status);
  });

  app.post('/quotes/:quoteId/convert', async (request) => {
    const { quoteId } = z.object({ quoteId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      paymentTerms: z.string().optional(),
    }).parse(request.body);
    return await app.db.convertQuoteToInvoice(quoteId, body.dueDate, body.paymentTerms);
  });
};
