import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

const PRODUCTION_VERIFICATION_CUSTOMER = 'ABoss Native Production Verification 2026-07-14';

const idSchema = z.object({ id: z.string().uuid() });
const errorSchema = z.object({
  status: z.number().int(),
  code: z.string().min(1),
  message: z.string().min(1),
});

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => await app.close()));
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function authHeaders(userId: string): Record<string, string> {
  return { 'x-actor-user-id': userId };
}

function abossSignedHeaders(input: {
  secret: string;
  method: string;
  path: string;
  abossUserId: string;
  abossOrganizationId: string;
  body?: string;
}): Record<string, string> {
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const body = input.body ?? 'null';
  const contentHash = createHash('sha256').update(body).digest('hex');
  const canonical = [
    'aboss-invoicing-v1',
    input.method,
    input.path,
    timestamp,
    nonce,
    input.abossUserId,
    input.abossOrganizationId,
    contentHash,
  ].join('\n');
  return {
    'x-aboss-timestamp': timestamp,
    'x-aboss-nonce': nonce,
    'x-aboss-user-id': input.abossUserId,
    'x-aboss-organization-id': input.abossOrganizationId,
    'x-aboss-content-sha256': contentHash,
    'x-aboss-signature': createHmac('sha256', input.secret).update(canonical).digest('hex'),
  };
}

