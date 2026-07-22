/**
 * Supabase Auth configuration must come from environment variables.
 * Do not remap hosts or inject hardcoded anon keys.
 *
 * Expected Auth project for Vercel Preview and Production:
 *   SUPABASE_URL=https://jsrxhisdjvwsufbqqtir.supabase.co
 *   SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   = matching public keys from the same jsrxhisdjvwsufbqqtir project
 */

export const EXPECTED_SUPABASE_AUTH_URL = 'https://jsrxhisdjvwsufbqqtir.supabase.co';

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
 * Validates URL shape only; host selection is entirely operator-controlled via Vercel env.
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
    // Ensure SUPABASE_URL is a valid absolute URL; do not rewrite hostname.
    hostname = new URL(configuredUrl).hostname;
  } catch {
    throw new SupabaseAuthConfigurationError(
      `SUPABASE_URL is not a valid URL: ${configuredUrl}. ` +
        `Set it to ${EXPECTED_SUPABASE_AUTH_URL} in Vercel Preview and Production.`,
    );
  }

  // Non-secret observability only — never log key material.
  console.info(
    JSON.stringify({
      event: 'auth.provider_configured',
      providerHost: hostname,
      expectedHost: new URL(EXPECTED_SUPABASE_AUTH_URL).hostname,
    }),
  );

  return {
    supabaseUrl: configuredUrl,
    ...(configuredKey ? { supabaseAnonKey: configuredKey } : {}),
  };
}
