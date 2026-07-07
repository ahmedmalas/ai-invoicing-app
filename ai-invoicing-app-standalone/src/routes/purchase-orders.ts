import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import {
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
    return {
      purchaseOrders: app.db.listPurchaseOrders(query),
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
    const html = renderPurchaseOrderHtml({ purchaseOrder, supplier });
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
    const pdfBuffer = await generatePurchaseOrderPdfBuffer({
      purchaseOrder,
      lineItems: purchaseOrder.lineItems,
      supplier,
      businessProfile,
    });
    return reply
      .code(200)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${purchaseOrder.purchaseOrderNumber}.pdf"`)
      .send(pdfBuffer);
  });
};
