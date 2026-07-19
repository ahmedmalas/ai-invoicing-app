import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const idSchema = z.object({ id: z.string().uuid() });
const errorSchema = z.object({
  status: z.number().int(),
  code: z.string().min(1),
  message: z.string().min(1),
});

function createTempDbPath(prefix: string): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, dbPath: join(dir, 'app.db') };
}

function authHeaders(userId: string): Record<string, string> {
  return { 'x-actor-user-id': userId };
}

describe('delete customer and invoice guardrails', () => {
  it('deletes orphan customers and draft invoices, blocks protected deletes, and enforces write permissions', async () => {
    const { dir, dbPath } = createTempDbPath('ai-business-os-delete-ci-');
    const bootstrapApp = await buildApp({ dbPath, authBypassForTesting: true });

    let writerUserId = '';
    let readOnlyUserId = '';
    let orphanCustomerId = '';
    let linkedCustomerId = '';
    let draftInvoiceId = '';
    let finalisedInvoiceId = '';
    let productId = '';
    let openingStock = 0;

    try {
      const writerRole = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/roles',
            payload: { name: 'Delete Writer', canBeAssigned: true, canManageAssignments: false },
          })
        ).json(),
      );
      const readOnlyRole = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/roles',
            payload: { name: 'Delete Reader', canBeAssigned: false, canManageAssignments: false },
          })
        ).json(),
      );

      writerUserId = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/users',
            payload: {
              displayName: 'Delete Writer User',
              email: 'delete-writer@example.test',
              roleIds: [writerRole.id],
            },
          })
        ).json(),
      ).id;
      readOnlyUserId = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/users',
            payload: {
              displayName: 'Delete Reader User',
              email: 'delete-reader@example.test',
              roleIds: [readOnlyRole.id],
            },
          })
        ).json(),
      ).id;

      orphanCustomerId = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/customers',
            payload: { displayName: 'Orphan Customer', email: 'orphan@example.test' },
          })
        ).json(),
      ).id;

      linkedCustomerId = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/customers',
            payload: { displayName: 'Linked Customer', email: 'linked@example.test' },
          })
        ).json(),
      ).id;

      const product = z
        .object({
          id: z.string().uuid(),
          stock: z.object({ onHand: z.number() }),
        })
        .parse(
          (
            await bootstrapApp.inject({
              method: 'POST',
              url: '/products',
              payload: {
                sku: 'DEL-STOCK-1',
                name: 'Delete Stock Part',
                costPrice: 5,
                sellPrice: 12,
                minimumStockLevel: 1,
                reorderQuantity: 5,
                openingStock: 8,
                gstStatus: 'gst',
                trackStock: true,
              },
            })
          ).json(),
        );
      productId = product.id;
      openingStock = product.stock.onHand;

      draftInvoiceId = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/invoices',
            payload: {
              customerId: linkedCustomerId,
              title: 'Draft for delete',
              issueDate: '2026-07-10',
              dueDate: '2026-07-24',
              lineItems: [
                {
                  description: 'Delete Stock Part',
                  quantity: 2,
                  unitPrice: 12,
                  gstApplicable: true,
                  productId,
                },
              ],
            },
          })
        ).json(),
      ).id;

      finalisedInvoiceId = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/invoices',
            payload: {
              customerId: linkedCustomerId,
              title: 'Final invoice keep',
              issueDate: '2026-07-11',
              dueDate: '2026-07-25',
              lineItems: [
                { description: 'Service', quantity: 1, unitPrice: 220, gstApplicable: true },
              ],
            },
          })
        ).json(),
      ).id;
      expect(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: `/invoices/${finalisedInvoiceId}/finalise`,
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await bootstrapApp.close();
    }

    const app = await buildApp({ dbPath, authBypassForTesting: false });
    const sql = new Database(dbPath);

    try {
      const forbiddenCustomerDelete = await app.inject({
        method: 'DELETE',
        url: `/customers/${orphanCustomerId}`,
        headers: authHeaders(readOnlyUserId),
      });
      expect(forbiddenCustomerDelete.statusCode).toBe(403);
      expect(errorSchema.parse(forbiddenCustomerDelete.json()).code).toBe('AUTH_FORBIDDEN');

      const forbiddenInvoiceDelete = await app.inject({
        method: 'DELETE',
        url: `/invoices/${draftInvoiceId}`,
        headers: authHeaders(readOnlyUserId),
      });
      expect(forbiddenInvoiceDelete.statusCode).toBe(403);
      expect(errorSchema.parse(forbiddenInvoiceDelete.json()).code).toBe('AUTH_FORBIDDEN');

      const blockedCustomerDelete = await app.inject({
        method: 'DELETE',
        url: `/customers/${linkedCustomerId}`,
        headers: authHeaders(writerUserId),
      });
      expect(blockedCustomerDelete.statusCode).toBe(409);
      expect(errorSchema.parse(blockedCustomerDelete.json()).code).toBe('CUSTOMER_HAS_INVOICES');
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/customers/${linkedCustomerId}`,
            headers: authHeaders(writerUserId),
          })
        ).statusCode,
      ).toBe(200);

      const blockedFinalInvoiceDelete = await app.inject({
        method: 'DELETE',
        url: `/invoices/${finalisedInvoiceId}`,
        headers: authHeaders(writerUserId),
      });
      expect(blockedFinalInvoiceDelete.statusCode).toBe(409);
      expect(errorSchema.parse(blockedFinalInvoiceDelete.json()).code).toBe(
        'ONLY_DRAFT_INVOICES_CAN_BE_DELETED',
      );
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/invoices/${finalisedInvoiceId}`,
            headers: authHeaders(writerUserId),
          })
        ).statusCode,
      ).toBe(200);

      const paymentCountBefore = (
        sql.prepare('SELECT count(*) AS count FROM customer_payments').get() as { count: number }
      ).count;
      const stockBefore = (
        sql
          .prepare('SELECT on_hand AS qty FROM inventory_balances WHERE product_id = ?')
          .get(productId) as { qty: number }
      ).qty;
      expect(stockBefore).toBe(openingStock);

      const timelineBefore = (
        sql.prepare('SELECT count(*) AS count FROM timeline_events').get() as { count: number }
      ).count;

      const deletedDraft = await app.inject({
        method: 'DELETE',
        url: `/invoices/${draftInvoiceId}`,
        headers: authHeaders(writerUserId),
      });
      expect(deletedDraft.statusCode).toBe(204);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/invoices/${draftInvoiceId}`,
            headers: authHeaders(writerUserId),
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          sql
            .prepare('SELECT count(*) AS count FROM invoice_line_items WHERE invoice_id = ?')
            .get(draftInvoiceId) as { count: number }
        ).count,
      ).toBe(0);

      const stockAfterDraftDelete = (
        sql
          .prepare('SELECT on_hand AS qty FROM inventory_balances WHERE product_id = ?')
          .get(productId) as { qty: number }
      ).qty;
      expect(stockAfterDraftDelete).toBe(openingStock);
      expect(
        (sql.prepare('SELECT count(*) AS count FROM customer_payments').get() as { count: number })
          .count,
      ).toBe(paymentCountBefore);

      const draftDeleteEvents = sql
        .prepare(
          `SELECT event_key AS eventKey FROM timeline_events
           WHERE entity_id = ? AND event_key = 'invoice.draft_deleted'`,
        )
        .all(draftInvoiceId) as Array<{ eventKey: string }>;
      expect(draftDeleteEvents).toHaveLength(1);

      const deletedCustomer = await app.inject({
        method: 'DELETE',
        url: `/customers/${orphanCustomerId}`,
        headers: authHeaders(writerUserId),
      });
      expect(deletedCustomer.statusCode).toBe(204);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/customers/${orphanCustomerId}`,
            headers: authHeaders(writerUserId),
          })
        ).statusCode,
      ).toBe(404);

      const customerDeleteEvents = sql
        .prepare(
          `SELECT event_key AS eventKey FROM timeline_events
           WHERE entity_id = ? AND event_key = 'customer.deleted'`,
        )
        .all(orphanCustomerId) as Array<{ eventKey: string }>;
      expect(customerDeleteEvents).toHaveLength(1);

      const timelineAfter = (
        sql.prepare('SELECT count(*) AS count FROM timeline_events').get() as { count: number }
      ).count;
      expect(timelineAfter).toBe(timelineBefore + 2);

      const quoteCustomer = idSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/customers',
            headers: authHeaders(writerUserId),
            payload: { displayName: 'Quote Linked Customer' },
          })
        ).json(),
      );
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/quotes',
            headers: authHeaders(writerUserId),
            payload: {
              customerId: quoteCustomer.id,
              title: 'Quote block delete',
              issueDate: '2026-07-12',
              expiryDate: '2026-07-26',
              lineItems: [
                { description: 'Quote line', quantity: 1, unitPrice: 50, gstApplicable: true },
              ],
            },
          })
        ).statusCode,
      ).toBe(201);
      const blockedByQuote = await app.inject({
        method: 'DELETE',
        url: `/customers/${quoteCustomer.id}`,
        headers: authHeaders(writerUserId),
      });
      expect(blockedByQuote.statusCode).toBe(409);
      expect(errorSchema.parse(blockedByQuote.json()).code).toBe('CUSTOMER_HAS_QUOTES');
    } finally {
      sql.close();
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
