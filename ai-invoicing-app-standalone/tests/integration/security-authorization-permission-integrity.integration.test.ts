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
const backupSchema = z.object({
  snapshot: z.object({
    entities: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  }),
});

function createTempDbPath(prefix: string): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, dbPath: join(dir, 'app.db') };
}

function authHeaders(userId: string): Record<string, string> {
  return { 'x-actor-user-id': userId };
}

describe('slice 39 security, authorization, and permission integrity', () => {
  it('enforces deterministic authn/authz controls across read/write paths', async () => {
    const { dir, dbPath } = createTempDbPath('ai-business-os-slice39-');

    const bootstrapApp = await buildApp({ dbPath, authBypassForTesting: true });

    let adminUserId = '';
    let readOnlyUserId = '';
    let roleForDeleteId = '';
    let invoiceId = '';
    try {
      const adminRole = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/roles',
            payload: { name: 'Slice39 Admin', canBeAssigned: true, canManageAssignments: true },
          })
        ).json(),
      );
      const readOnlyRole = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/roles',
            payload: { name: 'Slice39 ReadOnly', canBeAssigned: false, canManageAssignments: false },
          })
        ).json(),
      );
      roleForDeleteId = readOnlyRole.id;

      adminUserId = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/users',
            payload: {
              displayName: 'Slice39 Admin User',
              email: 'slice39-admin@example.test',
              roleIds: [adminRole.id],
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
              displayName: 'Slice39 ReadOnly User',
              email: 'slice39-read@example.test',
              roleIds: [readOnlyRole.id],
            },
          })
        ).json(),
      ).id;

      const customer = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/customers',
            payload: { displayName: 'Slice39 Customer' },
          })
        ).json(),
      );
      invoiceId = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/invoices',
            payload: {
              customerId: customer.id,
              title: 'Slice39 Invoice',
              issueDate: '2026-07-09',
              dueDate: '2026-07-20',
              lineItems: [{ description: 'Line', quantity: 1, unitPrice: 100, gstApplicable: true }],
            },
          })
        ).json(),
      ).id;
    } finally {
      await bootstrapApp.close();
    }

    const app = await buildApp({ dbPath, authBypassForTesting: false });
    try {
      const unauthRead = await app.inject({ method: 'GET', url: '/search?q=slice39&limit=10&offset=0' });
      expect(unauthRead.statusCode).toBe(401);
      expect(errorSchema.parse(unauthRead.json()).code).toBe('AUTH_UNAUTHENTICATED');

      const unauthReport = await app.inject({
        method: 'GET',
        url: '/reports/read-model?from=2026-07-01&to=2026-07-31&limit=10&offset=0',
      });
      expect(unauthReport.statusCode).toBe(401);
      expect(errorSchema.parse(unauthReport.json()).code).toBe('AUTH_UNAUTHENTICATED');

      const unauthorizedAdminRead = await app.inject({
        method: 'GET',
        url: '/platform/backup',
        headers: authHeaders(readOnlyUserId),
      });
      expect(unauthorizedAdminRead.statusCode).toBe(403);
      expect(errorSchema.parse(unauthorizedAdminRead.json()).code).toBe('AUTH_FORBIDDEN');

      const unauthorizedWrite = await app.inject({
        method: 'POST',
        url: '/customers',
        headers: authHeaders(readOnlyUserId),
        payload: { displayName: 'Denied Customer' },
      });
      expect(unauthorizedWrite.statusCode).toBe(403);
      expect(errorSchema.parse(unauthorizedWrite.json()).code).toBe('AUTH_FORBIDDEN');

      const unauthorizedEscalation = await app.inject({
        method: 'POST',
        url: '/roles',
        headers: authHeaders(readOnlyUserId),
        payload: { name: 'Escalation Attempt', canBeAssigned: true, canManageAssignments: true },
      });
      expect(unauthorizedEscalation.statusCode).toBe(403);
      expect(errorSchema.parse(unauthorizedEscalation.json()).code).toBe('AUTH_FORBIDDEN');

      const unauthorizedRoleDelete = await app.inject({
        method: 'DELETE',
        url: `/roles/${roleForDeleteId}`,
        headers: authHeaders(readOnlyUserId),
      });
      expect(unauthorizedRoleDelete.statusCode).toBe(403);
      expect(errorSchema.parse(unauthorizedRoleDelete.json()).code).toBe('AUTH_FORBIDDEN');

      const unauthorizedInvoiceMutation = await app.inject({
        method: 'PUT',
        url: `/invoices/${invoiceId}`,
        headers: authHeaders(readOnlyUserId),
        payload: {
          title: 'Denied Edit',
          issueDate: '2026-07-09',
          dueDate: '2026-07-20',
          paymentState: 'Draft',
          lineItems: [{ description: 'Line', quantity: 1, unitPrice: 100, gstApplicable: true }],
        },
      });
      expect(unauthorizedInvoiceMutation.statusCode).toBe(403);
      expect(errorSchema.parse(unauthorizedInvoiceMutation.json()).code).toBe('AUTH_FORBIDDEN');

      const timelineBefore = backupSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/platform/backup',
            headers: authHeaders(adminUserId),
          })
        ).json(),
      ).snapshot.entities.timeline_events;

      await app.inject({
        method: 'POST',
        url: '/customers',
        headers: authHeaders(readOnlyUserId),
        payload: { displayName: 'Denied Customer 2' },
      });
      await app.inject({
        method: 'PUT',
        url: `/invoices/${invoiceId}`,
        headers: authHeaders(readOnlyUserId),
        payload: {
          title: 'Denied Edit 2',
          issueDate: '2026-07-09',
          dueDate: '2026-07-20',
          paymentState: 'Draft',
          lineItems: [{ description: 'Line', quantity: 1, unitPrice: 100, gstApplicable: true }],
        },
      });

      const timelineAfter = backupSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/platform/backup',
            headers: authHeaders(adminUserId),
          })
        ).json(),
      ).snapshot.entities.timeline_events;
      expect(timelineAfter).toHaveLength(timelineBefore?.length ?? 0);

      const protectedSearchByAuth = await app.inject({
        method: 'GET',
        url: '/search?q=slice39&limit=10&offset=0',
        headers: authHeaders(readOnlyUserId),
      });
      expect(protectedSearchByAuth.statusCode).toBe(200);
      const protectedReportByAuth = await app.inject({
        method: 'GET',
        url: '/reports/read-model?from=2026-07-01&to=2026-07-31&limit=10&offset=0',
        headers: authHeaders(readOnlyUserId),
      });
      expect(protectedReportByAuth.statusCode).toBe(200);

      const concurrentUnauthorized = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/customers',
          headers: authHeaders(readOnlyUserId),
          payload: { displayName: 'Denied Concurrent 1' },
        }),
        app.inject({
          method: 'POST',
          url: '/customers',
          headers: authHeaders(readOnlyUserId),
          payload: { displayName: 'Denied Concurrent 2' },
        }),
      ]);
      for (const response of concurrentUnauthorized) {
        expect(response.statusCode).toBe(403);
        expect(errorSchema.parse(response.json()).code).toBe('AUTH_FORBIDDEN');
      }
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
