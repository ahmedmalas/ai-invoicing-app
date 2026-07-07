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

async function seedFinalisedLinkedSupplierBill(dbPath: string): Promise<{
  supplierId: string;
  purchaseOrderId: string;
  billId: string;
}> {
  const app = await buildApp({ dbPath });

  const supplierRes = await app.inject({
    method: 'POST',
    url: '/suppliers',
    payload: { displayName: 'Supplier Payment Readiness', email: 'sp-readiness@example.com' },
  });
  const supplier = idSchema.parse(supplierRes.json());

  const poRes = await app.inject({
    method: 'POST',
    url: '/purchase-orders',
    payload: {
      supplierId: supplier.id,
      issueDate: '2026-09-01',
      expectedDeliveryDate: '2026-09-12',
      currency: 'AUD',
      lineItems: [{ description: 'Line A', quantity: 1, unitPrice: 100, gstApplicable: true }],
    },
  });
  const purchaseOrder = idSchema.parse(poRes.json());

  await app.inject({ method: 'POST', url: `/purchase-orders/${purchaseOrder.id}/approve` });
  const linkedDraftBillRes = await app.inject({
    method: 'POST',
    url: `/purchase-orders/${purchaseOrder.id}/create-supplier-bill`,
  });
  const linkedDraftBill = idSchema.parse(linkedDraftBillRes.json());
  await app.inject({
    method: 'POST',
    url: `/supplier-bills/${linkedDraftBill.id}/finalise`,
  });

  await app.close();
  return {
    supplierId: supplier.id,
    purchaseOrderId: purchaseOrder.id,
    billId: linkedDraftBill.id,
  };
}

describe('supplier payment readiness integration', () => {
  it('rejects allocation when linked supplier bill source PO is orphaned and emits no payment record', async () => {
    const { dir, dbPath } = createTempDbPath('sp-readiness-po');
    const seeded = await seedFinalisedLinkedSupplierBill(dbPath);
    const db = new Database(dbPath);
    db.exec('PRAGMA foreign_keys = OFF;');
    db.prepare('UPDATE supplier_bills SET source_purchase_order_id = ? WHERE id = ?').run(
      '550e8400-e29b-41d4-a716-446655440222',
      seeded.billId,
    );
    db.exec('PRAGMA foreign_keys = ON;');
    db.close();

    const app = await buildApp({ dbPath });
    const failedAllocationRes = await app.inject({
      method: 'POST',
      url: '/supplier-payments',
      payload: {
        supplierId: seeded.supplierId,
        paymentDate: '2026-09-05',
        paymentMethod: 'Bank Transfer',
        reference: 'SPAY-INVALID-PO',
        amount: 50,
        allocations: [{ supplierBillId: seeded.billId, amount: 50 }],
      },
    });
    expect(failedAllocationRes.statusCode).toBe(404);
    expect(failedAllocationRes.json()).toMatchObject({
      message: 'SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_NOT_FOUND',
    });

    const paymentsAfterFailureRes = await app.inject({
      method: 'GET',
      url: `/supplier-payments?supplierId=${seeded.supplierId}`,
    });
    const paymentsAfterFailure = z.object({ payments: z.array(z.object({ id: z.string().uuid() })) }).parse(
      paymentsAfterFailureRes.json(),
    );
    expect(paymentsAfterFailure.payments).toHaveLength(0);
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects allocation when linked supplier bill source line reference is invalid', async () => {
    const { dir, dbPath } = createTempDbPath('sp-readiness-line');
    const seeded = await seedFinalisedLinkedSupplierBill(dbPath);
    const appForSecondPo = await buildApp({ dbPath });
    const secondPoRes = await appForSecondPo.inject({
      method: 'POST',
      url: '/purchase-orders',
      payload: {
        supplierId: seeded.supplierId,
        issueDate: '2026-09-02',
        expectedDeliveryDate: '2026-09-13',
        currency: 'AUD',
        lineItems: [{ description: 'Different line', quantity: 1, unitPrice: 20, gstApplicable: true }],
      },
    });
    const secondPo = idSchema.parse(secondPoRes.json());
    await appForSecondPo.close();

    const db = new Database(dbPath);
    db.exec('PRAGMA foreign_keys = OFF;');
    db.prepare('UPDATE supplier_bills SET source_purchase_order_id = ? WHERE id = ?').run(secondPo.id, seeded.billId);
    db.exec('PRAGMA foreign_keys = ON;');
    db.close();

    const app = await buildApp({ dbPath });
    const failedAllocationRes = await app.inject({
      method: 'POST',
      url: '/supplier-payments',
      payload: {
        supplierId: seeded.supplierId,
        paymentDate: '2026-09-05',
        paymentMethod: 'Bank Transfer',
        reference: 'SPAY-INVALID-LINE',
        amount: 50,
        allocations: [{ supplierBillId: seeded.billId, amount: 50 }],
      },
    });
    expect(failedAllocationRes.statusCode).toBe(409);
    expect(failedAllocationRes.json()).toMatchObject({
      message: 'SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_LINE_REFERENCE_INVALID',
    });
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
