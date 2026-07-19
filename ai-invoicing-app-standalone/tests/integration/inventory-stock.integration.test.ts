import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

describe('inventory stock integration', () => {
  it('supports product CRUD, PO receive, invoice stock-out, stocktake, and alerts', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const supplierRes = await app.inject({
      method: 'POST',
      url: '/suppliers',
      payload: {
        displayName: 'Parts Co',
        email: 'parts@example.com',
        contactPerson: 'Sam Supplier',
        paymentTerms: 'Net 14',
      },
    });
    expect(supplierRes.statusCode).toBe(201);
    const supplier = idSchema.parse(supplierRes.json());

    const productRes = await app.inject({
      method: 'POST',
      url: '/products',
      payload: {
        sku: 'FILT-100',
        barcode: '9300001000001',
        name: 'Cabin Filter',
        category: 'Filters',
        costPrice: 12,
        sellPrice: 30,
        minimumStockLevel: 5,
        reorderQuantity: 20,
        openingStock: 2,
        gstStatus: 'gst',
        trackStock: true,
      },
    });
    expect(productRes.statusCode).toBe(201);
    const product = z
      .object({
        id: z.string().uuid(),
        sku: z.string(),
        stock: z.object({ onHand: z.number(), available: z.number() }),
      })
      .parse(productRes.json());
    expect(product.stock.onHand).toBe(2);

    const lookupRes = await app.inject({
      method: 'GET',
      url: '/products/lookup?code=9300001000001',
    });
    expect(lookupRes.statusCode).toBe(200);
    expect(idSchema.parse(lookupRes.json()).id).toBe(product.id);

    const barcodeRes = await app.inject({
      method: 'GET',
      url: `/products/${product.id}/barcode.svg`,
    });
    expect(barcodeRes.statusCode).toBe(200);
    expect(String(barcodeRes.body)).toContain('<svg');

    const poRes = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      payload: {
        supplierId: supplier.id,
        issueDate: '2026-07-10',
        currency: 'AUD',
        lineItems: [
          {
            description: 'Cabin Filter',
            quantity: 10,
            unitPrice: 12,
            gstApplicable: true,
            productId: product.id,
          },
        ],
      },
    });
    expect(poRes.statusCode).toBe(201);
    const purchaseOrderId = idSchema.parse(poRes.json()).id;
    const poGetRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${purchaseOrderId}`,
    });
    expect(poGetRes.statusCode).toBe(200);
    const purchaseOrder = z
      .object({
        id: z.string().uuid(),
        lineItems: z.array(z.object({ id: z.string().uuid(), quantity: z.number() })),
      })
      .parse(poGetRes.json());

    const approveRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${purchaseOrder.id}/approve`,
    });
    expect(approveRes.statusCode).toBe(200);

    const receivePartialRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${purchaseOrder.id}/receive`,
      payload: {
        lineItems: [
          {
            purchaseOrderLineItemId: purchaseOrder.lineItems[0]!.id,
            quantityReceived: 4,
            productId: product.id,
          },
        ],
      },
    });
    expect(receivePartialRes.statusCode).toBe(201);
    expect(
      z.object({ receiptStatus: z.string() }).parse(receivePartialRes.json()).receiptStatus,
    ).toBe('partial');

    const afterPartial = await app.inject({ method: 'GET', url: `/products/${product.id}` });
    expect(
      z.object({ stock: z.object({ onHand: z.number() }) }).parse(afterPartial.json()).stock.onHand,
    ).toBe(6);

    const receiveRestRes = await app.inject({
      method: 'POST',
      url: `/purchase-orders/${purchaseOrder.id}/receive`,
      payload: {
        lineItems: [
          {
            purchaseOrderLineItemId: purchaseOrder.lineItems[0]!.id,
            quantityReceived: 6,
            productId: product.id,
          },
        ],
      },
    });
    expect(receiveRestRes.statusCode).toBe(201);
    expect(z.object({ receiptStatus: z.string() }).parse(receiveRestRes.json()).receiptStatus).toBe(
      'received',
    );

    const customerRes = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'Inventory Customer' },
    });
    const customer = idSchema.parse(customerRes.json());

    const invoiceRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customer.id,
        title: 'Filter replacement',
        issueDate: '2026-07-18',
        dueDate: '2026-08-01',
        lineItems: [
          {
            description: 'Cabin Filter',
            quantity: 3,
            unitPrice: 30,
            gstApplicable: true,
            productId: product.id,
          },
        ],
      },
    });
    expect(invoiceRes.statusCode).toBe(201);
    const invoice = idSchema.parse(invoiceRes.json());

    const finaliseRes = await app.inject({
      method: 'POST',
      url: `/invoices/${invoice.id}/finalise`,
    });
    expect(finaliseRes.statusCode).toBe(200);

    const afterSale = await app.inject({ method: 'GET', url: `/products/${product.id}` });
    expect(
      z.object({ stock: z.object({ onHand: z.number() }) }).parse(afterSale.json()).stock.onHand,
    ).toBe(9);

    const stocktakeRes = await app.inject({
      method: 'POST',
      url: '/stocktakes',
      payload: { type: 'partial', productIds: [product.id] },
    });
    expect(stocktakeRes.statusCode).toBe(201);
    const stocktake = z
      .object({
        id: z.string().uuid(),
        lines: z.array(z.object({ productId: z.string().uuid(), expectedQuantity: z.number() })),
      })
      .parse(stocktakeRes.json());

    const countRes = await app.inject({
      method: 'PUT',
      url: `/stocktakes/${stocktake.id}/counts`,
      payload: {
        lines: [{ productId: product.id, countedQuantity: 8 }],
      },
    });
    expect(countRes.statusCode).toBe(200);

    const submitRes = await app.inject({
      method: 'POST',
      url: `/stocktakes/${stocktake.id}/submit`,
    });
    expect(submitRes.statusCode).toBe(200);

    const approveStocktakeRes = await app.inject({
      method: 'POST',
      url: `/stocktakes/${stocktake.id}/approve`,
      payload: { approvedBy: 'tester' },
    });
    expect(approveStocktakeRes.statusCode).toBe(200);

    const afterStocktake = await app.inject({ method: 'GET', url: `/products/${product.id}` });
    expect(
      z.object({ stock: z.object({ onHand: z.number() }) }).parse(afterStocktake.json()).stock
        .onHand,
    ).toBe(8);

    const alertsRes = await app.inject({ method: 'POST', url: '/inventory/alerts/refresh' });
    expect(alertsRes.statusCode).toBe(200);

    const reportsRes = await app.inject({ method: 'GET', url: '/inventory/reports' });
    expect(reportsRes.statusCode).toBe(200);
    expect(
      Array.isArray(
        z.object({ stockValuation: z.array(z.unknown()) }).parse(reportsRes.json()).stockValuation,
      ),
    ).toBe(true);

    const componentRes = await app.inject({
      method: 'POST',
      url: '/products',
      payload: {
        sku: 'BOLT-1',
        name: 'Bolt',
        costPrice: 1,
        sellPrice: 2,
        openingStock: 50,
        trackStock: true,
      },
    });
    const component = idSchema.parse(componentRes.json());

    const kitRes = await app.inject({
      method: 'POST',
      url: '/products',
      payload: {
        sku: 'KIT-1',
        name: 'Service Kit',
        isBundle: true,
        bundleKind: 'kit',
        trackStock: false,
        sellPrice: 40,
        bundleComponents: [{ componentProductId: component.id, quantity: 2 }],
      },
    });
    expect(kitRes.statusCode).toBe(201);
    const kit = idSchema.parse(kitRes.json());

    const kitInvoiceRes = await app.inject({
      method: 'POST',
      url: '/invoices',
      payload: {
        customerId: customer.id,
        title: 'Kit sale',
        issueDate: '2026-07-18',
        dueDate: '2026-08-01',
        lineItems: [
          {
            description: 'Service Kit',
            quantity: 1,
            unitPrice: 40,
            gstApplicable: true,
            productId: kit.id,
          },
        ],
      },
    });
    const kitInvoice = idSchema.parse(kitInvoiceRes.json());
    const kitFinalise = await app.inject({
      method: 'POST',
      url: `/invoices/${kitInvoice.id}/finalise`,
    });
    expect(kitFinalise.statusCode).toBe(200);
    const componentAfter = await app.inject({ method: 'GET', url: `/products/${component.id}` });
    expect(
      z.object({ stock: z.object({ onHand: z.number() }) }).parse(componentAfter.json()).stock
        .onHand,
    ).toBe(48);

    await app.close();
  });

  it('covers catalogue mutations, transfers, movements, alerts, job materials, and receipt status', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const productRes = await app.inject({
      method: 'POST',
      url: '/products',
      payload: {
        sku: 'WIRE-10',
        barcode: '9300002000002',
        name: 'Copper Wire',
        costPrice: 4,
        sellPrice: 9,
        minimumStockLevel: 10,
        reorderQuantity: 25,
        openingStock: 15,
        trackStock: true,
      },
    });
    expect(productRes.statusCode).toBe(201);
    const product = idSchema.parse(productRes.json());

    const listRes = await app.inject({ method: 'GET', url: '/products?q=WIRE' });
    expect(listRes.statusCode).toBe(200);
    expect(
      z
        .object({ products: z.array(z.object({ id: z.string().uuid() })) })
        .parse(listRes.json())
        .products.some((row) => row.id === product.id),
    ).toBe(true);

    const updateRes = await app.inject({
      method: 'PUT',
      url: `/products/${product.id}`,
      payload: { name: 'Copper Wire 10mm', sellPrice: 10 },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(z.object({ name: z.string() }).parse(updateRes.json()).name).toBe('Copper Wire 10mm');

    const qrRes = await app.inject({ method: 'GET', url: `/products/${product.id}/qr.svg` });
    expect(qrRes.statusCode).toBe(200);
    expect(String(qrRes.body)).toContain('<svg');

    const adjustRes = await app.inject({
      method: 'POST',
      url: '/inventory/adjust',
      payload: {
        productId: product.id,
        movementType: 'manual_adjustment',
        quantityDelta: 3,
        notes: 'Cycle count top-up',
      },
    });
    expect(adjustRes.statusCode).toBe(201);

    const transferRes = await app.inject({
      method: 'POST',
      url: '/inventory/transfer',
      payload: {
        productId: product.id,
        quantity: 2,
        fromBucket: 'on_hand',
        toBucket: 'damaged',
        notes: 'Damaged reel',
      },
    });
    expect(transferRes.statusCode).toBe(201);

    const sameBucketTransfer = await app.inject({
      method: 'POST',
      url: '/inventory/transfer',
      payload: {
        productId: product.id,
        quantity: 1,
        fromBucket: 'on_hand',
        toBucket: 'on_hand',
      },
    });
    expect(sameBucketTransfer.statusCode).toBe(400);

    const movementsRes = await app.inject({
      method: 'GET',
      url: `/inventory/movements?productId=${product.id}`,
    });
    expect(movementsRes.statusCode).toBe(200);
    expect(
      z.object({ movements: z.array(z.unknown()) }).parse(movementsRes.json()).movements.length,
    ).toBeGreaterThan(0);

    const alertsRefresh = await app.inject({ method: 'POST', url: '/inventory/alerts/refresh' });
    expect(alertsRefresh.statusCode).toBe(200);
    const alertsList = await app.inject({ method: 'GET', url: '/inventory/alerts' });
    expect(alertsList.statusCode).toBe(200);
    const alerts = z
      .object({ alerts: z.array(z.object({ id: z.string().uuid() })) })
      .parse(alertsList.json()).alerts;
    if (alerts[0]) {
      const dismissRes = await app.inject({
        method: 'POST',
        url: `/inventory/alerts/${alerts[0].id}/dismiss`,
      });
      expect(dismissRes.statusCode).toBe(204);
    }

    const customer = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/customers',
          payload: { displayName: 'Job Materials Customer' },
        })
      ).json(),
    );
    const jobRes = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: {
        customerId: customer.id,
        title: 'Wire install',
        status: 'Draft',
      },
    });
    expect(jobRes.statusCode).toBe(201);
    const job = idSchema.parse(jobRes.json());

    const materialsRes = await app.inject({
      method: 'PUT',
      url: `/jobs/${job.id}/materials`,
      payload: {
        materials: [{ productId: product.id, quantity: 1 }],
      },
    });
    expect(materialsRes.statusCode).toBe(200);

    for (const status of ['Scheduled', 'In Progress', 'Completed'] as const) {
      const transition = await app.inject({
        method: 'PUT',
        url: `/jobs/${job.id}`,
        payload: { title: 'Wire install', priority: 'Normal', status },
      });
      expect(transition.statusCode).toBe(200);
    }

    const afterJob = await app.inject({ method: 'GET', url: `/products/${product.id}` });
    expect(
      z.object({ stock: z.object({ onHand: z.number() }) }).parse(afterJob.json()).stock.onHand,
    ).toBeLessThan(18);

    const supplier = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/suppliers',
          payload: { displayName: 'Wire Supplier' },
        })
      ).json(),
    );
    const poRes = await app.inject({
      method: 'POST',
      url: '/purchase-orders',
      payload: {
        supplierId: supplier.id,
        issueDate: '2026-07-10',
        currency: 'AUD',
        lineItems: [
          {
            description: 'Copper Wire',
            quantity: 5,
            unitPrice: 4,
            gstApplicable: true,
            productId: product.id,
          },
        ],
      },
    });
    const purchaseOrderId = idSchema.parse(poRes.json()).id;
    await app.inject({ method: 'POST', url: `/purchase-orders/${purchaseOrderId}/approve` });
    const receiptStatusRes = await app.inject({
      method: 'GET',
      url: `/purchase-orders/${purchaseOrderId}/receipt-status`,
    });
    expect(receiptStatusRes.statusCode).toBe(200);

    const stocktakeRes = await app.inject({
      method: 'POST',
      url: '/stocktakes',
      payload: { type: 'full' },
    });
    expect(stocktakeRes.statusCode).toBe(201);
    const stocktake = idSchema.parse(stocktakeRes.json());
    const listStocktakes = await app.inject({ method: 'GET', url: '/stocktakes' });
    expect(listStocktakes.statusCode).toBe(200);
    const getStocktake = await app.inject({ method: 'GET', url: `/stocktakes/${stocktake.id}` });
    expect(getStocktake.statusCode).toBe(200);

    const archiveRes = await app.inject({
      method: 'POST',
      url: `/products/${product.id}/archive`,
    });
    expect(archiveRes.statusCode).toBe(200);
    expect(z.object({ isActive: z.boolean() }).parse(archiveRes.json()).isActive).toBe(false);

    const missingLookup = await app.inject({
      method: 'GET',
      url: '/products/lookup?code=DOES-NOT-EXIST',
    });
    expect(missingLookup.statusCode).toBe(404);

    const duplicateSku = await app.inject({
      method: 'POST',
      url: '/products',
      payload: { sku: 'WIRE-10', name: 'Dup', trackStock: true },
    });
    expect(duplicateSku.statusCode).toBe(409);

    await app.close();
  });
});
