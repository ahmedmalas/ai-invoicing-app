import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('customer deletion lifecycle', () => {
  it('deletes an unreferenced customer with a true empty 204 response', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'customer-delete-e2e-'));
    directories.push(directory);
    const app = await buildApp({
      dbPath: join(directory, 'app.db'),
      authBypassForTesting: true,
    });

    const created = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: {
        displayName: 'Disposable Customer',
        email: 'delete-me@example.test',
      },
    });
    expect(created.statusCode).toBe(201);
    const customer = created.json<{ id: string }>();

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/customers/${customer.id}`,
    });

    expect(deleted.statusCode).toBe(204);
    expect(deleted.rawPayload).toHaveLength(0);

    const missing = await app.inject({
      method: 'GET',
      url: `/customers/${customer.id}`,
    });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });
});
