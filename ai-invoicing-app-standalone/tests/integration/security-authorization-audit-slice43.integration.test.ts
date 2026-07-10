import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

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

function authHeaders(userId: string, organizationId = 'org-a'): Record<string, string> {
  return {
    'x-actor-user-id': userId,
    'x-organization-id': organizationId,
  };
}

describe('slice 43 security and authorization audit', () => {
  it('disables env auth bypass outside test runtime and blocks cross-tenant attempts', async () => {
    const { dir, dbPath } = createTempDbPath('ai-business-os-slice43-auth-');
    let adminUserId = '';
    let readOnlyUserId = '';
    const originalBypass = process.env.AI_BUSINESS_OS_TEST_AUTH_BYPASS;

    const bootstrapApp = await buildApp({
      dbPath,
      authBypassForTesting: true,
      organizationId: 'org-a',
      nodeEnv: 'test',
    });
    try {
      const adminRole = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/roles',
            payload: { name: 'Slice43 Admin', canBeAssigned: true, canManageAssignments: true },
          })
        ).json(),
      );
      const readonlyRole = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/roles',
            payload: { name: 'Slice43 Readonly', canBeAssigned: false, canManageAssignments: false },
          })
        ).json(),
      );
      adminUserId = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/users',
            payload: { displayName: 'Slice43 Admin User', roleIds: [adminRole.id] },
          })
        ).json(),
      ).id;
      readOnlyUserId = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/users',
            payload: { displayName: 'Slice43 Readonly User', roleIds: [readonlyRole.id] },
          })
        ).json(),
      ).id;
    } finally {
      await bootstrapApp.close();
    }

    process.env.AI_BUSINESS_OS_TEST_AUTH_BYPASS = '1';
    const app = await buildApp({
      dbPath,
      nodeEnv: 'production',
      organizationId: 'org-a',
    });
    try {
      const unauthenticatedRead = await app.inject({
        method: 'GET',
        url: '/search?q=slice43&limit=10&offset=0',
      });
      expect(unauthenticatedRead.statusCode).toBe(401);
      expect(errorSchema.parse(unauthenticatedRead.json()).code).toBe('AUTH_UNAUTHENTICATED');

      const backupBefore = backupSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/platform/backup',
            headers: authHeaders(adminUserId),
          })
        ).json(),
      ).snapshot.entities;
      const customersBefore = backupBefore.customers ?? [];
      const timelineBefore = backupBefore.timeline_events ?? [];

      const crossTenantRead = await app.inject({
        method: 'GET',
        url: '/search?q=slice43&limit=10&offset=0',
        headers: authHeaders(readOnlyUserId, 'org-b'),
      });
      expect(crossTenantRead.statusCode).toBe(403);
      expect(errorSchema.parse(crossTenantRead.json()).code).toBe('AUTH_FORBIDDEN');

      const crossTenantWrite = await app.inject({
        method: 'POST',
        url: '/customers',
        headers: authHeaders(adminUserId, 'org-b'),
        payload: { displayName: 'Cross Tenant Mutation Attempt' },
      });
      expect(crossTenantWrite.statusCode).toBe(403);
      expect(errorSchema.parse(crossTenantWrite.json()).code).toBe('AUTH_FORBIDDEN');

      const readonlyDiagnostics = await app.inject({
        method: 'GET',
        url: '/health/diagnostics',
        headers: authHeaders(readOnlyUserId),
      });
      expect(readonlyDiagnostics.statusCode).toBe(403);
      expect(errorSchema.parse(readonlyDiagnostics.json()).code).toBe('AUTH_FORBIDDEN');

      const backupAfter = backupSchema.parse(
        (
          await app.inject({
            method: 'GET',
            url: '/platform/backup',
            headers: authHeaders(adminUserId),
          })
        ).json(),
      ).snapshot.entities;

      expect(backupAfter.customers ?? []).toHaveLength(customersBefore.length);
      expect(backupAfter.timeline_events ?? []).toHaveLength(timelineBefore.length);
    } finally {
      await app.close();
      if (originalBypass === undefined) {
        delete process.env.AI_BUSINESS_OS_TEST_AUTH_BYPASS;
      } else {
        process.env.AI_BUSINESS_OS_TEST_AUTH_BYPASS = originalBypass;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('redacts sensitive query values from logs and avoids secret exposure in diagnostics', async () => {
    const { dir, dbPath } = createTempDbPath('ai-business-os-slice43-redaction-');
    let adminUserId = '';
    const originalSecret = process.env.SLICE43_RUNTIME_SECRET;
    process.env.SLICE43_RUNTIME_SECRET = 'slice43-super-secret-token';
    const bootstrapApp = await buildApp({
      dbPath,
      authBypassForTesting: true,
      organizationId: 'org-a',
      nodeEnv: 'test',
    });
    try {
      const adminRole = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/roles',
            payload: { name: 'Slice43 Redaction Admin', canBeAssigned: true, canManageAssignments: true },
          })
        ).json(),
      );
      adminUserId = idSchema.parse(
        (
          await bootstrapApp.inject({
            method: 'POST',
            url: '/users',
            payload: { displayName: 'Slice43 Redaction User', roleIds: [adminRole.id] },
          })
        ).json(),
      ).id;
    } finally {
      await bootstrapApp.close();
    }

    const stream = new PassThrough();
    let logs = '';
    stream.on('data', (chunk: Buffer) => {
      logs += chunk.toString();
    });
    const app = await buildApp({
      dbPath,
      nodeEnv: 'production',
      organizationId: 'org-a',
      authBypassForTesting: false,
      enableStructuredLogging: true,
      loggerStream: stream,
    });
    try {
      const search = await app.inject({
        method: 'GET',
        url: '/search?q=slice43-super-secret-token&limit=1&offset=0',
        headers: authHeaders(adminUserId),
      });
      expect(search.statusCode).toBe(200);

      const diagnostics = await app.inject({
        method: 'GET',
        url: '/health/diagnostics',
        headers: authHeaders(adminUserId),
      });
      expect(diagnostics.statusCode).toBe(200);
      const diagnosticsText = JSON.stringify(diagnostics.json());

      expect(logs).not.toContain('slice43-super-secret-token');
      expect(logs).toContain('/search');
      expect(diagnosticsText).not.toContain('SLICE43_RUNTIME_SECRET');
      expect(diagnosticsText).not.toContain('slice43-super-secret-token');
    } finally {
      await app.close();
      if (originalSecret === undefined) {
        delete process.env.SLICE43_RUNTIME_SECRET;
      } else {
        process.env.SLICE43_RUNTIME_SECRET = originalSecret;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
