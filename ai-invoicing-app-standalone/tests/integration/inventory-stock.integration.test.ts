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
    expect(lookupRes.json().id).toBe(product.id);

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
    const poGetRes = await app.inject({ method: 'GET', url: `/purchase-orders/${purchaseOrderId}` });
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
    expect(receivePartialRes.json().receiptStatus).toBe('partial');

    const afterPartial = await app.inject({ method: 'GET', url: `/products/${product.id}` });
    expect(afterPartial.json().stock.onHand).toBe(6);

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
    expect(receiveRestRes.json().receiptStatus).toBe('received');

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
    expect(afterSale.json().stock.onHand).toBe(9);

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
    expect(afterStocktake.json().stock.onHand).toBe(8);

    const alertsRes = await app.inject({ method: 'POST', url: '/inventory/alerts/refresh' });
    expect(alertsRes.statusCode).toBe(200);

    const reportsRes = await app.inject({ method: 'GET', url: '/inventory/reports' });
    expect(reportsRes.statusCode).toBe(200);
    expect(Array.isArray(reportsRes.json().stockValuation)).toBe(true);

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
    expect(componentAfter.json().stock.onHand).toBe(48);

    await app.close();
  });
});
