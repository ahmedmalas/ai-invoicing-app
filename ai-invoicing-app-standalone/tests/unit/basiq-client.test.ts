import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkBasiqHealth,
  getBasiqAccessToken,
  resetBasiqTokenCacheForTests,
  verifyBasiqWebhookSignature,
} from '../../src/services/basiq-client.js';

describe('basiq client', () => {
  afterEach(() => {
    resetBasiqTokenCacheForTests();
    vi.unstubAllGlobals();
    delete process.env.BASIQ_API_KEY;
    delete process.env.BASIQ_WEBHOOK_SECRET;
    delete process.env.BASIQ_WEBHOOK_ALLOW_UNSIGNED;
  });

  it('reports not_configured when API key missing', async () => {
    const health = await checkBasiqHealth();
    expect(health.configured).toBe(false);
    expect(health.errorCategory).toBe('not_configured');
    expect(JSON.stringify(health).toLowerCase()).not.toContain('basiq_api_key');
  });

  it('caches access token until near expiry', async () => {
    process.env.BASIQ_API_KEY = 'test-key-value-not-for-logging';
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls += 1;
        if (String(url).endsWith('/token')) {
          return new Response(
            JSON.stringify({ access_token: 'tok-abc', expires_in: 3600 }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const a = await getBasiqAccessToken();
    const b = await getBasiqAccessToken();
    expect(a).toBe('tok-abc');
    expect(b).toBe('tok-abc');
    expect(calls).toBe(1);
  });

  it('health check never returns token material', async () => {
    process.env.BASIQ_API_KEY = 'secret-key-should-not-leak';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/token')) {
          return new Response(
            JSON.stringify({ access_token: 'tok-secret', expires_in: 3600 }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }),
    );
    const health = await checkBasiqHealth();
    expect(health.configured).toBe(true);
    expect(health.authenticated).toBe(true);
    const serialized = JSON.stringify(health);
    expect(serialized).not.toContain('secret-key');
    expect(serialized).not.toContain('tok-secret');
  });

  it('validates webhook signatures', () => {
    process.env.BASIQ_WEBHOOK_SECRET = 'whsec';
    const body = '{"type":"connection.updated"}';
    const sig = createHash('sha256').update(`whsec.${body}`).digest('hex');
    expect(verifyBasiqWebhookSignature(body, sig)).toBe(true);
    expect(verifyBasiqWebhookSignature(body, 'bad')).toBe(false);
  });

  it('maps Basiq /token HTTP 404 to auth_failed with provider detail', async () => {
    process.env.BASIQ_API_KEY = 'invalid-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/token')) {
          return new Response(
            JSON.stringify({
              data: [
                {
                  title: 'Unable to authenticate',
                  detail: 'Please, check your API key',
                  code: 'parameter-not-valid',
                },
              ],
            }),
            { status: 404 },
          );
        }
        return new Response('{}', { status: 500 });
      }),
    );
    const health = await checkBasiqHealth();
    expect(health.configured).toBe(true);
    expect(health.authenticated).toBe(false);
    expect(health.errorCategory).toBe('auth_failed');
    await expect(getBasiqAccessToken()).rejects.toMatchObject({
      category: 'auth_failed',
      providerDetail: expect.stringContaining('Unable to authenticate'),
    });
  });
});
