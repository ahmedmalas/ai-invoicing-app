import { describe, expect, it } from 'vitest';

import { createBuildIdentity, formatBuildIdentityLog, INVOICE_UI_VERSION } from '../../src/build-identity.js';

describe('build identity', () => {
  it('exposes canonical invoice UI version without secrets', () => {
    expect(INVOICE_UI_VERSION).toBe('canonical-v3');
    const identity = createBuildIdentity({
      VERCEL_GIT_COMMIT_SHA: 'abc123commit',
      VERCEL_DEPLOYMENT_ID: 'dpl_test',
      DATABASE_URL: 'postgres://secret',
      SUPABASE_SERVICE_ROLE_KEY: 'secret-key',
    });
    expect(identity).toEqual({
      appCommitSha: 'abc123commit',
      appBuildId: 'dpl_test',
      invoiceUiVersion: 'canonical-v3',
      invoicePathway: 'canonical-state-payload-api',
    });
    const serialized = JSON.stringify(identity);
    expect(serialized).not.toMatch(/secret|postgres|SERVICE_ROLE/i);
    expect(formatBuildIdentityLog(identity)).toContain('canonical-v3');
    expect(formatBuildIdentityLog(identity)).toContain('canonical-state-payload-api');
  });

  it('falls back to local-dev markers when deploy env is absent', () => {
    const identity = createBuildIdentity({});
    expect(identity.appCommitSha).toBe('local-dev');
    expect(identity.appBuildId).toBe('local-dev');
  });
});
