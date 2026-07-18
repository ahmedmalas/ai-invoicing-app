import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';

describe('browser authentication and routing compatibility', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps a valid Supabase bearer identity to the existing application role model', async () => {
    const app = await buildApp({
      dbPath: ':memory:',
      nodeEnv: 'test',
      authBypassForTesting: false,
      abossOnlyAuth: true,
      supabaseUrl: 'https://replacement.supabase.co',
      supabaseAnonKey: 'replacement-public-key',
    });
    const role = await app.db.createRole({
      name: 'Browser owner',
      canBeAssigned: true,
      canManageAssignments: true,
    });
    const actor = await app.db.createUser({
      displayName: 'Ahmed',
      email: 'ahmed@example.com',
      isActive: true,
      roleIds: [role.id],
    });
    const mockedFetch = vi.fn(async () => new Response(JSON.stringify({ id: actor.id }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', mockedFetch);

    const response = await app.inject({
      method: 'GET',
      url: '/api/customers',
      headers: { authorization: 'Bearer valid-browser-session' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ customers: [] });
    expect(mockedFetch).toHaveBeenCalledOnce();
    await app.close();
  });

  it('serves the browser shell while leaving owner provisioning disabled', async () => {
    const app = await buildApp({
      dbPath: ':memory:',
      nodeEnv: 'test',
      authBypassForTesting: false,
      serveFrontend: true,
    });

    const page = await app.inject({ method: 'GET', url: '/dashboard' });
    const setup = await app.inject({ method: 'GET', url: '/api/system/setup/status' });
    const mutation = await app.inject({ method: 'POST', url: '/api/system/setup', payload: {} });

    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('ABoss Invoicing');
    expect(setup.json()).toEqual({ setupRequired: false });
    expect(mutation.statusCode).toBe(401);
    await app.close();
  });

  it('serves frontend bootstrap assets publicly while protecting API routes', async () => {
    const app = await buildApp({
      dbPath: ':memory:',
      nodeEnv: 'test',
      authBypassForTesting: false,
      serveFrontend: true,
    });

    for (const path of [
      '/assets/launch-app.js',
      '/assets/auth-controls.js',
      '/assets/auth-controls.css',
      '/assets/styles.css',
      '/assets/app.js',
      '/favicon.svg',
    ]) {
      const response = await app.inject({ method: 'GET', url: path });
      expect(response.statusCode, path).toBe(200);
      expect(response.headers['content-type']).not.toContain('application/json');
    }

    const protectedApi = await app.inject({ method: 'GET', url: '/api/customers' });
    expect(protectedApi.statusCode).toBe(401);

    await app.close();
  });
});
