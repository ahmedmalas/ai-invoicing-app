import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import {
  createSupplierBillFromPurchaseOrderSchema,
  createPurchaseOrderDraftSchema,
  listPurchaseOrdersQuerySchema,
  updatePurchaseOrderDraftSchema,
} from '../domain/purchase-orders/validation.js';
import { renderPurchaseOrderHtml } from '../services/purchase-order-service.js';
import { generatePurchaseOrderPdfBuffer } from '../services/pdf-service.js';

export const purchaseOrderRoutes: FastifyPluginAsync = async (app) => {
  app.post('/purchase-orders', async (request, reply) => {
    const body = createPurchaseOrderDraftSchema.parse(request.body);
    const purchaseOrder = app.db.createPurchaseOrderDraft(body);
    return reply.code(201).send(purchaseOrder);
  });

  app.put('/purchase-orders/:purchaseOrderId', async (request) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    const body = updatePurchaseOrderDraftSchema.parse(request.body);
    return app.db.updatePurchaseOrderDraft(params.purchaseOrderId, body);
  });

  app.post('/purchase-orders/:purchaseOrderId/approve', async (request) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    return app.db.approvePurchaseOrder(params.purchaseOrderId);
  });

  app.post('/purchase-orders/:purchaseOrderId/close', async (request) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    return app.db.closePurchaseOrder(params.purchaseOrderId);
  });

  app.post('/purchase-orders/:purchaseOrderId/cancel', async (request) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    return app.db.cancelPurchaseOrder(params.purchaseOrderId);
  });

  app.post('/purchase-orders/:purchaseOrderId/create-supplier-bill', async (request, reply) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    const body = createSupplierBillFromPurchaseOrderSchema.parse(request.body ?? {});
    const supplierBill = app.db.createSupplierBillDraftFromPurchaseOrder(params.purchaseOrderId, body);
    return reply.code(201).send(supplierBill);
  });

  app.get('/purchase-orders/:purchaseOrderId', async (request, reply) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    const purchaseOrder = app.db.getPurchaseOrderById(params.purchaseOrderId);
    if (!purchaseOrder) {
      return reply.code(404).send({ message: 'PURCHASE_ORDER_NOT_FOUND' });
    }
    return purchaseOrder;
  });

  app.get('/purchase-orders', async (request) => {
    const query = listPurchaseOrdersQuerySchema.parse(request.query);
    const filter: {
      supplierId?: string;
      purchaseOrderNumber?: string;
      status?: 'Draft' | 'Approved' | 'Closed' | 'Cancelled';
      billingStatus?: 'unbilled' | 'partially_billed' | 'fully_billed';
      fromIssueDate?: string;
      toIssueDate?: string;
      fromExpectedDeliveryDate?: string;
      toExpectedDeliveryDate?: string;
    } = {};
    if (query.supplierId) filter.supplierId = query.supplierId;
    if (query.purchaseOrderNumber) filter.purchaseOrderNumber = query.purchaseOrderNumber;
    if (query.status) filter.status = query.status;
    if (query.billingStatus) filter.billingStatus = query.billingStatus;
    if (query.fromIssueDate) filter.fromIssueDate = query.fromIssueDate;
    if (query.toIssueDate) filter.toIssueDate = query.toIssueDate;
    if (query.fromExpectedDeliveryDate) filter.fromExpectedDeliveryDate = query.fromExpectedDeliveryDate;
    if (query.toExpectedDeliveryDate) filter.toExpectedDeliveryDate = query.toExpectedDeliveryDate;
    return {
      purchaseOrders: app.db.listPurchaseOrders(filter),
    };
  });

  app.get('/purchase-orders/:purchaseOrderId/html', async (request, reply) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    const purchaseOrder = app.db.getPurchaseOrderById(params.purchaseOrderId);
    if (!purchaseOrder) {
      return reply.code(404).send({ message: 'PURCHASE_ORDER_NOT_FOUND' });
    }
    const supplier = app.db.getSupplierById(purchaseOrder.supplierId);
    if (!supplier) {
      return reply.code(404).send({ message: 'Supplier not found' });
    }
    const linkedSupplierBills = app.db.listSupplierBills({ sourcePurchaseOrderId: purchaseOrder.id });
    const html = renderPurchaseOrderHtml({ purchaseOrder, supplier, linkedSupplierBills });
    return reply.code(200).header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  app.get('/purchase-orders/:purchaseOrderId/pdf', async (request, reply) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    const purchaseOrder = app.db.getPurchaseOrderById(params.purchaseOrderId);
    if (!purchaseOrder) {
      return reply.code(404).send({ message: 'PURCHASE_ORDER_NOT_FOUND' });
    }
    const supplier = app.db.getSupplierById(purchaseOrder.supplierId);
    if (!supplier) {
      return reply.code(404).send({ message: 'Supplier not found' });
    }
    const businessProfile = app.db.getBusinessProfile();
    const linkedSupplierBills = app.db.listSupplierBills({ sourcePurchaseOrderId: purchaseOrder.id });
    const pdfBuffer = await generatePurchaseOrderPdfBuffer({
      purchaseOrder,
      lineItems: purchaseOrder.lineItems,
      supplier,
      businessProfile,
      linkedSupplierBills,
    });
    return reply
      .code(200)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${purchaseOrder.purchaseOrderNumber}.pdf"`)
      .send(pdfBuffer);
  });
};
