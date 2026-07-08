import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import {
  createCustomerPaymentSchema,
  listCustomerPaymentsQuerySchema,
} from '../domain/payments/validation.js';
import { renderPaymentReceiptHtml } from '../services/payment-service.js';
import { generatePaymentReceiptPdfBuffer } from '../services/pdf-service.js';
import { paginateArray, parsePagination } from './pagination.js';

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  app.post('/payments', async (request, reply) => {
    const body = createCustomerPaymentSchema.parse(request.body);
    const payment = app.db.createCustomerPayment(body);
    return reply.code(201).send(payment);
  });

  app.get('/payments/:paymentId', async (request, reply) => {
    const params = z.object({ paymentId: z.string().uuid() }).parse(request.params);
    const payment = app.db.getCustomerPaymentById(params.paymentId);
    if (!payment) {
      return reply.code(404).send({ message: 'PAYMENT_NOT_FOUND' });
    }
    return payment;
  });

  app.get('/payments', async (request) => {
    const query = listCustomerPaymentsQuerySchema.parse(request.query);
    const pagination = parsePagination(request.query);
    const filter: { customerId?: string; invoiceId?: string; from?: string; to?: string } = {};
    if (query.customerId) {
      filter.customerId = query.customerId;
    }
    if (query.invoiceId) {
      filter.invoiceId = query.invoiceId;
    }
    if (query.from) {
      filter.from = query.from;
    }
    if (query.to) {
      filter.to = query.to;
    }
    return {
      payments: paginateArray(app.db.listCustomerPayments(filter), pagination),
    };
  });

  app.get('/payments/customers/:customerId', async (request) => {
    const params = z.object({ customerId: z.string().uuid() }).parse(request.params);
    const pagination = parsePagination(request.query);
    return {
      payments: paginateArray(app.db.listCustomerPayments({ customerId: params.customerId }), pagination),
    };
  });

  app.get('/payments/invoices/:invoiceId', async (request) => {
    const params = z.object({ invoiceId: z.string().uuid() }).parse(request.params);
    const pagination = parsePagination(request.query);
    return {
      payments: paginateArray(app.db.listCustomerPayments({ invoiceId: params.invoiceId }), pagination),
    };
  });

  app.get('/payments/:paymentId/html', async (request, reply) => {
    const params = z.object({ paymentId: z.string().uuid() }).parse(request.params);
    const payment = app.db.getCustomerPaymentById(params.paymentId);
    if (!payment) {
      return reply.code(404).send({ message: 'PAYMENT_NOT_FOUND' });
    }
    const customer = app.db.getCustomerById(payment.customerId);
    if (!customer) {
      return reply.code(404).send({ message: 'Customer not found' });
    }
    const html = renderPaymentReceiptHtml({ payment, customer });
    return reply.code(200).header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  app.get('/payments/:paymentId/pdf', async (request, reply) => {
    const params = z.object({ paymentId: z.string().uuid() }).parse(request.params);
    const payment = app.db.getCustomerPaymentById(params.paymentId);
    if (!payment) {
      return reply.code(404).send({ message: 'PAYMENT_NOT_FOUND' });
    }
    const customer = app.db.getCustomerById(payment.customerId);
    if (!customer) {
      return reply.code(404).send({ message: 'Customer not found' });
    }
    const businessProfile = app.db.getBusinessProfile();
    const pdfBuffer = await generatePaymentReceiptPdfBuffer({
      payment,
      customer,
      businessProfile,
    });
    return reply
      .code(200)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${payment.paymentNumber}.pdf"`)
      .send(pdfBuffer);
  });
};
