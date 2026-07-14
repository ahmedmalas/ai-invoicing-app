import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { generateQuotePdfBuffer } from '../services/pdf-service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const lineItem = z.object({
  description: z.string().trim().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  gstApplicable: z.boolean(),
});
const createQuote = z
  .object({
    customerId: z.string().uuid(),
    title: z.string().trim().min(1),
    issueDate: isoDate,
    expiryDate: isoDate,
    notes: z.string().trim().optional(),
    paymentTerms: z.string().trim().optional(),
    lineItems: z.array(lineItem).min(1),
  })
  .refine((quote) => quote.expiryDate >= quote.issueDate, {
    path: ['expiryDate'],
    message: 'expiryDate must be on or after issueDate',
  });
const updateQuote = createQuote.and(
  z.object({ status: z.enum(['Draft', 'Sent', 'Accepted', 'Declined', 'Expired', 'Cancelled']) }),
);
const idParams = z.object({ quoteId: z.string().uuid() });

export const quoteRoutes: FastifyPluginAsync = async (app) => {
  app.get('/quotes', async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(request.query);
    return {
      quotes: await app.db.listQuotes({
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        ...(query.offset !== undefined ? { offset: query.offset } : {}),
      }),
    };
  });

  app.post('/quotes', async (request, reply) =>
    reply.code(201).send(await app.db.createQuote(createQuote.parse(request.body))),
  );

  app.get('/quotes/:quoteId', async (request, reply) => {
    const quote = await app.db.getQuoteById(idParams.parse(request.params).quoteId);
    return quote ?? reply.code(404).send({ message: 'Quote not found' });
  });

  app.put(
    '/quotes/:quoteId',
    async (request) =>
      await app.db.updateQuote(
        idParams.parse(request.params).quoteId,
        updateQuote.parse(request.body),
      ),
  );

  app.post(
    '/quotes/:quoteId/convert',
    async (request) => await app.db.convertQuoteToInvoice(idParams.parse(request.params).quoteId),
  );

  app.get('/quotes/:quoteId/pdf', async (request, reply) => {
    const quote = await app.db.getQuoteById(idParams.parse(request.params).quoteId);
    if (!quote) return reply.code(404).send({ message: 'Quote not found' });
    const customer = await app.db.getCustomerById(quote.customerId);
    if (!customer) return reply.code(409).send({ message: 'Quote customer missing' });
    const businessProfile = await app.db.getBusinessProfile();
    const pdf = await generateQuotePdfBuffer({
      quote,
      lineItems: quote.lineItems,
      customer,
      businessProfile,
    });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="${quote.quoteNumber}.pdf"`)
      .send(pdf);
  });
};