describe('production customer/invoice deletion path', () => {
  it('deletes the production verification customer over the ABoss-signed API without 500', async () => {
    const secret = 'aboss-invoicing-delete-proof-secret';
    const abossUserId = randomUUID();
    const abossOrganizationId = randomUUID();
    const directory = mkdtempSync(join(tmpdir(), 'ai-delete-prod-verify-'));
    tempDirs.push(directory);
    const dbPath = join(directory, 'app.db');

    const bootstrap = await buildApp({ dbPath, nodeEnv: 'test', authBypassForTesting: true });
    const role = await bootstrap.db.createRole({
      name: 'ABoss delete actor',
      canBeAssigned: true,
      canManageAssignments: true,
    });
    const actor = await bootstrap.db.createUser({
      displayName: 'ABoss integration actor',
      isActive: true,
      roleIds: [role.id],
    });
    const verificationCustomer = await bootstrap.db.createCustomer({
      displayName: PRODUCTION_VERIFICATION_CUSTOMER,
      email: 'prod.verify@example.test',
    });
    await bootstrap.close();

    const app = await buildApp({
      dbPath,
      nodeEnv: 'test',
      authBypassForTesting: false,
      abossOnlyAuth: true,
      abossIntegrationSecret: secret,
      abossIntegrationActorUserId: actor.id,
      abossAllowedOrganizationId: abossOrganizationId,
    });
    apps.push(app);

    const deletePath = `/customers/${verificationCustomer.id}`;
    const headers = abossSignedHeaders({
      secret,
      method: 'DELETE',
      path: deletePath,
      abossUserId,
      abossOrganizationId,
    });
    const deleted = await app.inject({ method: 'DELETE', url: deletePath, headers });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true, id: verificationCustomer.id });

    // ABoss BFF sends Content-Type: application/json with an empty DELETE body.
    const emptyBodyCustomer = await app.db.createCustomer({
      displayName: `${PRODUCTION_VERIFICATION_CUSTOMER} Empty Body`,
      email: 'prod.verify.empty@example.test',
    });
    const emptyBodyPath = `/customers/${emptyBodyCustomer.id}`;
    const emptyBodyHeaders = {
      ...abossSignedHeaders({
        secret,
        method: 'DELETE',
        path: emptyBodyPath,
        abossUserId,
        abossOrganizationId,
      }),
      'content-type': 'application/json',
    };
    const emptyBodyDeleted = await app.inject({
      method: 'DELETE',
      url: emptyBodyPath,
      headers: emptyBodyHeaders,
      payload: '',
    });
    expect(emptyBodyDeleted.statusCode).toBe(200);
    expect(emptyBodyDeleted.statusCode).not.toBe(500);
    expect(emptyBodyDeleted.json()).toEqual({ deleted: true, id: emptyBodyCustomer.id });

    const getHeaders = abossSignedHeaders({
      secret,
      method: 'GET',
      path: deletePath,
      abossUserId: randomUUID(),
      abossOrganizationId,
    });
    // Nonce/timestamp unique; use a fresh signature for GET.
    const missing = await app.inject({
      method: 'GET',
      url: deletePath,
      headers: getHeaders,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('returns business-rule blockers (never 500) for protected customers and final invoices', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-delete-blockers-'));
    tempDirs.push(directory);
    const app = await buildApp({
      dbPath: join(directory, 'app.db'),
      authBypassForTesting: true,
      nodeEnv: 'test',
    });
    apps.push(app);

    const writerRole = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/roles',
          payload: { name: 'Delete Writer', canBeAssigned: true, canManageAssignments: false },
        })
      ).json(),
    );
    const readOnlyRole = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/roles',
          payload: { name: 'Delete Reader', canBeAssigned: false, canManageAssignments: false },
        })
      ).json(),
    );
    const writerUserId = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/users',
          payload: {
            displayName: 'Writer',
            email: `writer-${randomUUID()}@example.test`,
            roleIds: [writerRole.id],
          },
        })
      ).json(),
    ).id;
    const readOnlyUserId = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/users',
          payload: {
            displayName: 'Reader',
            email: `reader-${randomUUID()}@example.test`,
            roleIds: [readOnlyRole.id],
          },
        })
      ).json(),
    ).id;

    const linkedCustomer = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/customers',
          payload: { displayName: `${PRODUCTION_VERIFICATION_CUSTOMER} Linked` },
        })
      ).json(),
    );
    const draft = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/invoices',
          payload: {
            customerId: linkedCustomer.id,
            title: 'Protected draft',
            issueDate: '2026-07-14',
            dueDate: '2026-07-28',
            lineItems: [{ description: 'Line', quantity: 1, unitPrice: 50, gstApplicable: true }],
          },
        })
      ).json(),
    );
    const finalInvoice = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/invoices',
          payload: {
            customerId: linkedCustomer.id,
            title: 'Protected final',
            issueDate: '2026-07-14',
            dueDate: '2026-07-28',
            lineItems: [{ description: 'Line', quantity: 1, unitPrice: 80, gstApplicable: true }],
          },
        })
      ).json(),
    );
    expect(
      (await app.inject({ method: 'POST', url: `/invoices/${finalInvoice.id}/finalise` })).statusCode,
    ).toBe(200);

    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/customers/${linkedCustomer.id}`,
      headers: authHeaders(readOnlyUserId),
    });
    expect(forbidden.statusCode).toBe(403);
    expect(errorSchema.parse(forbidden.json()).code).toBe('AUTH_FORBIDDEN');

    const blockedCustomer = await app.inject({
      method: 'DELETE',
      url: `/customers/${linkedCustomer.id}`,
      headers: authHeaders(writerUserId),
    });
    expect(blockedCustomer.statusCode).toBe(409);
    expect(blockedCustomer.statusCode).not.toBe(500);
    expect(errorSchema.parse(blockedCustomer.json()).code).toBe('CUSTOMER_HAS_INVOICES');

    const blockedFinal = await app.inject({
      method: 'DELETE',
      url: `/invoices/${finalInvoice.id}`,
      headers: authHeaders(writerUserId),
    });
    expect(blockedFinal.statusCode).toBe(409);
    expect(blockedFinal.statusCode).not.toBe(500);
    expect(errorSchema.parse(blockedFinal.json()).code).toBe('ONLY_DRAFT_INVOICES_CAN_BE_DELETED');

    const deletedDraft = await app.inject({
      method: 'DELETE',
      url: `/invoices/${draft.id}`,
      headers: authHeaders(writerUserId),
    });
    expect(deletedDraft.statusCode).toBe(200);
    expect(deletedDraft.json()).toEqual({ deleted: true, id: draft.id });

    // Converted-quote draft invoices are blocked, not 500.
    const quoteCustomer = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/customers',
          payload: { displayName: 'Quote conversion customer' },
        })
      ).json(),
    );
    const quote = idSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/quotes',
          payload: {
            customerId: quoteCustomer.id,
            title: 'Convert then protect',
            issueDate: '2026-07-14',
            expiryDate: '2026-08-14',
            lineItems: [{ description: 'Work', quantity: 1, unitPrice: 100, gstApplicable: true }],
          },
        })
      ).json(),
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/quotes/${quote.id}/status`,
          payload: { status: 'Sent' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/quotes/${quote.id}/status`,
          payload: { status: 'Accepted' },
        })
      ).statusCode,
    ).toBe(200);
    const converted = z
      .object({ invoice: z.object({ id: z.string().uuid() }) })
      .parse(
        (
          await app.inject({
            method: 'POST',
            url: `/quotes/${quote.id}/convert`,
            payload: { dueDate: '2026-08-30' },
          })
        ).json(),
      );
    const blockedConvertedDraft = await app.inject({
      method: 'DELETE',
      url: `/invoices/${converted.invoice.id}`,
      headers: authHeaders(writerUserId),
    });
    expect(blockedConvertedDraft.statusCode).toBe(409);
    expect(blockedConvertedDraft.statusCode).not.toBe(500);
    expect(errorSchema.parse(blockedConvertedDraft.json()).code).toBe('INVOICE_REFERENCED_BY_QUOTE');
  });
});
