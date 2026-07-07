import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });

function createTempDbPath(prefix: string): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  return { dir, dbPath: join(dir, 'app.db') };
}

async function seedLinkedDraftBill(dbPath: string): Promise<{
  supplierId: string;
  purchaseOrderId: string;
  purchaseOrderLineItemId: string;
  billId: string;
}> {
  const app = await buildApp({ dbPath });

  const supplierRes = await app.inject({
    method: 'POST',
    url: '/suppliers',
    payload: { displayName: 'Readiness Supplier', email: 'readiness@example.com' },
  });
  const supplier = idSchema.parse(supplierRes.json());

  const poRes = await app.inject({
    method: 'POST',
    url: '/purchase-orders',
    payload: {
      supplierId: supplier.id,
      issueDate: '2026-09-01',
      expectedDeliveryDate: '2026-09-10',
      currency: 'AUD',
      lineItems: [{ description: 'Line A', quantity: 2, unitPrice: 50, gstApplicable: true }],
    },
  });
  const purchaseOrder = z.object({ id: z.string().uuid() }).parse(poRes.json());

  const poDetailsRes = await app.inject({
    method: 'GET',
    url: `/purchase-orders/${purchaseOrder.id}`,
  });
  const poDetails = z
    .object({
      lineItems: z.array(z.object({ id: z.string().uuid().optional() })),
    })
    .parse(poDetailsRes.json());
  const purchaseOrderLineItemId = poDetails.lineItems[0]?.id;
  if (!purchaseOrderLineItemId) {
    throw new Error('Expected seeded purchase order line item id');
  }

  await app.inject({
    method: 'POST',
    url: `/purchase-orders/${purchaseOrder.id}/approve`,
  });

  const linkedBillRes = await app.inject({
    method: 'POST',
    url: `/purchase-orders/${purchaseOrder.id}/create-supplier-bill`,
    payload: { lineItems: [{ purchaseOrderLineItemId, quantity: 1 }] },
  });
  const bill = z.object({ id: z.string().uuid() }).parse(linkedBillRes.json());

  await app.close();

  return {
    supplierId: supplier.id,
    purchaseOrderId: purchaseOrder.id,
    purchaseOrderLineItemId,
    billId: bill.id,
  };
}

