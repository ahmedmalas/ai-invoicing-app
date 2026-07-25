import { afterEach, describe, expect, it, vi } from 'vitest';

import { startBasiqConnect } from '../../src/domain/banking/connection-service.js';
import {
  createBasiqAuthLink,
  resetBasiqTokenCacheForTests,
} from '../../src/services/basiq-client.js';
import type { BankStore } from '../../src/db/bank-store.js';

function mockStore(): BankStore {
  return {
    getConnectionByBusiness: vi.fn(async () => null),
    upsertConnection: vi.fn(async (input) => ({
      id: 'conn-1',
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

  it('sandbox connect does not require user mobile and opens AuthLink (no SMS claim)', async () => {
    process.env.BASIQ_API_KEY = 'test-key';
    process.env.BASIQ_ENVIRONMENT = 'sandbox';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
          status: 200,
        });
      }
      if (String(url).endsWith('/users')) {
        const body = JSON.parse(String(init?.body || '{}')) as { mobile?: string };
        expect(body.mobile).toBe('+61400000000');
        return new Response(JSON.stringify({ id: 'basiq-user-1' }), { status: 201 });
      }
      if (String(url).includes('/auth_link')) {
        return new Response(
          JSON.stringify({
            links: { public: 'https://connect.basiq.io/hooli-test' },
            expiresAt: '2026-07-26T00:00:00Z',
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
      mobile: null,
    });

    expect(started.sandbox).toBe(true);
    expect(started.deliveryMode).toBe('open_auth_link');
    expect(started.authLinkUrl).toBe('https://connect.basiq.io/hooli-test');
    expect(started.authLinkMobile).toBeNull();
    expect(started.message.toLowerCase()).toContain('no sms');
    expect(started.message.toLowerCase()).not.toContain('sms sent');
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
