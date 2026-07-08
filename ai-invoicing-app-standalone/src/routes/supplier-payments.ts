import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import {
  createSupplierPaymentSchema,
  listSupplierPaymentsQuerySchema,
} from '../domain/supplier-payments/validation.js';
import { renderSupplierPaymentReceiptHtml } from '../services/supplier-payment-service.js';
import { generateSupplierPaymentReceiptPdfBuffer } from '../services/pdf-service.js';
import { paginateArray, parsePagination } from './pagination.js';

export const supplierPaymentRoutes: FastifyPluginAsync = async (app) => {
  app.post('/supplier-payments', async (request, reply) => {
    const body = createSupplierPaymentSchema.parse(request.body);
    const payment = app.db.createSupplierPayment(body);
    return reply.code(201).send(payment);
  });

  app.get('/supplier-payments/:paymentId', async (request, reply) => {
    const params = z.object({ paymentId: z.string().uuid() }).parse(request.params);
    const payment = app.db.getSupplierPaymentById(params.paymentId);
    if (!payment) {
      return reply.code(404).send({ message: 'SUPPLIER_PAYMENT_NOT_FOUND' });
    }
    return payment;
  });

  app.get('/supplier-payments', async (request) => {
    const query = listSupplierPaymentsQuerySchema.parse(request.query);
    const pagination = parsePagination(request.query);
    const filter: { supplierId?: string; supplierBillId?: string; from?: string; to?: string } = {};
    if (query.supplierId) filter.supplierId = query.supplierId;
    if (query.supplierBillId) filter.supplierBillId = query.supplierBillId;
    if (query.from) filter.from = query.from;
    if (query.to) filter.to = query.to;
    return {
      payments: paginateArray(app.db.listSupplierPayments(filter), pagination),
    };
  });

  app.get('/supplier-payments/suppliers/:supplierId', async (request) => {
    const params = z.object({ supplierId: z.string().uuid() }).parse(request.params);
    const pagination = parsePagination(request.query);
    return {
      payments: paginateArray(app.db.listSupplierPayments({ supplierId: params.supplierId }), pagination),
    };
  });

  app.get('/supplier-payments/bills/:supplierBillId', async (request) => {
    const params = z.object({ supplierBillId: z.string().uuid() }).parse(request.params);
    const pagination = parsePagination(request.query);
    return {
      payments: paginateArray(app.db.listSupplierPayments({ supplierBillId: params.supplierBillId }), pagination),
    };
  });

  app.get('/supplier-payments/:paymentId/html', async (request, reply) => {
    const params = z.object({ paymentId: z.string().uuid() }).parse(request.params);
    const payment = app.db.getSupplierPaymentById(params.paymentId);
    if (!payment) {
      return reply.code(404).send({ message: 'SUPPLIER_PAYMENT_NOT_FOUND' });
    }
    const supplier = app.db.getSupplierById(payment.supplierId);
    if (!supplier) {
      return reply.code(404).send({ message: 'Supplier not found' });
    }
    const html = renderSupplierPaymentReceiptHtml({ payment, supplier });
    return reply.code(200).header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  app.get('/supplier-payments/:paymentId/pdf', async (request, reply) => {
    const params = z.object({ paymentId: z.string().uuid() }).parse(request.params);
    const payment = app.db.getSupplierPaymentById(params.paymentId);
    if (!payment) {
      return reply.code(404).send({ message: 'SUPPLIER_PAYMENT_NOT_FOUND' });
    }
    const supplier = app.db.getSupplierById(payment.supplierId);
    if (!supplier) {
      return reply.code(404).send({ message: 'Supplier not found' });
    }
    const businessProfile = app.db.getBusinessProfile();
    const pdfBuffer = await generateSupplierPaymentReceiptPdfBuffer({
      payment,
      supplier,
      businessProfile,
    });
    return reply
      .code(200)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${payment.paymentNumber}.pdf"`)
      .send(pdfBuffer);
  });
};