describe('supplier bill finalisation readiness integration', () => {
  it('rejects finalisation when supplier no longer exists', async () => {
    const { dir, dbPath } = createTempDbPath('sb-finalise-supplier');
    const { billId } = await seedLinkedDraftBill(dbPath);
    const db = new Database(dbPath);
    db.exec('PRAGMA foreign_keys = OFF;');
    db.prepare('UPDATE supplier_bills SET supplier_id = ? WHERE id = ?').run(
      '550e8400-e29b-41d4-a716-446655440999',
      billId,
    );
    db.exec('PRAGMA foreign_keys = ON;');
    db.close();

    const app = await buildApp({ dbPath });
    const finaliseRes = await app.inject({ method: 'POST', url: `/supplier-bills/${billId}/finalise` });
    expect(finaliseRes.statusCode).toBe(404);
    expect(finaliseRes.json()).toMatchObject({ message: 'SUPPLIER_BILL_FINALISE_SUPPLIER_NOT_FOUND' });
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects finalisation for empty bill line items', async () => {
    const { dir, dbPath } = createTempDbPath('sb-finalise-empty');
    const { billId } = await seedLinkedDraftBill(dbPath);
    const db = new Database(dbPath);
    db.prepare('DELETE FROM supplier_bill_line_items WHERE supplier_bill_id = ?').run(billId);
    db.close();

    const app = await buildApp({ dbPath });
    const finaliseRes = await app.inject({ method: 'POST', url: `/supplier-bills/${billId}/finalise` });
    expect(finaliseRes.statusCode).toBe(409);
    expect(finaliseRes.json()).toMatchObject({ message: 'SUPPLIER_BILL_FINALISE_EMPTY_LINE_ITEMS' });
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects finalisation for totals mismatch', async () => {
    const { dir, dbPath } = createTempDbPath('sb-finalise-totals');
    const { billId } = await seedLinkedDraftBill(dbPath);
    const db = new Database(dbPath);
    db.prepare('UPDATE supplier_bills SET total = total + 1 WHERE id = ?').run(billId);
    db.close();

    const app = await buildApp({ dbPath });
    const finaliseRes = await app.inject({ method: 'POST', url: `/supplier-bills/${billId}/finalise` });
    expect(finaliseRes.statusCode).toBe(409);
    expect(finaliseRes.json()).toMatchObject({ message: 'SUPPLIER_BILL_FINALISE_TOTALS_MISMATCH' });
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects finalisation for supplier mismatch on linked purchase order', async () => {
    const { dir, dbPath } = createTempDbPath('sb-finalise-supplier-mismatch');
    const seed = await seedLinkedDraftBill(dbPath);
    const db = new Database(dbPath);
    const secondSupplierId = '550e8400-e29b-41d4-a716-446655440777';
    db.prepare(
      `INSERT INTO suppliers (id, display_name, email, phone, address, tax_id, notes, created_at, updated_at)
       VALUES (?, 'Other Supplier', NULL, NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run(secondSupplierId);
    db.prepare('UPDATE supplier_bills SET supplier_id = ? WHERE id = ?').run(secondSupplierId, seed.billId);
    db.close();

    const app = await buildApp({ dbPath });
    const supplierMismatchRes = await app.inject({ method: 'POST', url: `/supplier-bills/${seed.billId}/finalise` });
    expect(supplierMismatchRes.statusCode).toBe(409);
    expect(supplierMismatchRes.json()).toMatchObject({ message: 'SUPPLIER_BILL_FINALISE_SOURCE_PO_SUPPLIER_MISMATCH' });
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects finalisation for orphaned purchase order linkage', async () => {
    const { dir, dbPath } = createTempDbPath('sb-finalise-orphan-po');
    const seed = await seedLinkedDraftBill(dbPath);
    const db2 = new Database(dbPath);
    db2.exec('PRAGMA foreign_keys = OFF;');
    db2.prepare('UPDATE supplier_bills SET source_purchase_order_id = ? WHERE id = ?').run(
      '550e8400-e29b-41d4-a716-446655440666',
      seed.billId,
    );
    db2.exec('PRAGMA foreign_keys = ON;');
    db2.close();

    const app2 = await buildApp({ dbPath });
    const orphanedPoRes = await app2.inject({ method: 'POST', url: `/supplier-bills/${seed.billId}/finalise` });
    expect(orphanedPoRes.statusCode).toBe(404);
    expect(orphanedPoRes.json()).toMatchObject({ message: 'SUPPLIER_BILL_FINALISE_SOURCE_PO_NOT_FOUND' });
    await app2.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects finalisation for invalid PO line references and over-billing', async () => {
    const { dir, dbPath } = createTempDbPath('sb-finalise-lines');
    const seed = await seedLinkedDraftBill(dbPath);

    const db = new Database(dbPath);
    db.exec('PRAGMA foreign_keys = OFF;');
    db.prepare('UPDATE supplier_bill_line_items SET source_purchase_order_line_item_id = ? WHERE supplier_bill_id = ?').run(
      '550e8400-e29b-41d4-a716-446655440555',
      seed.billId,
    );
    db.exec('PRAGMA foreign_keys = ON;');
    db.close();

    const app = await buildApp({ dbPath });
    const invalidLineRes = await app.inject({ method: 'POST', url: `/supplier-bills/${seed.billId}/finalise` });
    expect(invalidLineRes.statusCode).toBe(409);
    expect(invalidLineRes.json()).toMatchObject({
      message: 'SUPPLIER_BILL_FINALISE_SOURCE_PO_LINE_REFERENCE_INVALID',
    });
    await app.close();

    const db2 = new Database(dbPath);
    db2
      .prepare(
        'UPDATE supplier_bill_line_items SET source_purchase_order_line_item_id = ?, quantity = ?, line_subtotal = ?, line_gst = ?, line_total = ? WHERE supplier_bill_id = ?',
      )
      .run(seed.purchaseOrderLineItemId, 3, 150, 15, 165, seed.billId);
    db2.prepare('UPDATE supplier_bills SET subtotal = ?, gst_total = ?, total = ? WHERE id = ?').run(150, 15, 165, seed.billId);
    db2.close();

    const app2 = await buildApp({ dbPath });
    const overBillingRes = await app2.inject({ method: 'POST', url: `/supplier-bills/${seed.billId}/finalise` });
    expect(overBillingRes.statusCode).toBe(409);
    expect(overBillingRes.json()).toMatchObject({
      message: 'SUPPLIER_BILL_FINALISE_SOURCE_PO_QUANTITY_EXCEEDS_REMAINING',
    });
    await app2.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
