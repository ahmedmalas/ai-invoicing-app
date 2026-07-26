import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveBasiqLaunchMode,
  startBasiqConnect,
} from '../../src/domain/banking/connection-service.js';
import {
  appendAuthLinkState,
  buildBasiqConsentUiUrl,
  createBasiqAuthLink,
  resetBasiqTokenCacheForTests,
} from '../../src/services/basiq-client.js';
import type { BankStore } from '../../src/db/bank-store.js';

function mockStore(existing?: {
  id?: string;
  providerUserId?: string;
  status?: string;
  authLinkMobile?: string | null;
}): BankStore {
  const connection = existing
    ? {
        id: existing.id || 'conn-1',
        businessId: '11111111-1111-4111-8111-111111111111',
        provider: 'basiq' as const,
        providerUserId: existing.providerUserId || 'basiq-user-1',
        providerConnectionId: null,
        status: (existing.status || 'connecting') as 'connecting',
        consentId: null,
        consentStatus: null,
        consentStartedAt: null,
        consentExpiresAt: null,
        lastSyncAttemptAt: null,
        lastSuccessfulSyncAt: null,
        errorCode: null,
        errorMessage: null,
        authLinkMobile: existing.authLinkMobile ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    : null;
  return {
    getConnectionByBusiness: vi.fn(async () => connection),
    getConnectionById: vi.fn(async () => connection),
    upsertConnection: vi.fn(async (input) => ({
      id: input.id || 'conn-1',
      businessId: input.businessId,
      provider: 'basiq',
      providerUserId: input.providerUserId,
      providerConnectionId: null,
      status: 'connecting',
      consentId: null,
      consentStatus: null,
      consentStartedAt: input.consentStartedAt || null,
      consentExpiresAt: null,
      lastSyncAttemptAt: null,
      lastSuccessfulSyncAt: null,
      errorCode: null,
      errorMessage: null,
      authLinkMobile: input.authLinkMobile ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    updateConnectionFields: vi.fn(async (_b, _id, fields) => ({
      id: 'conn-1',
      businessId: '11111111-1111-4111-8111-111111111111',
      provider: 'basiq',
      providerUserId: 'basiq-user-1',
      providerConnectionId: null,
      status: 'connecting',
      consentId: null,
      consentStatus: null,
      consentStartedAt: null,
      consentExpiresAt: null,
      lastSyncAttemptAt: null,
      lastSuccessfulSyncAt: null,
      errorCode: null,
      errorMessage: null,
      authLinkMobile: fields.authLinkMobile ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    saveConnectState: vi.fn(async () => undefined),
  } as unknown as BankStore;
}

describe('Basiq AuthLink connect flow', () => {
  afterEach(() => {
    resetBasiqTokenCacheForTests();
    vi.unstubAllGlobals();
    delete process.env.BASIQ_API_KEY;
    delete process.env.BASIQ_ENVIRONMENT;
  });

  it('createBasiqAuthLink posts mobile for hosted 2FA and returns public URL', async () => {
    process.env.BASIQ_API_KEY = 'test-key';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
          status: 200,
        });
      }
      if (String(url).includes('/auth_link')) {
        expect(JSON.parse(String(init?.body || '{}'))).toEqual({ mobile: '+61412345678' });
        return new Response(
          JSON.stringify({
            type: 'auth_link',
            expiresAt: '2026-07-26T00:00:00Z',
            mobile: '+61412345678',
            links: { public: 'https://connect.basiq.io/sandbox-link' },
          }),
          { status: 201 },
        );
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createBasiqAuthLink('user-1', { mobile: '+61412345678' });
    expect(result.publicUrl).toBe('https://connect.basiq.io/sandbox-link');
    expect(result.mobile).toBe('+61412345678');
  });

  it('sandbox connect requires a real AU mobile and never uses the placeholder', async () => {
    process.env.BASIQ_API_KEY = 'test-key';
    process.env.BASIQ_ENVIRONMENT = 'sandbox';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
          status: 200,
        });
      }
      if (href.endsWith('/users')) {
        const body = JSON.parse(String(init?.body || '{}')) as { mobile?: string };
        expect(body.mobile).toBe('+61412345678');
        expect(body.mobile).not.toBe('+61400000000');
        return new Response(JSON.stringify({ id: 'basiq-user-1', mobile: body.mobile }), {
          status: 201,
        });
      }
      if (href.includes('/consents')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (href.includes('/auth_link')) {
        const body = JSON.parse(String(init?.body || '{}')) as { mobile?: string };
        expect(body.mobile).toBe('+61412345678');
        return new Response(
          JSON.stringify({
            links: { public: 'https://connect.basiq.io/hooli-test' },
            expiresAt: '2026-07-26T00:00:00Z',
            mobile: '+61412345678',
          }),
          { status: 201 },
        );
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const started = await startBasiqConnect(mockStore(), {
      businessId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      workspaceSchema: 'ws_test',
      email: 'owner@example.com',
      mobile: '+61412345678',
    });

    expect(started.sandbox).toBe(true);
    expect(started.deliveryMode).toBe('open_auth_link');
    expect(started.launchMode).toBe('auth_link');
    expect(started.authLinkUrl.startsWith('https://connect.basiq.io/hooli-test')).toBe(true);
    expect(started.authLinkUrl).toContain('state=');
    expect(started.authLinkMobile).toBe('+61412345678');
    expect(started.authLinkMobileMasked).toBe('+614••••5678');
    expect(started.message).toContain('+614••••5678');
    expect(started.message.toLowerCase()).not.toContain('no sms is sent');
  });

  it('uses Consent UI action=connect when an active consent already exists', async () => {
    process.env.BASIQ_API_KEY = 'test-key';
    process.env.BASIQ_ENVIRONMENT = 'sandbox';
    const tokenBodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const href = String(url);
        if (href.endsWith('/token')) {
          tokenBodies.push(String(init?.body || ''));
          return new Response(
            JSON.stringify({ access_token: 'client-tok-xyz', expires_in: 3600 }),
            { status: 200 },
          );
        }
        if (href.endsWith('/users/basiq-user-1') && (!init?.method || init.method === 'GET')) {
          return new Response(
            JSON.stringify({ id: 'basiq-user-1', mobile: '+61412345678' }),
            { status: 200 },
          );
        }
        if (href.endsWith('/users/basiq-user-1') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ id: 'basiq-user-1', mobile: '+61412345678' }),
            { status: 200 },
          );
        }
        if (href.includes('/consents')) {
          return new Response(
            JSON.stringify({
              data: [{ id: 'consent-1', status: 'active', expiresAt: '2099-01-01T00:00:00Z' }],
            }),
            { status: 200 },
          );
        }
        if (href.includes('/auth_link')) {
          throw new Error('AuthLink must not be used when active consent exists');
        }
        return new Response('{}', { status: 404 });
      }),
    );

    const started = await startBasiqConnect(
      mockStore({
        providerUserId: 'basiq-user-1',
        status: 'error',
        authLinkMobile: '+61412345678',
      }),
      {
        businessId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        workspaceSchema: 'ws_test',
        email: 'owner@example.com',
        mobile: '+61412345678',
      },
    );

    expect(started.launchMode).toBe('consent_ui_connect');
    expect(started.deliveryMode).toBe('consent_ui_connect');
    expect(started.activeConsentId).toBe('consent-1');
    const launched = new URL(started.authLinkUrl);
    expect(launched.origin).toBe('https://consent.basiq.io');
    expect(launched.pathname).toBe('/home');
    expect(launched.searchParams.get('action')).toBe('connect');
    expect(launched.searchParams.get('state')).toBeTruthy();
    expect(launched.searchParams.get('institutionId')).toBe('AU00000');
    expect(launched.searchParams.get('token')).toBe('client-tok-xyz');
    expect(tokenBodies.some((body) => body.includes('CLIENT_ACCESS'))).toBe(true);
    expect(started.message.toLowerCase()).toContain('action=connect');
    expect(started.message.toLowerCase()).toContain('not the manage');
  });

  it('uses Consent UI action=connect for existing provider user even without listed consent', async () => {
    process.env.BASIQ_API_KEY = 'test-key';
    process.env.BASIQ_ENVIRONMENT = 'sandbox';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const href = String(url);
        if (href.endsWith('/token')) {
          return new Response(
            JSON.stringify({ access_token: 'client-tok-2', expires_in: 3600 }),
            { status: 200 },
          );
        }
        if (href.endsWith('/users/basiq-user-1') && (!init?.method || init.method === 'GET')) {
          return new Response(
            JSON.stringify({ id: 'basiq-user-1', mobile: '+61412345678' }),
            { status: 200 },
          );
        }
        if (href.endsWith('/users/basiq-user-1') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ id: 'basiq-user-1', mobile: '+61412345678' }),
            { status: 200 },
          );
        }
        if (href.includes('/consents')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (href.includes('/auth_link')) {
          throw new Error('AuthLink must not be used for existing provider user reconnect');
        }
        return new Response('{}', { status: 404 });
      }),
    );

    const started = await startBasiqConnect(
      mockStore({
        providerUserId: 'basiq-user-1',
        status: 'error',
        authLinkMobile: '+61412345678',
      }),
      {
        businessId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        workspaceSchema: 'ws_test',
        email: 'owner@example.com',
        mobile: '+61412345678',
      },
    );

    expect(started.launchMode).toBe('consent_ui_connect');
    expect(started.deliveryMode).toBe('consent_ui_connect');
    expect(started.activeConsentId).toBeNull();
    const launched = new URL(started.authLinkUrl);
    expect(launched.origin).toBe('https://consent.basiq.io');
    expect(launched.pathname).toBe('/home');
    expect(launched.searchParams.get('action')).toBe('connect');
    expect(launched.searchParams.get('state')).toBeTruthy();
    expect(launched.searchParams.get('institutionId')).toBe('AU00000');
    expect(launched.searchParams.get('token')).toBe('client-tok-2');
    expect(started.redirectUrlRequired).toBe(
      'https://ai-invoicing-app.vercel.app/api/banking/basiq/callback',
    );
  });

  it('resolveBasiqLaunchMode prefers consent_ui_connect for existing users/consent', () => {
    expect(
      resolveBasiqLaunchMode({
        activeConsent: { id: 'c1', status: 'active', expiresAt: null, active: true },
      }),
    ).toBe('consent_ui_connect');
    expect(
      resolveBasiqLaunchMode({
        activeConsent: null,
        hasExistingProviderUser: true,
      }),
    ).toBe('consent_ui_connect');
    expect(
      resolveBasiqLaunchMode({
        activeConsent: { id: 'c1', status: 'active', expiresAt: null, active: true },
        freshConsent: true,
      }),
    ).toBe('auth_link');
    expect(resolveBasiqLaunchMode({ activeConsent: null })).toBe('auth_link');
  });

  it('builds Consent UI URLs with action/state and appends state to AuthLink', () => {
    const consentUrl = buildBasiqConsentUiUrl({
      clientAccessToken: 'tok',
      action: 'connect',
      state: 'abc',
      institutionId: 'AU00000',
    });
    expect(consentUrl).toContain('action=connect');
    expect(consentUrl).toContain('state=abc');
    expect(consentUrl).toContain('institutionId=AU00000');
    expect(appendAuthLinkState('https://connect.basiq.io/xyz', 'st')).toBe(
      'https://connect.basiq.io/xyz?state=st',
    );
  });

  it('still creates AuthLink with mobile override when Basiq user update is denied', async () => {
    process.env.BASIQ_API_KEY = 'test-key';
    process.env.BASIQ_ENVIRONMENT = 'sandbox';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const href = String(url);
        if (href.endsWith('/token')) {
          return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
            status: 200,
          });
        }
        if (href.endsWith('/users/basiq-user-1') && (!init?.method || init.method === 'GET')) {
          return new Response(
            JSON.stringify({ id: 'basiq-user-1', mobile: '+61400000000', email: 'a@b.c' }),
            { status: 200 },
          );
        }
        if (href.endsWith('/users/basiq-user-1') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              data: [{ title: 'Access denied.', code: 'access-denied' }],
            }),
            { status: 403 },
          );
        }
        if (href.includes('/consents')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (href.includes('/auth_link')) {
          const body = JSON.parse(String(init?.body || '{}'));
          expect(body.mobile).toBe('+61498765432');
          return new Response(
            JSON.stringify({
              links: { public: 'https://connect.basiq.io/override-link' },
              mobile: '+61498765432',
              expiresAt: '2026-07-26T00:00:00Z',
            }),
            { status: 201 },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );

    const started = await startBasiqConnect(
      mockStore({
        providerUserId: 'basiq-user-1',
        status: 'connecting',
        authLinkMobile: null,
      }),
      {
        businessId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        workspaceSchema: 'ws_test',
        email: 'owner@example.com',
        mobile: '+61498765432',
        changeMobile: true,
      },
    );

    expect(started.authLinkUrl.startsWith('https://connect.basiq.io/override-link')).toBe(true);
    expect(started.authLinkUrl).toContain('state=');
    expect(started.authLinkMobileMasked).toBe('+614••••5432');
  });

  it('updates an existing Basiq user when changing mobile and creates a new AuthLink', async () => {
    process.env.BASIQ_API_KEY = 'test-key';
    process.env.BASIQ_ENVIRONMENT = 'sandbox';
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const href = String(url);
        if (href.endsWith('/token')) {
          return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
            status: 200,
          });
        }
        if (href.endsWith('/users/basiq-user-1') && init?.method === 'GET') {
          return new Response(
            JSON.stringify({ id: 'basiq-user-1', mobile: '+61400000000', email: 'a@b.c' }),
            { status: 200 },
          );
        }
        if (href.endsWith('/users/basiq-user-1') && init?.method === 'POST') {
          const body = JSON.parse(String(init?.body || '{}'));
          calls.push({ url: href, body });
          expect(body.mobile).toBe('+61498765432');
          return new Response(
            JSON.stringify({ id: 'basiq-user-1', mobile: '+61498765432' }),
            { status: 200 },
          );
        }
        if (href.includes('/consents')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (href.includes('/auth_link')) {
          const body = JSON.parse(String(init?.body || '{}'));
          calls.push({ url: href, body });
          expect(body.mobile).toBe('+61498765432');
          return new Response(
            JSON.stringify({
              links: { public: 'https://connect.basiq.io/new-link' },
              mobile: '+61498765432',
              expiresAt: '2026-07-26T00:00:00Z',
            }),
            { status: 201 },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );

    const started = await startBasiqConnect(
      mockStore({
        providerUserId: 'basiq-user-1',
        status: 'connecting',
        authLinkMobile: '+61400000000',
      }),
      {
        businessId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        workspaceSchema: 'ws_test',
        email: 'owner@example.com',
        mobile: '+61498765432',
        changeMobile: true,
      },
    );

    expect(started.authLinkUrl.startsWith('https://connect.basiq.io/new-link')).toBe(true);
    expect(started.authLinkMobileMasked).toBe('+614••••5432');
    expect(calls.some((c) => String(c.url).includes('/users/basiq-user-1'))).toBe(true);
    expect(calls.some((c) => String(c.url).includes('/auth_link'))).toBe(true);
  });

  it('rejects sandbox connect without a mobile (no silent placeholder)', async () => {
    process.env.BASIQ_API_KEY = 'test-key';
    process.env.BASIQ_ENVIRONMENT = 'sandbox';

    await expect(
      startBasiqConnect(mockStore(), {
        businessId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        workspaceSchema: 'ws_test',
        email: 'owner@example.com',
        mobile: null,
      }),
    ).rejects.toMatchObject({ code: 'BANK_CONNECT_MOBILE_INVALID' });
  });

  it('production connect requires a valid Australian mobile for AuthLink 2FA', async () => {
    process.env.BASIQ_API_KEY = 'test-key';
    process.env.BASIQ_ENVIRONMENT = 'production';

    await expect(
      startBasiqConnect(mockStore(), {
        businessId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        workspaceSchema: 'ws_test',
        email: 'owner@example.com',
        mobile: null,
      }),
    ).rejects.toMatchObject({ code: 'BANK_CONNECT_MOBILE_INVALID' });
  });

  it('surfaces Basiq provider error detail when auth_link fails', async () => {
    process.env.BASIQ_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/token')) {
          return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
            status: 200,
          });
        }
        if (String(url).includes('/auth_link')) {
          return new Response(
            JSON.stringify({
              data: [{ title: 'Invalid mobile', detail: 'mobile must be E.164', code: 'invalid' }],
            }),
            { status: 400 },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );

    await expect(createBasiqAuthLink('user-1', { mobile: '+61412345678' })).rejects.toMatchObject({
      name: 'BasiqClientError',
      providerDetail: expect.stringContaining('Invalid mobile'),
    });
  });
});
