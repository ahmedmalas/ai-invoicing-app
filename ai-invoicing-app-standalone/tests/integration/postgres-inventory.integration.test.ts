import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { enterWorkspaceContext } from '../../src/auth/workspace-context.js';
import { resetPostgresTestDatabase } from '../helpers/postgres-reset.js';

const connectionString = process.env.TEST_DATABASE_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres('PostgreSQL inventory parity', () => {
  const reset = async (): Promise<void> => {
    await resetPostgresTestDatabase(connectionString!);
  };

  beforeEach(async () => {
    const { createPostgresDatabase } = await import('../../src/db/postgres-database.js');
    const bootstrap = await createPostgresDatabase(connectionString!, { maxConnections: 2 });
    await bootstrap.close();
    await reset();
  }, 30_000);

  afterEach(reset, 30_000);

  it('covers catalogue, receiving, deductions, stocktakes, alerts, reports, and isolation', async () => {
    const { createPostgresDatabase } = await import('../../src/db/postgres-database.js');
    const db = await createPostgresDatabase(connectionString!, { maxConnections: 3 });
    const ownerA = '20000000-0000-4000-8000-00000000000a';
    const ownerB = '20000000-0000-4000-8000-00000000000b';
    let schemaA: string | undefined;
    let schemaB: string | undefined;
    try {
      const workspaceA = await db.provisionWorkspaceOwner({
        authUserId: ownerA,
        displayName: 'Inventory Owner A',
        email: 'inv-owner-a@example.test',
        workspaceName: 'Inventory Workspace A',
      });
      schemaA = workspaceA.schemaName;
      enterWorkspaceContext({
        authUserId: ownerA,
        workspaceId: workspaceA.workspaceId,
        schemaName: workspaceA.schemaName,
      });

      const supplier = await db.createSupplier({
        displayName: 'PG Parts Co',
        email: 'pg-parts@example.com',
        contactPerson: 'Casey',
        paymentTerms: 'Net 14',
      });

      const product = await db.createProduct({
        sku: 'PG-FILT-100',
        barcode: '9400001000001',
        name: 'PG Cabin Filter',
        category: 'Filters',
        costPrice: 12,
        sellPrice: 30,
        minimumStockLevel: 5,
        reorderQuantity: 20,
        openingStock: 2,
        gstStatus: 'gst',
        trackStock: true,
        supplierId: supplier.id,
      });
      expect(product.stock?.onHand).toBe(2);

      const lookup = await db.lookupProductByCode('9400001000001');
      expect(lookup?.id).toBe(product.id);

      await db.adjustStock({
        productId: product.id,
        quantityDelta: 1,
        notes: 'Manual top-up',
        referenceType: 'manual',
        referenceId: '11111111-1111-4111-8111-111111111111',
      });
      expect((await db.getProductById(product.id))?.stock?.onHand).toBe(3);

      // Idempotent reference-based movement: same adjustment key returns existing ledger row.
      const firstIdempotent = await db.adjustStock({
        productId: product.id,
        quantityDelta: 2,
        notes: 'Idempotent adjust',
        referenceType: 'manual',
        referenceId: '22222222-2222-4222-8222-222222222222',
      });
      const secondIdempotent = await db.adjustStock({
        productId: product.id,
        quantityDelta: 2,
        notes: 'Idempotent adjust replay',
        referenceType: 'manual',
        referenceId: '22222222-2222-4222-8222-222222222222',
      });
      expect(secondIdempotent.id).toBe(firstIdempotent.id);
      expect((await db.getProductById(product.id))?.stock?.onHand).toBe(5);

      await db.transferStock({
        productId: product.id,
        quantity: 1,
        fromBucket: 'on_hand',
        toBucket: 'damaged',
        notes: 'Damaged unit',
      });
      const afterTransfer = await db.getProductById(product.id);
      expect(afterTransfer?.stock?.onHand).toBe(4);
      expect(afterTransfer?.stock?.damaged).toBe(1);

      const purchaseOrder = await db.createPurchaseOrderDraft({
        supplierId: supplier.id,
        issueDate: '2026-07-10',
        currency: 'AUD',
        lineItems: [
          {
            description: 'PG Cabin Filter',
            quantity: 10,
            unitPrice: 12,
            gstApplicable: true,
            productId: product.id,
          },
        ],
      });
      const po = await db.getPurchaseOrderById(purchaseOrder.id);
      expect(po?.lineItems[0]?.productId).toBe(product.id);
      const lineId = po!.lineItems[0]!.id!;

      await db.approvePurchaseOrder(purchaseOrder.id);
      const afterApprove = await db.getProductById(product.id);
      expect(afterApprove?.stock?.incoming).toBeGreaterThanOrEqual(10);

      const partial = await db.receivePurchaseOrder(purchaseOrder.id, {
        lineItems: [
          { purchaseOrderLineItemId: lineId, quantityReceived: 4, productId: product.id },
        ],
      });
      expect(partial.receiptStatus).toBe('partial');
      expect((await db.getProductById(product.id))?.stock?.onHand).toBe(8);

      const full = await db.receivePurchaseOrder(purchaseOrder.id, {
        lineItems: [
          { purchaseOrderLineItemId: lineId, quantityReceived: 6, productId: product.id },
        ],
      });
      expect(full.receiptStatus).toBe('received');
      expect(await db.getPurchaseOrderReceiptStatus(purchaseOrder.id)).toBe('received');
      expect((await db.getProductById(product.id))?.stock?.onHand).toBe(14);

      await expect(
        db.receivePurchaseOrder(purchaseOrder.id, {
          lineItems: [
            { purchaseOrderLineItemId: lineId, quantityReceived: 1, productId: product.id },
          ],
        }),
      ).rejects.toThrow('RECEIVE_EXCEEDS_OUTSTANDING');

      const customer = await db.createCustomer({ displayName: 'PG Inventory Customer' });
      const invoice = await db.createInvoiceDraft({
        customerId: customer.id,
        title: 'Filter replacement',
        issueDate: '2026-07-18',
        dueDate: '2026-08-01',
        lineItems: [
          {
            description: 'PG Cabin Filter',
            quantity: 3,
            unitPrice: 30,
            gstApplicable: true,
            productId: product.id,
          },
        ],
      });
      await db.finaliseInvoice(invoice.id);
      expect((await db.getProductById(product.id))?.stock?.onHand).toBe(11);

      const component = await db.createProduct({
        sku: 'PG-BOLT-1',
        name: 'PG Bolt',
        costPrice: 1,
        sellPrice: 2,
        openingStock: 50,
        trackStock: true,
      });
      const kit = await db.createProduct({
        sku: 'PG-KIT-1',
        name: 'PG Service Kit',
        isBundle: true,
        bundleKind: 'kit',
        trackStock: false,
        sellPrice: 40,
        bundleComponents: [{ componentProductId: component.id, quantity: 2 }],
      });
      const kitInvoice = await db.createInvoiceDraft({
        customerId: customer.id,
        title: 'Kit sale',
        issueDate: '2026-07-18',
        dueDate: '2026-08-01',
        lineItems: [
          {
            description: 'PG Service Kit',
            quantity: 1,
            unitPrice: 40,
            gstApplicable: true,
            productId: kit.id,
          },
        ],
      });
      await db.finaliseInvoice(kitInvoice.id);
      expect((await db.getProductById(component.id))?.stock?.onHand).toBe(48);

      const job = await db.createJob({
        title: 'PG Job materials',
        customerId: customer.id,
        status: 'Draft',
        priority: 'Normal',
      });
      await db.setJobMaterials(job.id, [
        { productId: product.id, quantity: 1, notes: 'Used on site' },
      ]);
      await db.updateJob(job.id, {
        title: job.title,
        status: 'Scheduled',
        priority: 'Normal',
      });
      await db.updateJob(job.id, {
        title: job.title,
        status: 'In Progress',
        priority: 'Normal',
      });
      await db.updateJob(job.id, {
        title: job.title,
        status: 'Completed',
        priority: 'Normal',
        completedDate: '2026-07-18',
      });
      expect((await db.getProductById(product.id))?.stock?.onHand).toBe(10);

      const stocktake = await db.createStocktake({
        type: 'partial',
        productIds: [product.id],
      });
      const expected = stocktake.lines?.[0]?.expectedQuantity ?? 0;
      await db.updateStocktakeCounts(stocktake.id, [
        { productId: product.id, countedQuantity: Math.max(0, expected - 1) },
      ]);
      await db.submitStocktake(stocktake.id);
      await db.approveStocktake(stocktake.id, 'pg-tester');
      expect((await db.getProductById(product.id))?.stock?.onHand).toBe(Math.max(0, expected - 1));

      const alerts = await db.refreshAllInventoryAlerts();
      expect(Array.isArray(alerts)).toBe(true);
      const reports = await db.getInventoryReports();
      expect(reports.stockValuation.some((row) => row.productId === product.id)).toBe(true);
      expect(reports.inventoryOnHand.length).toBeGreaterThan(0);
      expect(reports.reorderRecommendations.length).toBeGreaterThanOrEqual(0);

      const movements = await db.listStockMovements({ productId: product.id, limit: 50 });
      expect(movements.length).toBeGreaterThan(0);

      const workspaceB = await db.provisionWorkspaceOwner({
        authUserId: ownerB,
        displayName: 'Inventory Owner B',
        email: 'inv-owner-b@example.test',
        workspaceName: 'Inventory Workspace B',
      });
      schemaB = workspaceB.schemaName;
      enterWorkspaceContext({
        authUserId: ownerB,
        workspaceId: workspaceB.workspaceId,
        schemaName: workspaceB.schemaName,
      });
      expect(await db.listProducts({ limit: 50 })).toEqual([]);
      expect(await db.getProductById(product.id)).toBeNull();
    } finally {
      await db.close();
      const pool = new Pool({ connectionString, max: 1, allowExitOnIdle: true });
      try {
        if (schemaA) await pool.query(`DROP SCHEMA "${schemaA}" CASCADE`);
        if (schemaB) await pool.query(`DROP SCHEMA "${schemaB}" CASCADE`);
        await pool.query('DELETE FROM public.auth_workspaces WHERE display_name IN ($1, $2)', [
          'Inventory Workspace A',
          'Inventory Workspace B',
        ]);
      } finally {
        await pool.end();
      }
    }
  });
});
