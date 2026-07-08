import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import {
  createSupplierBillDraftSchema,
  listSupplierBillsQuerySchema,
  updateSupplierBillDraftSchema,
} from '../domain/supplier-bills/validation.js';
import { renderSupplierBillHtml } from '../services/supplier-bill-service.js';
import { generateSupplierBillPdfBuffer } from '../services/pdf-service.js';
import { paginateArray, parsePagination } from './pagination.js';

export const supplierBillRoutes: FastifyPluginAsync = async (app) => {
  app.post('/supplier-bills', async (request, reply) => {
    const body = createSupplierBillDraftSchema.parse(request.body);
    const bill = app.db.createSupplierBillDraft(body);
    return reply.code(201).send(bill);
  });

  app.put('/supplier-bills/:billId', async (request) => {
    const params = z.object({ billId: z.string().uuid() }).parse(request.params);
    const body = updateSupplierBillDraftSchema.parse(request.body);
    return app.db.updateSupplierBillDraft(params.billId, body);
  });

  app.post('/supplier-bills/:billId/finalise', async (request) => {
    const params = z.object({ billId: z.string().uuid() }).parse(request.params);
    return app.db.finaliseSupplierBill(params.billId);
  });

  app.get('/supplier-bills/:billId', async (request, reply) => {
    const params = z.object({ billId: z.string().uuid() }).parse(request.params);
    const bill = app.db.getSupplierBillById(params.billId);
    if (!bill) {
      return reply.code(404).send({ message: 'SUPPLIER_BILL_NOT_FOUND' });
    }
    return bill;
  });

  app.delete('/supplier-bills/:billId', async (request, reply) => {
    const params = z.object({ billId: z.string().uuid() }).parse(request.params);
    app.db.deleteSupplierBillDraft(params.billId);
    return reply.code(204).send();
  });

  app.get('/supplier-bills', async (request) => {
    const query = listSupplierBillsQuerySchema.parse(request.query);
    const pagination = parsePagination(request.query);
    const filter: {
      supplierId?: string;
      sourcePurchaseOrderId?: string;
      billNumber?: string;
      fromBillDate?: string;
      toBillDate?: string;
      fromDueDate?: string;
      toDueDate?: string;
      status?: 'Draft' | 'Finalised';
      paymentState?: 'Draft' | 'Sent' | 'Awaiting Payment' | 'Paid' | 'Cancelled';
    } = {};
    if (query.supplierId) filter.supplierId = query.supplierId;
    if (query.sourcePurchaseOrderId) filter.sourcePurchaseOrderId = query.sourcePurchaseOrderId;
    if (query.billNumber) filter.billNumber = query.billNumber;
    if (query.fromBillDate) filter.fromBillDate = query.fromBillDate;
    if (query.toBillDate) filter.toBillDate = query.toBillDate;
    if (query.fromDueDate) filter.fromDueDate = query.fromDueDate;
    if (query.toDueDate) filter.toDueDate = query.toDueDate;
    if (query.status) filter.status = query.status;
    if (query.paymentState) filter.paymentState = query.paymentState;
    return {
      bills: paginateArray(app.db.listSupplierBills(filter), pagination),
    };
  });

  app.get('/supplier-bills/:billId/html', async (request, reply) => {
    const params = z.object({ billId: z.string().uuid() }).parse(request.params);
    const bill = app.db.getSupplierBillById(params.billId);
    if (!bill) {
      return reply.code(404).send({ message: 'SUPPLIER_BILL_NOT_FOUND' });
    }
    const supplier = app.db.getSupplierById(bill.supplierId);
    if (!supplier) {
      return reply.code(404).send({ message: 'Supplier not found' });
    }
    const html = renderSupplierBillHtml({
      bill,
      supplier,
      sourcePurchaseOrderNumber: bill.sourcePurchaseOrderNumber,
    });
    return reply.code(200).header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  app.get('/supplier-bills/:billId/pdf', async (request, reply) => {
    const params = z.object({ billId: z.string().uuid() }).parse(request.params);
    const bill = app.db.getSupplierBillById(params.billId);
    if (!bill) {
      return reply.code(404).send({ message: 'SUPPLIER_BILL_NOT_FOUND' });
    }
    const supplier = app.db.getSupplierById(bill.supplierId);
    if (!supplier) {
      return reply.code(404).send({ message: 'Supplier not found' });
    }
    const businessProfile = app.db.getBusinessProfile();
    const pdfBuffer = await generateSupplierBillPdfBuffer({
      bill,
      lineItems: bill.lineItems,
      supplier,
      businessProfile,
      sourcePurchaseOrderNumber: bill.sourcePurchaseOrderNumber,
    });
    return reply
      .code(200)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${bill.billNumber ?? bill.id}.pdf"`)
      .send(pdfBuffer);
  });
};
