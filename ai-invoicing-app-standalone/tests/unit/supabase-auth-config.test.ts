import { describe, expect, it } from 'vitest';

import {
  CANONICAL_SUPABASE_AUTH_URL,
  ORPHANED_PREVIEW_AUTH_HOST,
  SupabaseAuthConfigurationError,
  resolveSupabaseAuthConfig,
} from '../../src/config/supabase-auth.js';

describe('resolveSupabaseAuthConfig', () => {
  it('rejects the orphaned preview Auth host instead of remapping it', () => {
    expect(() =>
      resolveSupabaseAuthConfig({
        supabaseUrl: `https://${ORPHANED_PREVIEW_AUTH_HOST}`,
        supabaseAnonKey: 'preview-orphan-anon-key',
      }),
    ).toThrow(SupabaseAuthConfigurationError);
    expect(() =>
      resolveSupabaseAuthConfig({
        supabaseUrl: `https://${ORPHANED_PREVIEW_AUTH_HOST}`,
      }),
    ).toThrow(/Silent remapping is disabled/);
  });

  it('leaves unrelated Auth hosts unchanged', () => {
    const resolved = resolveSupabaseAuthConfig({
      supabaseUrl: CANONICAL_SUPABASE_AUTH_URL,
      supabaseAnonKey: 'keep-me',
    });
    expect(resolved).toEqual({
      supabaseUrl: CANONICAL_SUPABASE_AUTH_URL,
      supabaseAnonKey: 'keep-me',
    });
  });

  it('handles missing URL', () => {
    expect(resolveSupabaseAuthConfig({})).toEqual({});
    expect(resolveSupabaseAuthConfig({ supabaseAnonKey: 'only-key' })).toEqual({
      supabaseAnonKey: 'only-key',
    });
  });
});
