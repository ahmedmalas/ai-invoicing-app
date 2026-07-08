import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { createCreditNoteSchema } from '../domain/credit-notes/validation.js';
import { generateCreditNotePdfBuffer } from '../services/pdf-service.js';
import { renderCreditNoteHtml } from '../services/credit-note-service.js';
import { paginateArray, parsePagination } from './pagination.js';

export const creditNoteRoutes: FastifyPluginAsync = async (app) => {
  app.post('/credit-notes', async (request, reply) => {
    const body = createCreditNoteSchema.parse(request.body);
    const creditNote = app.db.createCreditNote(body);
    return reply.code(201).send(creditNote);
  });

  app.get('/credit-notes/:creditNoteId', async (request, reply) => {
    const params = z.object({ creditNoteId: z.string().uuid() }).parse(request.params);
    const creditNote = app.db.getCreditNoteById(params.creditNoteId);
    if (!creditNote) {
      return reply.code(404).send({ message: 'CREDIT_NOTE_NOT_FOUND' });
    }
    return creditNote;
  });

  app.get('/credit-notes', async (request) => {
    const pagination = parsePagination(request.query);
    const query = z
      .object({
        customerId: z.string().uuid().optional(),
        invoiceId: z.string().uuid().optional(),
      })
      .parse(request.query);
    const filter: { customerId?: string; linkedInvoiceId?: string } = {};
    if (query.customerId) {
      filter.customerId = query.customerId;
    }
    if (query.invoiceId) {
      filter.linkedInvoiceId = query.invoiceId;
    }
    return {
      creditNotes: paginateArray(app.db.listCreditNotes(filter), pagination),
    };
  });

  app.get('/credit-notes/customers/:customerId', async (request) => {
    const params = z.object({ customerId: z.string().uuid() }).parse(request.params);
    const pagination = parsePagination(request.query);
    return {
      creditNotes: paginateArray(app.db.listCreditNotes({ customerId: params.customerId }), pagination),
    };
  });

  app.get('/credit-notes/invoices/:invoiceId', async (request) => {
    const params = z.object({ invoiceId: z.string().uuid() }).parse(request.params);
    const pagination = parsePagination(request.query);
    return {
      creditNotes: paginateArray(app.db.listCreditNotes({ linkedInvoiceId: params.invoiceId }), pagination),
    };
  });

  app.get('/credit-notes/:creditNoteId/html', async (request, reply) => {
    const params = z.object({ creditNoteId: z.string().uuid() }).parse(request.params);
    const creditNote = app.db.getCreditNoteById(params.creditNoteId);
    if (!creditNote) {
      return reply.code(404).send({ message: 'CREDIT_NOTE_NOT_FOUND' });
    }
    const customer = app.db.getCustomerById(creditNote.customerId);
    if (!customer) {
      return reply.code(404).send({ message: 'Customer not found' });
    }
    const html = renderCreditNoteHtml({ creditNote, customer });
    return reply.code(200).header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  app.get('/credit-notes/:creditNoteId/pdf', async (request, reply) => {
    const params = z.object({ creditNoteId: z.string().uuid() }).parse(request.params);
    const creditNote = app.db.getCreditNoteById(params.creditNoteId);
    if (!creditNote) {
      return reply.code(404).send({ message: 'CREDIT_NOTE_NOT_FOUND' });
    }
    const customer = app.db.getCustomerById(creditNote.customerId);
    if (!customer) {
      return reply.code(404).send({ message: 'Customer not found' });
    }
    const businessProfile = app.db.getBusinessProfile();
    const pdfBuffer = await generateCreditNotePdfBuffer({
      creditNote,
      customer,
      businessProfile,
    });
    return reply
      .code(200)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${creditNote.creditNoteNumber}.pdf"`)
      .send(pdfBuffer);
  });
};
