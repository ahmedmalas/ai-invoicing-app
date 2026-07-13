import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => await app.close()));
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('ABoss native Invoicing contracts', () => {
  it('manages customers and a quote through conversion to a real invoice', async () => {
    const app = await buildApp({ dbPath: ':memory:', nodeEnv: 'test', authBypassForTesting: true });
    apps.push(app);
    const customerResponse = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { displayName: 'ABoss Test Customer', email: 'customer@example.com' },
    });
    expect(customerResponse.statusCode).toBe(201);
    const customer = customerResponse.json<{ id: string }>();

    const quoteResponse = await app.inject({
      method: 'POST',
      url: '/quotes',
      payload: {
        customerId: customer.id,
        title: 'Production readiness engagement',
        issueDate: '2026-07-13',
        expiryDate: '2026-08-13',
        terms: '30 days',
        lineItems: [{ description: 'Implementation', quantity: 2, unitPrice: 500, gstApplicable: true }],
      },
    });
    expect(quoteResponse.statusCode).toBe(201);
    const quote = quoteResponse.json<{ id: string; quoteNumber: string; status: string; totals: { total: number } }>();
    expect(quote.quoteNumber).toMatch(/^QUO-/);
    expect(quote.status).toBe('Draft');
    expect(quote.totals.total).toBe(1100);

    expect((await app.inject({ method: 'POST', url: `/quotes/${quote.id}/status`, payload: { status: 'Sent' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/quotes/${quote.id}/status`, payload: { status: 'Accepted' } })).statusCode).toBe(200);
    const converted = await app.inject({
      method: 'POST',
      url: `/quotes/${quote.id}/convert`,
      payload: { dueDate: '2026-08-30' },
    });
    expect(converted.statusCode).toBe(200);
    const conversion = converted.json<{ quote: { status: string; convertedInvoiceId: string }; invoice: { id: string; status: string } }>();
    expect(conversion.quote.status).toBe('Converted');
    expect(conversion.quote.convertedInvoiceId).toBe(conversion.invoice.id);
    expect(conversion.invoice.status).toBe('Draft');

    const lists = await Promise.all([
      app.inject({ method: 'GET', url: '/customers' }),
      app.inject({ method: 'GET', url: '/quotes' }),
      app.inject({ method: 'GET', url: '/invoices' }),
    ]);
    expect(lists.every((response) => response.statusCode === 200)).toBe(true);
    expect(lists[0].json<{ customers: unknown[] }>().customers).toHaveLength(1);
    expect(lists[1].json<{ quotes: unknown[] }>().quotes).toHaveLength(1);
    expect(lists[2].json<{ invoices: unknown[] }>().invoices).toHaveLength(1);
  });

  it('accepts a signed ABoss request once and rejects replay', async () => {
    const secret = 'aboss-invoicing-integration-secret-for-tests';
    const abossUserId = randomUUID();
    const abossOrganizationId = randomUUID();
    const directory = mkdtempSync(join(tmpdir(), 'aboss-invoicing-auth-'));
    tempDirs.push(directory);
    const dbPath = join(directory, 'invoicing.sqlite');
    const provisioningApp = await buildApp({ dbPath, nodeEnv: 'test', authBypassForTesting: true });
    const role = await provisioningApp.db.createRole({ name: 'ABoss owner', canBeAssigned: true, canManageAssignments: true });
    const createdActor = await provisioningApp.db.createUser({ displayName: 'ABoss integration actor', isActive: true, roleIds: [role.id] });
    await provisioningApp.close();

    const app = await buildApp({
      dbPath,
      nodeEnv: 'test',
      authBypassForTesting: false,
      abossOnlyAuth: true,
      abossIntegrationSecret: secret,
      abossIntegrationActorUserId: createdActor.id,
      abossAllowedOrganizationId: abossOrganizationId,
    });
    apps.push(app);

    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const contentHash = createHash('sha256').update('null').digest('hex');
    const canonical = ['aboss-invoicing-v1', 'GET', '/customers', timestamp, nonce, abossUserId, abossOrganizationId, contentHash].join('\n');
    const headers = {
      'x-aboss-timestamp': timestamp,
      'x-aboss-nonce': nonce,
      'x-aboss-user-id': abossUserId,
      'x-aboss-organization-id': abossOrganizationId,
      'x-aboss-content-sha256': contentHash,
      'x-aboss-signature': createHmac('sha256', secret).update(canonical).digest('hex'),
    };
    expect((await app.inject({ method: 'GET', url: '/customers', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/customers', headers })).statusCode).toBe(401);
  });
});
