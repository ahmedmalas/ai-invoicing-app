import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });
const errorSchema = z.object({
  status: z.number().int(),
  code: z.string().min(1),
  message: z.string().min(1),
});
const productStockSchema = z.object({
  id: z.string().uuid(),
  stock: z.object({
    onHand: z.number(),
    available: z.number(),
    incoming: z.number(),
    reserved: z.number(),
  }),
});

function createTempDbPath(prefix: string): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, dbPath: join(dir, 'app.db') };
}

function authHeaders(userId: string): Record<string, string> {
  return { 'x-actor-user-id': userId };
}

async function withFailpoint<T>(failpoint: string, work: () => Promise<T>): Promise<T> {
  const previous = process.env.AI_BUSINESS_OS_FAILPOINT;
  process.env.AI_BUSINESS_OS_FAILPOINT = failpoint;
  try {
    return await work();
  } finally {
    if (previous === undefined) delete process.env.AI_BUSINESS_OS_FAILPOINT;
    else process.env.AI_BUSINESS_OS_FAILPOINT = previous;
  }
}

describe('inventory production readiness', () => {
  it('keeps concurrent SKU activity, retries, and failpoint recovery consistent', async () => {
    const { dir, dbPath } = createTempDbPath('inventory-prod-ready-');
      const app = await buildApp({
        dbPath,
        authBypassForTesting: true,
        serveFrontend: true,
      });
      try {
        const supplier = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/suppliers',
            payload: { displayName: 'ProdReady Supplier', email: 'pr-supplier@example.test' },
          })
        ).json(),
      );
      const product = productStockSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/products',
            payload: {
              sku: 'PR-SKU-1',
              barcode: '9300003000003',
              name: 'ProdReady Widget',
              costPrice: 4,
              sellPrice: 10,
              openingStock: 100,
              trackStock: true,
              minimumStockLevel: 5,
              reorderQuantity: 20,
            },
          })
        ).json(),
      );
      expect(product.stock.onHand).toBe(100);

      // Concurrent unique adjustments against the same SKU.
      const adjustResults = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          app.inject({
            method: 'POST',
            url: '/inventory/adjust',
            payload: {
              productId: product.id,
              quantityDelta: -1,
              movementType: 'manual_adjustment',
              referenceType: 'manual',
              referenceId: randomUUID(),
            },
          }),
        ),
      );
      expect(adjustResults.every((result) => result.status === 'fulfilled')).toBe(true);
      for (const result of adjustResults) {
        if (result.status === 'fulfilled') expect(result.value.statusCode).toBe(201);
      }
      const afterAdjusts = productStockSchema.parse(
        (await app.inject({ method: 'GET', url: `/products/${product.id}` })).json(),
      );
      expect(afterAdjusts.stock.onHand).toBe(80);

      // Duplicate submission / retry with the same reference must not double-apply.
      const duplicateRef = randomUUID();
      const firstDup = await app.inject({
        method: 'POST',
        url: '/inventory/adjust',
        payload: {
          productId: product.id,
          quantityDelta: -2,
          referenceType: 'manual',
          referenceId: duplicateRef,
        },
      });
      const secondDup = await app.inject({
        method: 'POST',
        url: '/inventory/adjust',
        payload: {
          productId: product.id,
          quantityDelta: -2,
          referenceType: 'manual',
          referenceId: duplicateRef,
        },
      });
      expect(firstDup.statusCode).toBe(201);
      expect(secondDup.statusCode).toBe(201);
      expect(idSchema.parse(firstDup.json()).id).toBe(idSchema.parse(secondDup.json()).id);
      expect(
        productStockSchema.parse(
          (await app.inject({ method: 'GET', url: `/products/${product.id}` })).json(),
        ).stock.onHand,
      ).toBe(78);

        const poId = idSchema.parse(
          (
            await app.inject({
              method: 'POST',
              url: '/purchase-orders',
              payload: {
                supplierId: supplier.id,
                issueDate: '2026-07-10',
                currency: 'AUD',
                lineItems: [
                  {
                    description: 'ProdReady Widget',
                    quantity: 20,
                    unitPrice: 4,
                    gstApplicable: true,
                    productId: product.id,
                  },
                ],
              },
            })
          ).json(),
        ).id;
        const poDetails = z
          .object({
            id: z.string().uuid(),
            lineItems: z.array(z.object({ id: z.string().uuid(), quantity: z.number() })),
          })
          .parse((await app.inject({ method: 'GET', url: `/purchase-orders/${poId}` })).json());
        await app.inject({ method: 'POST', url: `/purchase-orders/${poId}/approve` });
        const lineId = poDetails.lineItems[0]!.id;

      // Concurrent over-receive attempts: total received must not exceed ordered qty.
      const receiveAttempts = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          app.inject({
            method: 'POST',
              url: `/purchase-orders/${poId}/receive`,
            payload: {
              lineItems: [
                {
                  purchaseOrderLineItemId: lineId,
                  quantityReceived: 5,
                  productId: product.id,
                },
              ],
            },
          }),
        ),
      );
      const receiveStatuses = receiveAttempts
        .filter((result) => result.status === 'fulfilled')
        .map((result) => (result.status === 'fulfilled' ? result.value.statusCode : 0));
      const successReceives = receiveStatuses.filter((code) => code === 201).length;
      const rejectedReceives = receiveStatuses.filter((code) => code >= 400).length;
      expect(successReceives).toBe(4);
      expect(rejectedReceives).toBe(4);
      expect(
        await app.inject({ method: 'GET', url: `/purchase-orders/${poId}/receipt-status` }),
      ).toMatchObject({ statusCode: 200 });
      expect(
        z.object({ receiptStatus: z.string() }).parse(
          (
            await app.inject({
              method: 'GET',
              url: `/purchase-orders/${poId}/receipt-status`,
            })
          ).json(),
        ).receiptStatus,
      ).toBe('received');
      expect(
        productStockSchema.parse(
          (await app.inject({ method: 'GET', url: `/products/${product.id}` })).json(),
        ).stock.onHand,
      ).toBe(98);

      // Failpoint recovery: interrupted adjust must roll back balance and movement.
      const beforeFail = productStockSchema.parse(
        (await app.inject({ method: 'GET', url: `/products/${product.id}` })).json(),
      );
      const movementsBefore = z
        .object({ movements: z.array(z.object({ id: z.string().uuid() })) })
        .parse(
          (
            await app.inject({
              method: 'GET',
              url: `/inventory/movements?productId=${product.id}&limit=500`,
            })
          ).json(),
        ).movements.length;
      const failedAdjust = await withFailpoint('inventory_post_movement_after_balance', () =>
        app.inject({
          method: 'POST',
          url: '/inventory/adjust',
          payload: {
            productId: product.id,
            quantityDelta: -3,
            referenceType: 'manual',
            referenceId: randomUUID(),
          },
        }),
      );
      expect(failedAdjust.statusCode).toBeGreaterThanOrEqual(500);
      const afterFail = productStockSchema.parse(
        (await app.inject({ method: 'GET', url: `/products/${product.id}` })).json(),
      );
      expect(afterFail.stock).toEqual(beforeFail.stock);
      const movementsAfterFail = z
        .object({ movements: z.array(z.object({ id: z.string().uuid() })) })
        .parse(
          (
            await app.inject({
              method: 'GET',
              url: `/inventory/movements?productId=${product.id}&limit=500`,
            })
          ).json(),
        ).movements.length;
      expect(movementsAfterFail).toBe(movementsBefore);

        const recovered = await app.inject({
          method: 'POST',
          url: '/inventory/adjust',
          payload: {
            productId: product.id,
            quantityDelta: -3,
            referenceType: 'manual',
            referenceId: randomUUID(),
          },
        });
        expect(recovered.statusCode).toBe(201);
        expect(
          productStockSchema.parse(
            (await app.inject({ method: 'GET', url: `/products/${product.id}` })).json(),
          ).stock.onHand,
        ).toBe(95);

        // Failpoint during goods receipt must leave outstanding qty and balances unchanged.
        const recoverySupplier = idSchema.parse(
          (
            await app.inject({
              method: 'POST',
              url: '/suppliers',
              payload: { displayName: 'Recovery Supplier' },
            })
          ).json(),
        );
        const recoveryPoId = idSchema.parse(
          (
            await app.inject({
              method: 'POST',
              url: '/purchase-orders',
              payload: {
                supplierId: recoverySupplier.id,
                issueDate: '2026-07-11',
                currency: 'AUD',
                lineItems: [
                  {
                    description: 'Recovery line',
                    quantity: 8,
                    unitPrice: 4,
                    gstApplicable: true,
                    productId: product.id,
                  },
                ],
              },
            })
          ).json(),
        ).id;
        const recoveryPo = z
          .object({
            lineItems: z.array(z.object({ id: z.string().uuid() })),
          })
          .parse(
            (await app.inject({ method: 'GET', url: `/purchase-orders/${recoveryPoId}` })).json(),
          );
        await app.inject({ method: 'POST', url: `/purchase-orders/${recoveryPoId}/approve` });
        const beforeReceiveFail = productStockSchema.parse(
          (await app.inject({ method: 'GET', url: `/products/${product.id}` })).json(),
        );
        const failedReceive = await withFailpoint('inventory_receive_after_line_update', () =>
          app.inject({
            method: 'POST',
            url: `/purchase-orders/${recoveryPoId}/receive`,
            payload: {
              lineItems: [
                {
                  purchaseOrderLineItemId: recoveryPo.lineItems[0]!.id,
                  quantityReceived: 3,
                  productId: product.id,
                },
              ],
            },
          }),
        );
        expect(failedReceive.statusCode).toBeGreaterThanOrEqual(500);
        expect(
          productStockSchema.parse(
            (await app.inject({ method: 'GET', url: `/products/${product.id}` })).json(),
          ).stock,
        ).toEqual(beforeReceiveFail.stock);
        expect(
          z
            .object({ receiptStatus: z.string() })
            .parse(
              (
                await app.inject({
                  method: 'GET',
                  url: `/purchase-orders/${recoveryPoId}/receipt-status`,
                })
              ).json(),
            ).receiptStatus,
        ).toBe('ordered');
        const recoveredReceive = await app.inject({
          method: 'POST',
          url: `/purchase-orders/${recoveryPoId}/receive`,
          payload: {
            lineItems: [
              {
                purchaseOrderLineItemId: recoveryPo.lineItems[0]!.id,
                quantityReceived: 3,
                productId: product.id,
              },
            ],
          },
        });
        expect(recoveredReceive.statusCode).toBe(201);

      // Bundle/component consumption under invoice finalise.
      const component = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/products',
            payload: {
              sku: 'PR-COMP',
              name: 'Component',
              openingStock: 40,
              trackStock: true,
            },
          })
        ).json(),
      );
      const kit = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/products',
            payload: {
              sku: 'PR-KIT',
              name: 'Kit',
              isBundle: true,
              bundleKind: 'kit',
              trackStock: false,
              sellPrice: 25,
              bundleComponents: [{ componentProductId: component.id, quantity: 2 }],
            },
          })
        ).json(),
      );
      const customer = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/customers',
            payload: { displayName: 'ProdReady Customer' },
          })
        ).json(),
      );
      const invoice = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/invoices',
            payload: {
              customerId: customer.id,
              title: 'Kit sale',
              issueDate: '2026-07-18',
              dueDate: '2026-08-01',
              lineItems: [
                {
                  description: 'Kit',
                  quantity: 3,
                  unitPrice: 25,
                  gstApplicable: true,
                  productId: kit.id,
                },
              ],
            },
          })
        ).json(),
      );
      expect(
        (await app.inject({ method: 'POST', url: `/invoices/${invoice.id}/finalise` })).statusCode,
      ).toBe(200);
      expect(
        productStockSchema.parse(
          (await app.inject({ method: 'GET', url: `/products/${component.id}` })).json(),
        ).stock.onHand,
      ).toBe(34);

      // Stocktake against contended SKU.
      const stocktake = z
        .object({
          id: z.string().uuid(),
          lines: z.array(z.object({ productId: z.string().uuid() })),
        })
        .parse(
          (
            await app.inject({
              method: 'POST',
              url: '/stocktakes',
              payload: { type: 'partial', productIds: [product.id] },
            })
          ).json(),
        );
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/stocktakes/${stocktake.id}/counts`,
            payload: { lines: [{ productId: product.id, countedQuantity: 90 }] },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ method: 'POST', url: `/stocktakes/${stocktake.id}/submit` }))
          .statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/stocktakes/${stocktake.id}/approve`,
            payload: { approvedBy: 'prod-ready' },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        productStockSchema.parse(
          (await app.inject({ method: 'GET', url: `/products/${product.id}` })).json(),
        ).stock.onHand,
      ).toBe(90);

      // Barcode lookup + reports + alerts stay available under load.
      expect(
        (await app.inject({ method: 'GET', url: '/products/lookup?code=9300003000003' }))
          .statusCode,
      ).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/inventory/reports' })).statusCode).toBe(200);
      expect(
        (await app.inject({ method: 'POST', url: '/inventory/alerts/refresh' })).statusCode,
      ).toBe(200);

      // Frontend shell routes for inventory workspaces are public HTML entrypoints.
      for (const path of [
        '/workspace/inventory',
        '/workspace/stocktakes',
        '/workspace/purchase-orders',
        '/workspace/suppliers',
      ]) {
        const shell = await app.inject({ method: 'GET', url: path });
        expect(shell.statusCode).toBe(200);
          expect(String(shell.body).toLowerCase()).toContain('<!doctype html>');
      }
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('enforces authn/authz on inventory endpoints and blocks read-only writes', async () => {
    const { dir, dbPath } = createTempDbPath('inventory-security-');
    const bootstrap = await buildApp({ dbPath, authBypassForTesting: true });
    let adminUserId = '';
    let readOnlyUserId = '';
    let productId = '';
    try {
      const adminRole = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/roles',
            payload: {
              name: 'Inventory Admin',
              canBeAssigned: true,
              canManageAssignments: true,
            },
          })
        ).json(),
      );
      const readOnlyRole = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/roles',
            payload: {
              name: 'Inventory ReadOnly',
              canBeAssigned: false,
              canManageAssignments: false,
            },
          })
        ).json(),
      );
      adminUserId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/users',
            payload: {
              displayName: 'Inventory Admin User',
              email: 'inv-admin@example.test',
              roleIds: [adminRole.id],
            },
          })
        ).json(),
      ).id;
      readOnlyUserId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/users',
            payload: {
              displayName: 'Inventory ReadOnly User',
              email: 'inv-read@example.test',
              roleIds: [readOnlyRole.id],
            },
          })
        ).json(),
      ).id;
      productId = idSchema.parse(
        (
          await bootstrap.inject({
            method: 'POST',
            url: '/products',
            payload: {
              sku: 'SEC-1',
              name: 'Secure Part',
              openingStock: 10,
              trackStock: true,
            },
          })
        ).json(),
      ).id;
    } finally {
      await bootstrap.close();
    }

    const app = await buildApp({ dbPath, authBypassForTesting: false });
    try {
      const unauthenticated = await app.inject({ method: 'GET', url: '/products' });
      expect(unauthenticated.statusCode).toBe(401);
      expect(errorSchema.parse(unauthenticated.json()).code).toBe('AUTH_UNAUTHENTICATED');

      const readOk = await app.inject({
        method: 'GET',
        url: '/products',
        headers: authHeaders(readOnlyUserId),
      });
      expect(readOk.statusCode).toBe(200);

      const writeDenied = await app.inject({
        method: 'POST',
        url: '/inventory/adjust',
        headers: authHeaders(readOnlyUserId),
        payload: {
          productId,
          quantityDelta: -1,
          referenceType: 'manual',
          referenceId: randomUUID(),
        },
      });
      expect(writeDenied.statusCode).toBe(403);
      expect(errorSchema.parse(writeDenied.json()).code).toBe('AUTH_FORBIDDEN');

      const writeAllowed = await app.inject({
        method: 'POST',
        url: '/inventory/adjust',
        headers: authHeaders(adminUserId),
        payload: {
          productId,
          quantityDelta: -1,
          referenceType: 'manual',
          referenceId: randomUUID(),
        },
      });
      expect(writeAllowed.statusCode).toBe(201);

      // Parameterized query path: malicious code must not inject or leak.
      const injection = await app.inject({
        method: 'GET',
        url: "/products/lookup?code=9300003000003'%20OR%201=1%20--",
        headers: authHeaders(adminUserId),
      });
      expect([404, 400]).toContain(injection.statusCode);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
