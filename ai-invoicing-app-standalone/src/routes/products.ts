import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { renderBarcodeSvg, renderQrSvg } from '../domain/inventory/barcode.js';
import {
  adjustStockSchema,
  createProductSchema,
  createStocktakeSchema,
  listProductsQuerySchema,
  lookupCodeSchema,
  receivePurchaseOrderSchema,
  setJobMaterialsSchema,
  transferStockSchema,
  updateProductSchema,
  updateStocktakeCountsSchema,
} from '../domain/inventory/validation.js';

function mapDbError(error: unknown): { status: number; message: string } | null {
  const message = error instanceof Error ? error.message : String(error);
  const map: Record<string, number> = {
    PRODUCT_NOT_FOUND: 404,
    PRODUCT_SKU_EXISTS: 409,
    PRODUCT_BARCODE_EXISTS: 409,
    PRODUCT_DOES_NOT_TRACK_STOCK: 400,
    INSUFFICIENT_STOCK: 409,
    PURCHASE_ORDER_NOT_FOUND: 404,
    PURCHASE_ORDER_NOT_RECEIVABLE: 409,
    PURCHASE_ORDER_LINE_NOT_FOUND: 404,
    RECEIVE_EXCEEDS_OUTSTANDING: 400,
    STOCKTAKE_NOT_FOUND: 404,
    STOCKTAKE_NOT_EDITABLE: 409,
    STOCKTAKE_NOT_SUBMITTABLE: 409,
    STOCKTAKE_NOT_APPROVABLE: 409,
    INVENTORY_ALERT_NOT_FOUND: 404,
    JOB_NOT_FOUND: 404,
    BUNDLE_HAS_NO_COMPONENTS: 400,
    TRANSFER_BUCKETS_MUST_DIFFER: 400,
  };
  if (message in map) return { status: map[message]!, message };
  return null;
}

