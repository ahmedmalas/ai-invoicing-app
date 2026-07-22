/**
 * Supabase Auth configuration must come from environment variables.
 * Do not silently remap invalid hosts — misconfigured Preview/Production
 * Auth must fail loudly so operators fix Vercel env instead of shipping
 * hardcoded credentials.
 */

export const ORPHANED_PREVIEW_AUTH_HOST = 'ntkctiqyvjcjokclkmll.supabase.co';
export const CANONICAL_SUPABASE_AUTH_URL = 'https://bmfpclozzmeekazmoaxw.supabase.co';

export type ResolvedSupabaseAuth = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

export class SupabaseAuthConfigurationError extends Error {
  readonly code = 'AUTH_CONFIGURATION_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'SupabaseAuthConfigurationError';
  }
}

/**
 * Resolve Auth URL/key from env without rewriting them.
 * Throws if the known-orphaned Preview Auth host is still configured.
 */
export function resolveSupabaseAuthConfig(input: {
  supabaseUrl?: string | undefined;
  supabaseAnonKey?: string | undefined;
}): ResolvedSupabaseAuth {
  const configuredUrl = input.supabaseUrl?.trim();
  const configuredKey = input.supabaseAnonKey?.trim();

  if (!configuredUrl) {
    return {
      ...(configuredKey ? { supabaseAnonKey: configuredKey } : {}),
    };
  }

  let hostname = '';
  try {
    hostname = new URL(configuredUrl).hostname;
  } catch {
    throw new SupabaseAuthConfigurationError(
      `SUPABASE_URL is not a valid URL: ${configuredUrl}. Set it to ${CANONICAL_SUPABASE_AUTH_URL} in Vercel Preview and Production.`,
    );
  }

  if (hostname === ORPHANED_PREVIEW_AUTH_HOST) {
    throw new SupabaseAuthConfigurationError(
      `SUPABASE_URL points at orphaned Auth host ${ORPHANED_PREVIEW_AUTH_HOST}. ` +
        `Set SUPABASE_URL=${CANONICAL_SUPABASE_AUTH_URL} and the matching public anon/publishable key ` +
        `in Vercel Preview and Production environment variables. Silent remapping is disabled.`,
    );
  }

  return {
    supabaseUrl: configuredUrl,
    ...(configuredKey ? { supabaseAnonKey: configuredKey } : {}),
  };
}
