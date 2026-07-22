/**
 * Preview deployments were pointed at an orphaned Supabase Auth project
 * (`ntkctiqyvjcjokclkmll`) that is not in the team org and requires email
 * verification we cannot complete from CI. Remap that host to the canonical
 * production Auth project so preview sign-in works with known test accounts.
 *
 * The anon/publishable key below is the public client key for
 * ai-invoicing-app-production — safe to ship (designed for browser use).
 */
export const ORPHANED_PREVIEW_AUTH_HOST = 'ntkctiqyvjcjokclkmll.supabase.co';
export const CANONICAL_SUPABASE_AUTH_URL = 'https://bmfpclozzmeekazmoaxw.supabase.co';
export const CANONICAL_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtZnBjbG96em1lZWthem1vYXh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Njc4NzMsImV4cCI6MjA5OTI0Mzg3M30.yCenCK5G1YrKnqCKHW58n-U1nPt8L3c4koOGHrD5bQk';

export type ResolvedSupabaseAuth = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  remappedFromOrphanedPreviewHost: boolean;
};

export function resolveSupabaseAuthConfig(input: {
  supabaseUrl?: string | undefined;
  supabaseAnonKey?: string | undefined;
}): ResolvedSupabaseAuth {
  const configuredUrl = input.supabaseUrl?.trim();
  if (!configuredUrl) {
    return {
      ...(input.supabaseAnonKey !== undefined ? { supabaseAnonKey: input.supabaseAnonKey } : {}),
      remappedFromOrphanedPreviewHost: false,
    };
  }

  let hostname = '';
  try {
    hostname = new URL(configuredUrl).hostname;
  } catch {
    return {
      supabaseUrl: configuredUrl,
      ...(input.supabaseAnonKey !== undefined ? { supabaseAnonKey: input.supabaseAnonKey } : {}),
      remappedFromOrphanedPreviewHost: false,
    };
  }

  if (hostname === ORPHANED_PREVIEW_AUTH_HOST) {
    console.warn(
      JSON.stringify({
        event: 'auth.provider_remapped',
        fromHost: ORPHANED_PREVIEW_AUTH_HOST,
        toHost: new URL(CANONICAL_SUPABASE_AUTH_URL).hostname,
        reason: 'orphaned_preview_auth_project',
      }),
    );
    return {
      supabaseUrl: CANONICAL_SUPABASE_AUTH_URL,
      supabaseAnonKey: CANONICAL_SUPABASE_ANON_KEY,
      remappedFromOrphanedPreviewHost: true,
    };
  }

  return {
    supabaseUrl: configuredUrl,
    ...(input.supabaseAnonKey !== undefined ? { supabaseAnonKey: input.supabaseAnonKey } : {}),
    remappedFromOrphanedPreviewHost: false,
  };
}
