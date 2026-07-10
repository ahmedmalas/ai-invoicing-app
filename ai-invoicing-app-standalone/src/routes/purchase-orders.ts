import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import {
  closePurchaseOrderSchema,
  createSupplierBillFromPurchaseOrderSchema,
  createPurchaseOrderDraftSchema,
  listPurchaseOrdersQuerySchema,
  updatePurchaseOrderDraftSchema,
} from '../domain/purchase-orders/validation.js';
import { renderPurchaseOrderHtml } from '../services/purchase-order-service.js';
import { generatePurchaseOrderPdfBuffer } from '../services/pdf-service.js';
import { parsePagination } from './pagination.js';

export const purchaseOrderRoutes: FastifyPluginAsync = async (app) => {
  app.post('/purchase-orders', async (request, reply) => {
    const body = createPurchaseOrderDraftSchema.parse(request.body);
    const purchaseOrder = await app.db.createPurchaseOrderDraft(body);
    return reply.code(201).send(purchaseOrder);
  });

  app.put('/purchase-orders/:purchaseOrderId', async (request) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    const body = updatePurchaseOrderDraftSchema.parse(request.body);
    return await app.db.updatePurchaseOrderDraft(params.purchaseOrderId, body);
  });

  app.post('/purchase-orders/:purchaseOrderId/approve', async (request) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    return await app.db.approvePurchaseOrder(params.purchaseOrderId);
  });

  app.post('/purchase-orders/:purchaseOrderId/close', async (request) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    const body = closePurchaseOrderSchema.parse(request.body ?? {});
    return await app.db.closePurchaseOrder(params.purchaseOrderId, body);
  });

  app.post('/purchase-orders/:purchaseOrderId/cancel', async (request) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    return await app.db.cancelPurchaseOrder(params.purchaseOrderId);
  });

  app.post('/purchase-orders/:purchaseOrderId/create-supplier-bill', async (request, reply) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    const body = createSupplierBillFromPurchaseOrderSchema.parse(request.body ?? {});
    const conversionInput: { lineItems?: Array<{ purchaseOrderLineItemId: string; quantity: number }> } = {};
    if (body.lineItems) {
      conversionInput.lineItems = body.lineItems;
    }
    const supplierBill = await app.db.createSupplierBillDraftFromPurchaseOrder(
      params.purchaseOrderId,
      conversionInput,
    );
    return reply.code(201).send(supplierBill);
  });

  app.get('/purchase-orders/:purchaseOrderId', async (request, reply) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    const purchaseOrder = await app.db.getPurchaseOrderById(params.purchaseOrderId);
    if (!purchaseOrder) {
      return reply.code(404).send({ message: 'PURCHASE_ORDER_NOT_FOUND' });
    }
    return purchaseOrder;
  });

  app.delete('/purchase-orders/:purchaseOrderId', async (request, reply) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    await app.db.deletePurchaseOrderDraft(params.purchaseOrderId);
    return reply.code(204).send();
  });

  app.get('/purchase-orders', async (request) => {
    const query = listPurchaseOrdersQuerySchema.parse(request.query);
    const pagination = parsePagination(request.query);
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
      purchaseOrders: await app.db.listPurchaseOrders(filter, pagination),
    };
  });

  app.get('/purchase-orders/:purchaseOrderId/html', async (request, reply) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    const purchaseOrder = await app.db.getPurchaseOrderById(params.purchaseOrderId);
    if (!purchaseOrder) {
      return reply.code(404).send({ message: 'PURCHASE_ORDER_NOT_FOUND' });
    }
    const supplier = await app.db.getSupplierById(purchaseOrder.supplierId);
    if (!supplier) {
      return reply.code(404).send({ message: 'Supplier not found' });
    }
    const linkedSupplierBills = await app.db.listSupplierBills({
      sourcePurchaseOrderId: purchaseOrder.id,
    });
    const linkedBillSummary = linkedSupplierBills.map((bill) => ({
      billNumber: bill.billNumber,
      status: bill.status,
      total: bill.totals.total,
    }));
    const html = renderPurchaseOrderHtml({ purchaseOrder, supplier, linkedSupplierBills: linkedBillSummary });
    return reply.code(200).header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  app.get('/purchase-orders/:purchaseOrderId/pdf', async (request, reply) => {
    const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
    const purchaseOrder = await app.db.getPurchaseOrderById(params.purchaseOrderId);
    if (!purchaseOrder) {
      return reply.code(404).send({ message: 'PURCHASE_ORDER_NOT_FOUND' });
    }
    const supplier = await app.db.getSupplierById(purchaseOrder.supplierId);
    if (!supplier) {
      return reply.code(404).send({ message: 'Supplier not found' });
    }
    const businessProfile = await app.db.getBusinessProfile();
    const linkedSupplierBills = await app.db.listSupplierBills({
      sourcePurchaseOrderId: purchaseOrder.id,
    });
    const linkedBillSummary = linkedSupplierBills.map((bill) => ({
      billNumber: bill.billNumber,
      status: bill.status,
      total: bill.totals.total,
    }));
    const pdfBuffer = await generatePurchaseOrderPdfBuffer({
      purchaseOrder,
      lineItems: purchaseOrder.lineItems,
      supplier,
      businessProfile,
      linkedSupplierBills: linkedBillSummary,
    });
    return reply
      .code(200)
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="${purchaseOrder.purchaseOrderNumber}.pdf"`)
      .send(pdfBuffer);
  });
};