export const productRoutes: FastifyPluginAsync = async (app) => {
  app.post('/products', async (request, reply) => {
    try {
      const body = createProductSchema.parse(request.body);
      const product = await app.db.createProduct(body);
      return reply.code(201).send(product);
    } catch (error) {
      const mapped = mapDbError(error);
      if (mapped) return reply.code(mapped.status).send({ message: mapped.message });
      throw error;
    }
  });

  app.get('/products', async (request) => {
    const query = listProductsQuerySchema.parse(request.query);
    return { products: await app.db.listProducts(query) };
  });

  app.get('/products/lookup', async (request, reply) => {
    const query = lookupCodeSchema.parse(request.query);
    const product = await app.db.lookupProductByCode(query.code);
    if (!product) return reply.code(404).send({ message: 'PRODUCT_NOT_FOUND' });
    return product;
  });

  app.get('/products/:productId', async (request, reply) => {
    const params = z.object({ productId: z.string().uuid() }).parse(request.params);
    const product = await app.db.getProductById(params.productId);
    if (!product) return reply.code(404).send({ message: 'PRODUCT_NOT_FOUND' });
    return product;
  });

  app.put('/products/:productId', async (request, reply) => {
    try {
      const params = z.object({ productId: z.string().uuid() }).parse(request.params);
      const body = updateProductSchema.parse(request.body);
      return await app.db.updateProduct(params.productId, body);
    } catch (error) {
      const mapped = mapDbError(error);
      if (mapped) return reply.code(mapped.status).send({ message: mapped.message });
      throw error;
    }
  });

  app.post('/products/:productId/archive', async (request, reply) => {
    try {
      const params = z.object({ productId: z.string().uuid() }).parse(request.params);
      return await app.db.archiveProduct(params.productId);
    } catch (error) {
      const mapped = mapDbError(error);
      if (mapped) return reply.code(mapped.status).send({ message: mapped.message });
      throw error;
    }
  });

  app.get('/products/:productId/barcode.svg', async (request, reply) => {
    const params = z.object({ productId: z.string().uuid() }).parse(request.params);
    const product = await app.db.getProductById(params.productId);
    if (!product) return reply.code(404).send({ message: 'PRODUCT_NOT_FOUND' });
    const payload = product.barcode || product.sku;
    return reply
      .type('image/svg+xml')
      .header('Cache-Control', 'no-cache')
      .send(renderBarcodeSvg(payload, product.sku));
  });

  app.get('/products/:productId/qr.svg', async (request, reply) => {
    const params = z.object({ productId: z.string().uuid() }).parse(request.params);
    const product = await app.db.getProductById(params.productId);
    if (!product) return reply.code(404).send({ message: 'PRODUCT_NOT_FOUND' });
    const payload = product.qrPayload || product.sku;
    return reply
      .type('image/svg+xml')
      .header('Cache-Control', 'no-cache')
      .send(renderQrSvg(payload));
  });

  app.post('/inventory/adjust', async (request, reply) => {
    try {
      const body = adjustStockSchema.parse(request.body);
      return reply.code(201).send(await app.db.adjustStock(body));
    } catch (error) {
      const mapped = mapDbError(error);
      if (mapped) return reply.code(mapped.status).send({ message: mapped.message });
      throw error;
    }
  });

  app.post('/inventory/transfer', async (request, reply) => {
    try {
      const body = transferStockSchema.parse(request.body);
      return reply.code(201).send(await app.db.transferStock(body));
    } catch (error) {
      const mapped = mapDbError(error);
      if (mapped) return reply.code(mapped.status).send({ message: mapped.message });
      throw error;
    }
  });

  app.get('/inventory/movements', async (request) => {
    const query = z
      .object({
        productId: z.string().uuid().optional(),
        limit: z.coerce.number().int().positive().max(500).optional(),
        offset: z.coerce.number().int().nonnegative().optional(),
      })
      .parse(request.query);
    return { movements: await app.db.listStockMovements(query) };
  });

  app.get('/inventory/alerts', async (request) => {
    const query = z
      .object({
        includeDismissed: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => value === 'true'),
      })
      .parse(request.query);
    return { alerts: await app.db.listInventoryAlerts(query.includeDismissed) };
  });

  app.post('/inventory/alerts/refresh', async () => {
    return { alerts: await app.db.refreshAllInventoryAlerts() };
  });

  app.post('/inventory/alerts/:alertId/dismiss', async (request, reply) => {
    try {
      const params = z.object({ alertId: z.string().uuid() }).parse(request.params);
      await app.db.dismissInventoryAlert(params.alertId);
      return reply.code(204).send();
    } catch (error) {
      const mapped = mapDbError(error);
      if (mapped) return reply.code(mapped.status).send({ message: mapped.message });
      throw error;
    }
  });

  app.get('/inventory/reports', async () => {
    return await app.db.getInventoryReports();
  });

  app.post('/purchase-orders/:purchaseOrderId/receive', async (request, reply) => {
    try {
      const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
      const body = receivePurchaseOrderSchema.parse(request.body);
      return reply.code(201).send(await app.db.receivePurchaseOrder(params.purchaseOrderId, body));
    } catch (error) {
      const mapped = mapDbError(error);
      if (mapped) return reply.code(mapped.status).send({ message: mapped.message });
      throw error;
    }
  });

  app.get('/purchase-orders/:purchaseOrderId/receipt-status', async (request, reply) => {
    try {
      const params = z.object({ purchaseOrderId: z.string().uuid() }).parse(request.params);
      return { receiptStatus: await app.db.getPurchaseOrderReceiptStatus(params.purchaseOrderId) };
    } catch (error) {
      const mapped = mapDbError(error);
      if (mapped) return reply.code(mapped.status).send({ message: mapped.message });
      throw error;
    }
  });

  app.post('/stocktakes', async (request, reply) => {
    const body = createStocktakeSchema.parse(request.body ?? {});
    return reply.code(201).send(await app.db.createStocktake(body));
  });

  app.get('/stocktakes', async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().positive().max(200).optional(),
        offset: z.coerce.number().int().nonnegative().optional(),
      })
      .parse(request.query);
    return { stocktakes: await app.db.listStocktakes(query.limit, query.offset) };
  });

  app.get('/stocktakes/:stocktakeId', async (request, reply) => {
    const params = z.object({ stocktakeId: z.string().uuid() }).parse(request.params);
    const stocktake = await app.db.getStocktakeById(params.stocktakeId);
    if (!stocktake) return reply.code(404).send({ message: 'STOCKTAKE_NOT_FOUND' });
    return stocktake;
  });

  app.put('/stocktakes/:stocktakeId/counts', async (request, reply) => {
    try {
      const params = z.object({ stocktakeId: z.string().uuid() }).parse(request.params);
      const body = updateStocktakeCountsSchema.parse(request.body);
      return await app.db.updateStocktakeCounts(params.stocktakeId, body.lines);
    } catch (error) {
      const mapped = mapDbError(error);
      if (mapped) return reply.code(mapped.status).send({ message: mapped.message });
      throw error;
    }
  });

  app.post('/stocktakes/:stocktakeId/submit', async (request, reply) => {
    try {
      const params = z.object({ stocktakeId: z.string().uuid() }).parse(request.params);
      return await app.db.submitStocktake(params.stocktakeId);
    } catch (error) {
      const mapped = mapDbError(error);
      if (mapped) return reply.code(mapped.status).send({ message: mapped.message });
      throw error;
    }
  });

  app.post('/stocktakes/:stocktakeId/approve', async (request, reply) => {
    try {
      const params = z.object({ stocktakeId: z.string().uuid() }).parse(request.params);
      const body = z.object({ approvedBy: z.string().min(1).optional() }).parse(request.body ?? {});
      return await app.db.approveStocktake(params.stocktakeId, body.approvedBy ?? null);
    } catch (error) {
      const mapped = mapDbError(error);
      if (mapped) return reply.code(mapped.status).send({ message: mapped.message });
      throw error;
    }
  });

  app.put('/jobs/:jobId/materials', async (request, reply) => {
    try {
      const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
      const body = setJobMaterialsSchema.parse(request.body);
      return { materials: await app.db.setJobMaterials(params.jobId, body.materials) };
    } catch (error) {
      const mapped = mapDbError(error);
      if (mapped) return reply.code(mapped.status).send({ message: mapped.message });
      throw error;
    }
  });
};
