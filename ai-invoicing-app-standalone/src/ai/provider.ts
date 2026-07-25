/**
 * Server-side model provider resolution for Aleya AI.
 * Credentials never leave the server process.
 */

export const ALEYA_DEFAULT_MODEL = process.env.ALEYA_AI_MODEL || 'openai/gpt-5.4';

export type ProviderAuthMethod = 'api-key' | 'oidc' | 'none';

export interface ProviderStatus {
  providerConfigured: boolean;
  authMethod: ProviderAuthMethod;
  model: string;
  provider: 'vercel-ai-gateway';
  /** True only when deterministic ALEYA_PLAN harness is explicitly enabled. */
  deterministicPlanAllowed: boolean;
}

export function isVercelRuntime(): boolean {
  return process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);
}

/**
 * Whether the AI Gateway auth material is available for this runtime.
 *
 * - `AI_GATEWAY_API_KEY` — static key (CI / non-Vercel)
 * - `VERCEL_OIDC_TOKEN` — from `vercel env pull` locally
 * - Vercel runtime — OIDC via `@vercel/oidc` (`x-vercel-oidc-token` request context)
 *
 * Never treats `ALEYA_AI_ALLOW_UNCONFIGURED` as a real provider.
 */
export function getProviderStatus(): ProviderStatus {
  const model = ALEYA_DEFAULT_MODEL;
  const deterministicPlanAllowed =
    process.env.ALEYA_AI_ALLOW_DETERMINISTIC_PLAN === '1' || process.env.NODE_ENV === 'test';

  if (process.env.AI_GATEWAY_API_KEY) {
    return {
      providerConfigured: true,
      authMethod: 'api-key',
      model,
      provider: 'vercel-ai-gateway',
      deterministicPlanAllowed,
    };
  }

  if (process.env.VERCEL_OIDC_TOKEN || isVercelRuntime()) {
    return {
      providerConfigured: true,
      authMethod: 'oidc',
      model,
      provider: 'vercel-ai-gateway',
      deterministicPlanAllowed,
    };
  }

  return {
    providerConfigured: false,
    authMethod: 'none',
    model,
    provider: 'vercel-ai-gateway',
    deterministicPlanAllowed,
  };
}

export function providerConfigured(): boolean {
  return getProviderStatus().providerConfigured;
}

export function deterministicPlanAllowed(): boolean {
  return getProviderStatus().deterministicPlanAllowed;
}

/** Human-readable provider failure without leaking credentials. */
export function formatProviderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes('credit') ||
    lower.includes('balance') ||
    lower.includes('payment') ||
    lower.includes('billing')
  ) {
    return `AI Gateway billing/credits error: ${message}`;
  }
  if (
    lower.includes('auth') ||
    lower.includes('api key') ||
    lower.includes('oidc') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden')
  ) {
    return `AI Gateway authentication failed: ${message}`;
  }
  if (lower.includes('model') || lower.includes('not found') || lower.includes('unavailable')) {
    return `Model provider error: ${message}`;
  }
  return `Model provider failure: ${message}`;
}
