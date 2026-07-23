import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../../src/app.js';

const authOptions = {
  dbPath: ':memory:',
  nodeEnv: 'test',
  authBypassForTesting: false,
  abossOnlyAuth: true,
  supabaseUrl: 'https://replacement.supabase.co',
  supabaseAnonKey: 'public-anon-key',
  publicAppUrl: 'https://ai-invoicing-app.vercel.app',
} as const;

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function fetchInputUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe('workspace setup for authenticated Auth users', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps existing workspace membership working', async () => {
    const authUserId = '20000000-0000-4000-8000-000000000101';
    const app = await buildApp(authOptions);
    await app.db.provisionWorkspaceOwner({
      authUserId,
      displayName: 'Existing Owner',
      email: 'existing@example.com',
      workspaceName: 'Existing workspace',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ id: authUserId, email: 'existing@example.com' })),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/customers',
      headers: { authorization: 'Bearer existing-session' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ customers: [] });
    await app.close();
  });

  it('returns WORKSPACE_SETUP_REQUIRED for a valid session without an app user', async () => {
    const authUserId = '20000000-0000-4000-8000-000000000102';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          id: authUserId,
          email: 'orphan@example.com',
          user_metadata: {},
        }),
      ),
    );
    const app = await buildApp(authOptions);
    const response = await app.inject({
      method: 'GET',
      url: '/api/customers',
      headers: { authorization: 'Bearer orphan-session' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'WORKSPACE_SETUP_REQUIRED',
      message: 'WORKSPACE_SETUP_REQUIRED',
    });
    expect(await app.db.resolveWorkspaceAccess(authUserId)).toBeNull();
    await app.close();
  });

  it('returns WORKSPACE_SETUP_REQUIRED when membership is missing even without display_name metadata', async () => {
    const authUserId = '20000000-0000-4000-8000-000000000103';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          id: authUserId,
          email: 'aleya.launch.validator@cursor.local',
          user_metadata: { email_verified: true },
        }),
      ),
    );
    const app = await buildApp(authOptions);
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer validator-session' },
    });
    expect(me.statusCode).toBe(409);
    expect(me.json<{ code: string }>().code).toBe('WORKSPACE_SETUP_REQUIRED');
    await app.close();
  });

  it('provisions a private workspace for the authenticated user on first setup', async () => {
    const authUserId = '20000000-0000-4000-8000-000000000104';
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      expect(fetchInputUrl(input)).toContain('/auth/v1/user');
      return jsonResponse({
        id: authUserId,
        email: 'new-owner@example.com',
        user_metadata: {},
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp(authOptions);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-workspace',
      headers: { authorization: 'Bearer setup-token' },
      payload: {
        displayName: 'New Owner',
        workspaceName: 'New Owner workspace',
        // Ignored — must not attach to another organisation/user.
        authUserId: '20000000-0000-4000-8000-999999999999',
        workspaceId: '20000000-0000-4000-8000-888888888888',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: 'created',
      workspace: { name: 'New Owner workspace', role: 'owner' },
    });
    const access = await app.db.resolveWorkspaceAccess(authUserId);
    expect(access).toMatchObject({ role: 'owner', workspaceName: 'New Owner workspace' });
    expect(await app.db.resolveWorkspaceAccess('20000000-0000-4000-8000-999999999999')).toBeNull();
    const actor = await app.db.getUserById(authUserId);
    expect(actor).toMatchObject({
      displayName: 'New Owner',
      email: 'new-owner@example.com',
      isActive: true,
    });

    const after = await app.inject({
      method: 'GET',
      url: '/api/customers',
      headers: { authorization: 'Bearer setup-token' },
    });
    expect(after.statusCode).toBe(200);
    await app.close();
  });

  it('is idempotent when setup-workspace is repeated', async () => {
    const authUserId = '20000000-0000-4000-8000-000000000105';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          id: authUserId,
          email: 'repeat@example.com',
          user_metadata: { display_name: 'Repeat Owner' },
        }),
      ),
    );
    const app = await buildApp(authOptions);
    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-workspace',
      headers: { authorization: 'Bearer repeat-token' },
      payload: {},
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-workspace',
      headers: { authorization: 'Bearer repeat-token' },
      payload: { displayName: 'Different Name' },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ status: 'ready' });
    expect(first.json<{ workspace: { id: string } }>().workspace.id).toBe(
      second.json<{ workspace: { id: string } }>().workspace.id,
    );
    await app.close();
  });

  it('handles concurrent provisioning without duplicate memberships', async () => {
    const authUserId = '20000000-0000-4000-8000-000000000106';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          id: authUserId,
          email: 'race@example.com',
        }),
      ),
    );
    const app = await buildApp(authOptions);
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/auth/setup-workspace',
        headers: { authorization: 'Bearer race-token' },
        payload: { displayName: 'Race Owner', workspaceName: 'Race workspace' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/auth/setup-workspace',
        headers: { authorization: 'Bearer race-token' },
        payload: { displayName: 'Race Owner', workspaceName: 'Race workspace' },
      }),
    ]);
    expect([a.statusCode, b.statusCode].every((code) => code === 200 || code === 201)).toBe(true);
    const firstId = a.json<{ workspace: { id: string } }>().workspace.id;
    const secondId = b.json<{ workspace: { id: string } }>().workspace.id;
    expect(firstId).toBe(secondId);
    expect(firstId).toBeTruthy();
    await app.close();
  });

  it('rejects invalid Supabase sessions on setup-workspace', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error_code: 'bad_jwt' }, 401)));
    const app = await buildApp(authOptions);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-workspace',
      payload: { displayName: 'Nope' },
    });
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-workspace',
      headers: { authorization: 'Bearer bad' },
      payload: { displayName: 'Nope' },
    });
    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
    expect(missing.json()).toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
    expect(invalid.json()).toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
    await app.close();
  });

  it('keeps existing sign-up provisioning behaviour', async () => {
    const authUserId = '20000000-0000-4000-8000-000000000107';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          user: { id: authUserId, identities: [{ id: 'identity-1' }] },
          session: { access_token: 'access', refresh_token: 'refresh' },
        }),
      ),
    );
    const app = await buildApp(authOptions);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up',
      payload: {
        name: 'Signup Owner',
        email: 'signup-owner@example.com',
        password: 'StrongPassword123',
        passwordConfirmation: 'StrongPassword123',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(await app.db.resolveWorkspaceAccess(authUserId)).toMatchObject({ role: 'owner' });
    await app.close();
  });

  it('serves the setup-workspace shell and client onboarding markers', async () => {
    const app = await buildApp({ ...authOptions, serveFrontend: true });
    const page = await app.inject({ method: 'GET', url: '/setup-workspace' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Aleya Invoicing');
    const script = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(script.body).toContain('setup-workspace-form');
    expect(script.body).toContain('WORKSPACE_SETUP_REQUIRED');
    expect(script.body).toContain('/api/auth/setup-workspace');
    await app.close();
  });
});
