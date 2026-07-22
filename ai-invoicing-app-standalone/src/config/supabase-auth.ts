/**
 * Supabase Auth configuration must come from environment variables.
 * Do not silently remap invalid hosts or inject hardcoded anon keys.
 */

export const ORPHANED_PREVIEW_AUTH_HOST = 'ntkctiqyvjcjokclkmll.supabase.co';
export const CANONICAL_SUPABASE_AUTH_URL = 'https://bmfpclozzmeekazmoaxw.supabase.co';

export type ResolvedSupabaseAuth = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  orphanedHostConfigured: boolean;
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
 * If the known-orphaned Preview Auth host is configured, log loudly and keep
 * the configured value (no remap). Set SUPABASE_AUTH_STRICT=1 to fail boot.
 */
export function resolveSupabaseAuthConfig(input: {
  supabaseUrl?: string | undefined;
  supabaseAnonKey?: string | undefined;
  strict?: boolean | undefined;
}): ResolvedSupabaseAuth {
  const configuredUrl = input.supabaseUrl?.trim();
  const configuredKey = input.supabaseAnonKey?.trim();
  const strict =
    input.strict === true ||
    String(process.env.SUPABASE_AUTH_STRICT || '').trim() === '1';

  if (!configuredUrl) {
    return {
      ...(configuredKey ? { supabaseAnonKey: configuredKey } : {}),
      orphanedHostConfigured: false,
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

  const orphanedHostConfigured = hostname === ORPHANED_PREVIEW_AUTH_HOST;
  if (orphanedHostConfigured) {
    const message =
      `SUPABASE_URL points at orphaned Auth host ${ORPHANED_PREVIEW_AUTH_HOST}. ` +
      `Set SUPABASE_URL=${CANONICAL_SUPABASE_AUTH_URL} and the matching public anon/publishable key ` +
      `in Vercel Preview and Production. Silent remapping is disabled.`;
    console.error(
      JSON.stringify({
        event: 'auth.orphaned_host_configured',
        host: ORPHANED_PREVIEW_AUTH_HOST,
        requiredUrl: CANONICAL_SUPABASE_AUTH_URL,
        strict,
        message,
      }),
    );
    if (strict) {
      throw new SupabaseAuthConfigurationError(message);
    }
  }

  return {
    supabaseUrl: configuredUrl,
    ...(configuredKey ? { supabaseAnonKey: configuredKey } : {}),
    orphanedHostConfigured,
  };
}
