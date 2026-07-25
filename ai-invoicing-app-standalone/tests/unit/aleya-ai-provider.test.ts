import { afterEach, describe, expect, it } from 'vitest';

import {
  deterministicPlanAllowed,
  getProviderStatus,
  providerConfigured,
} from '../../src/ai/provider.js';

const ORIGINAL = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.ALEYA_AI_ALLOW_UNCONFIGURED;
  delete process.env.ALEYA_AI_ALLOW_DETERMINISTIC_PLAN;
});

describe('Aleya AI provider status', () => {
  it('is false when no gateway auth is present', () => {
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    expect(providerConfigured()).toBe(false);
    expect(getProviderStatus().authMethod).toBe('none');
  });

  it('does not treat ALEYA_AI_ALLOW_UNCONFIGURED as a real provider', () => {
    process.env.ALEYA_AI_ALLOW_UNCONFIGURED = '1';
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    expect(providerConfigured()).toBe(false);
  });

  it('is true with AI_GATEWAY_API_KEY', () => {
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    expect(providerConfigured()).toBe(true);
    expect(getProviderStatus().authMethod).toBe('api-key');
  });

  it('is true on Vercel runtime via OIDC', () => {
    process.env.VERCEL = '1';
    expect(providerConfigured()).toBe(true);
    expect(getProviderStatus().authMethod).toBe('oidc');
    expect(getProviderStatus().provider).toBe('vercel-ai-gateway');
  });

  it('gates deterministic plans outside test harness', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.ALEYA_AI_ALLOW_DETERMINISTIC_PLAN;
    expect(deterministicPlanAllowed()).toBe(false);
    process.env.ALEYA_AI_ALLOW_DETERMINISTIC_PLAN = '1';
    expect(deterministicPlanAllowed()).toBe(true);
    process.env.NODE_ENV = prev;
  });
});
