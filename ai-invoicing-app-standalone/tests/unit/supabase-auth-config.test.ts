import { afterEach, describe, expect, it } from 'vitest';

import {
  CANONICAL_SUPABASE_AUTH_URL,
  ORPHANED_PREVIEW_AUTH_HOST,
  SupabaseAuthConfigurationError,
  resolveSupabaseAuthConfig,
} from '../../src/config/supabase-auth.js';

const originalStrict = process.env.SUPABASE_AUTH_STRICT;

afterEach(() => {
  if (originalStrict === undefined) delete process.env.SUPABASE_AUTH_STRICT;
  else process.env.SUPABASE_AUTH_STRICT = originalStrict;
});

describe('resolveSupabaseAuthConfig', () => {
  it('does not remap the orphaned preview Auth host', () => {
    const resolved = resolveSupabaseAuthConfig({
      supabaseUrl: `https://${ORPHANED_PREVIEW_AUTH_HOST}`,
      supabaseAnonKey: 'preview-orphan-anon-key',
      strict: false,
    });
    expect(resolved).toEqual({
      supabaseUrl: `https://${ORPHANED_PREVIEW_AUTH_HOST}`,
      supabaseAnonKey: 'preview-orphan-anon-key',
      orphanedHostConfigured: true,
    });
  });

  it('fails boot when SUPABASE_AUTH_STRICT=1 and orphaned host is configured', () => {
    process.env.SUPABASE_AUTH_STRICT = '1';
    expect(() =>
      resolveSupabaseAuthConfig({
        supabaseUrl: `https://${ORPHANED_PREVIEW_AUTH_HOST}`,
      }),
    ).toThrow(SupabaseAuthConfigurationError);
  });

  it('leaves unrelated Auth hosts unchanged', () => {
    const resolved = resolveSupabaseAuthConfig({
      supabaseUrl: CANONICAL_SUPABASE_AUTH_URL,
      supabaseAnonKey: 'keep-me',
    });
    expect(resolved).toEqual({
      supabaseUrl: CANONICAL_SUPABASE_AUTH_URL,
      supabaseAnonKey: 'keep-me',
      orphanedHostConfigured: false,
    });
  });

  it('handles missing URL', () => {
    expect(resolveSupabaseAuthConfig({})).toEqual({ orphanedHostConfigured: false });
    expect(resolveSupabaseAuthConfig({ supabaseAnonKey: 'only-key' })).toEqual({
      supabaseAnonKey: 'only-key',
      orphanedHostConfigured: false,
    });
  });
});
