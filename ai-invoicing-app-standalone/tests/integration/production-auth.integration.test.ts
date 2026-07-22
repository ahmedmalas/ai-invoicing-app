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

describe('production account registration and recovery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('registers an owner, provisions a workspace, and returns an active session', async () => {
    const authUserId = '10000000-0000-4000-8000-000000000001';
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(fetchInputUrl(input));
      return jsonResponse({
        user: { id: authUserId, identities: [{ id: 'identity-1' }] },
        session: { access_token: 'access', refresh_token: 'refresh' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp(authOptions);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up',
      payload: {
        name: 'New Owner',
        email: 'OWNER@EXAMPLE.COM',
        password: 'StrongPassword123',
        passwordConfirmation: 'StrongPassword123',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      status: 'active',
      session: { access_token: 'access', refresh_token: 'refresh' },
    });
    expect(await app.db.resolveWorkspaceAccess(authUserId)).toMatchObject({ role: 'owner' });
    expect(requestedUrls[0]).toContain(
      encodeURIComponent('https://ai-invoicing-app.vercel.app/auth/callback'),
    );
    await app.close();
  });

  it('requires verification when Supabase does not issue a session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          id: '10000000-0000-4000-8000-000000000002',
          identities: [{ id: 'identity-2' }],
        }),
      ),
    );
    const app = await buildApp(authOptions);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up',
      payload: {
        name: 'Verified Later',
        email: 'later@example.com',
        password: 'StrongPassword123',
        passwordConfirmation: 'StrongPassword123',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ status: 'verification_required' });
    await app.close();
  });

  it('gives clear validation and duplicate-account responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ user: { id: 'obscured', identities: [] }, session: null })),
    );
    const app = await buildApp(authOptions);
    const mismatch = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up',
      payload: {
        name: 'Owner',
        email: 'owner@example.com',
        password: 'StrongPassword123',
        passwordConfirmation: 'DifferentPassword123',
      },
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up',
      payload: {
        name: 'Owner',
        email: 'owner@example.com',
        password: 'StrongPassword123',
        passwordConfirmation: 'StrongPassword123',
      },
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json<{ code: string }>().code).toBe('VALIDATION_FAILED');
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'ACCOUNT_ALREADY_EXISTS' });
    await app.close();
  });

  it('returns the same neutral recovery response regardless of provider outcome', async () => {
    const requestedUrls: string[] = [];
    let requestCount = 0;
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      requestedUrls.push(fetchInputUrl(input));
      requestCount += 1;
      return requestCount === 1
        ? jsonResponse({}, 200)
        : jsonResponse({ error_code: 'user_not_found' }, 400);
    });
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp(authOptions);
    const known = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'known@example.com' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'unknown@example.com' },
    });
    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(known.json()).toEqual(unknown.json());
    expect(requestedUrls[0]).toContain(
      encodeURIComponent('https://ai-invoicing-app.vercel.app/reset-password'),
    );
    await app.close();
  });

  it('validates the recovery session, updates the password, and revokes sessions', async () => {
    const requests: Array<[string | undefined, string]> = [];
    let requestCount = 0;
    const fetchMock = vi.fn(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
        requests.push([init?.method, fetchInputUrl(input)]);
        requestCount += 1;
        return requestCount < 3
          ? jsonResponse({ id: 'recovery-user' })
          : new Response(null, { status: 204 });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = await buildApp(authOptions);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: { authorization: 'Bearer recovery-token' },
      payload: {
        password: 'NewStrongPassword123',
        passwordConfirmation: 'NewStrongPassword123',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(requests).toEqual([
      ['GET', 'https://replacement.supabase.co/auth/v1/user'],
      ['PUT', 'https://replacement.supabase.co/auth/v1/user'],
      ['POST', 'https://replacement.supabase.co/auth/v1/logout?scope=global'],
    ]);
    await app.close();
  });

  it.each([
    ['missing', undefined],
    ['expired or reused', 'Bearer expired-token'],
  ])('rejects a %s recovery session safely', async (_label, authorization) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error_code: 'bad_jwt' }, 401)));
    const app = await buildApp(authOptions);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      ...(authorization ? { headers: { authorization } } : {}),
      payload: {
        password: 'NewStrongPassword123',
        passwordConfirmation: 'NewStrongPassword123',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'RECOVERY_LINK_INVALID' });
    await app.close();
  });

  it('serves all account screens with branded links and recovery handling', async () => {
    const app = await buildApp({ ...authOptions, serveFrontend: true });
    for (const path of ['/sign-in', '/create-account', '/forgot-password', '/reset-password', '/auth/callback']) {
      const response = await app.inject({ method: 'GET', url: path });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Aleya Invoicing');
    }
    const script = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(script.body).toContain('Create account');
    expect(script.body).toContain('Forgot password?');
    expect(script.body).toContain("callback.get('type') === 'recovery'");
    expect(script.body).toContain("localStorage.setItem(SESSION_KEY");
    expect(script.body).toContain("localStorage.removeItem(SESSION_KEY");
    expect(script.body).toContain('shouldCloseDrawerOnBackdropClick');
    expect(script.body).toContain('mountInvoiceWorkspace');
    expect(script.body).toContain('/workspace/invoices/new');
    expect(script.body).toContain('isBusinessProfileReady');
    expect(script.body).toContain('Open Settings');
    const guards = await app.inject({ method: 'GET', url: '/assets/form-interaction-guards.js' });
    expect(guards.statusCode).toBe(200);
    expect(guards.body).toContain('shouldCloseDrawerOnBackdropClick');
    const editor = await app.inject({ method: 'GET', url: '/assets/invoice-editor.js' });
    expect(editor.statusCode).toBe(200);
    expect(editor.body).toContain('TAX INVOICE');
    expect(editor.body).toContain('data-invoice-editor');
    expect(editor.body).toContain('createInvoiceEditor');
    expect(editor.body).toContain('data-invoice-field');
    expect(editor.body).toContain('buildPayload');
    expect(script.body).toContain('createInvoiceEditor');
    expect(script.body).toContain('ensureInvoiceEditor');
    const styles = await app.inject({ method: 'GET', url: '/assets/styles.css' });
    expect(styles.body).toContain('translate3d(0, -100%, 0)');
    expect(styles.body).toContain('Web Animations API');
    const launch = await app.inject({ method: 'GET', url: '/assets/launch-app.js' });
    expect(launch.statusCode).toBe(200);
    expect(launch.body).not.toContain('BUSINESS_PROFILE_NOT_FOUND');
    expect(launch.body).toContain('invalidateBusinessProfileCache');
    const editShell = await app.inject({
      method: 'GET',
      url: '/workspace/invoices/sample-id/edit',
    });
    expect(editShell.statusCode).toBe(200);
    expect(editShell.body).toContain('Aleya Invoicing');
    await app.close();
  });
});
