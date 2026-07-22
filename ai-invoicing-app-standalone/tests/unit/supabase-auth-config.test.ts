import { describe, expect, it } from 'vitest';

import {
  CANONICAL_SUPABASE_ANON_KEY,
  CANONICAL_SUPABASE_AUTH_URL,
  ORPHANED_PREVIEW_AUTH_HOST,
  resolveSupabaseAuthConfig,
} from '../../src/config/supabase-auth.js';

describe('resolveSupabaseAuthConfig', () => {
  it('remaps the orphaned preview Auth host to the canonical production project', () => {
    const resolved = resolveSupabaseAuthConfig({
      supabaseUrl: `https://${ORPHANED_PREVIEW_AUTH_HOST}`,
      supabaseAnonKey: 'preview-orphan-anon-key',
    });
    expect(resolved).toEqual({
      supabaseUrl: CANONICAL_SUPABASE_AUTH_URL,
      supabaseAnonKey: CANONICAL_SUPABASE_ANON_KEY,
      remappedFromOrphanedPreviewHost: true,
    });
  });

  it('leaves unrelated Auth hosts unchanged', () => {
    const resolved = resolveSupabaseAuthConfig({
      supabaseUrl: 'https://bmfpclozzmeekazmoaxw.supabase.co',
      supabaseAnonKey: 'keep-me',
    });
    expect(resolved).toEqual({
      supabaseUrl: 'https://bmfpclozzmeekazmoaxw.supabase.co',
      supabaseAnonKey: 'keep-me',
      remappedFromOrphanedPreviewHost: false,
    });
  });

  it('handles missing URL', () => {
    expect(resolveSupabaseAuthConfig({})).toEqual({
      remappedFromOrphanedPreviewHost: false,
    });
  });
});
