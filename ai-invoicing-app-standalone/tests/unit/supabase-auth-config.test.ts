import { describe, expect, it } from 'vitest';

import {
  EXPECTED_SUPABASE_AUTH_URL,
  SupabaseAuthConfigurationError,
  resolveSupabaseAuthConfig,
} from '../../src/config/supabase-auth.js';

describe('resolveSupabaseAuthConfig', () => {
  it('documents the intended jsrx Auth project URL', () => {
    expect(EXPECTED_SUPABASE_AUTH_URL).toBe('https://jsrxhisdjvwsufbqqtir.supabase.co');
  });

  it('accepts the production Auth host without remapping', () => {
    const resolved = resolveSupabaseAuthConfig({
      supabaseUrl: EXPECTED_SUPABASE_AUTH_URL,
      supabaseAnonKey: 'preview-anon-key',
    });
    expect(resolved).toEqual({
      supabaseUrl: EXPECTED_SUPABASE_AUTH_URL,
      supabaseAnonKey: 'preview-anon-key',
    });
  });

  it('leaves unrelated Auth hosts unchanged (no remap)', () => {
    const resolved = resolveSupabaseAuthConfig({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'keep-me',
    });
    expect(resolved).toEqual({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'keep-me',
    });
  });

  it('rejects malformed SUPABASE_URL', () => {
    expect(() =>
      resolveSupabaseAuthConfig({
        supabaseUrl: 'not-a-url',
      }),
    ).toThrow(SupabaseAuthConfigurationError);
  });

  it('handles missing URL', () => {
    expect(resolveSupabaseAuthConfig({})).toEqual({});
    expect(resolveSupabaseAuthConfig({ supabaseAnonKey: 'only-key' })).toEqual({
      supabaseAnonKey: 'only-key',
    });
  });
});
