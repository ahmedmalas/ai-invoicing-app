/**
 * Classify Basiq hosted Consent UI / Connections product errors.
 * "Connections not enabled" is a partner API-key enablement issue, not a
 * bad mobile number or invalid API key for /token.
 */

export const BASIQ_CONNECTIONS_NOT_ENABLED_CODE = 'BASIQ_CONNECTIONS_NOT_ENABLED';

export const BASIQ_CONNECTIONS_NOT_ENABLED_MESSAGE =
  'Your Basiq application is not enabled for bank connections. Enable Connections in Basiq or contact Basiq Support.';

export function isBasiqConnectionsNotEnabledError(input: {
  code?: string | null | undefined;
  title?: string | null | undefined;
  detail?: string | null | undefined;
  message?: string | null | undefined;
  reason?: string | null | undefined;
}): boolean {
  const blob = [input.code, input.title, input.detail, input.message, input.reason]
    .filter((part): part is string => Boolean(part && String(part).trim()))
    .join(' ')
    .toLowerCase();
  if (!blob) return false;
  if (blob.includes('connections not enabled')) return true;
  if (blob.includes('enabled for connections')) return true;
  if (blob.includes('connections_not_enabled')) return true;
  if (blob.includes('api key enabled for connections')) return true;
  // Hosted Consent UI shows title "Connections not enabled" with code access-denied.
  if (blob.includes('access-denied') && blob.includes('connection')) return true;
  return false;
}

export function classifyBasiqHostedError(input: {
  code?: string | null | undefined;
  title?: string | null | undefined;
  detail?: string | null | undefined;
  message?: string | null | undefined;
  error?: string | null | undefined;
  errorDescription?: string | null | undefined;
}): {
  connectionsNotEnabled: boolean;
  reason: string;
  message: string;
} {
  const code = input.code || input.error || null;
  const title = input.title || null;
  const detail = input.detail || input.errorDescription || input.message || null;
  if (
    isBasiqConnectionsNotEnabledError({
      code,
      title,
      detail,
      message: input.message,
      reason: input.error,
    })
  ) {
    return {
      connectionsNotEnabled: true,
      reason: 'connections_not_enabled',
      message: BASIQ_CONNECTIONS_NOT_ENABLED_MESSAGE,
    };
  }
  return {
    connectionsNotEnabled: false,
    reason: 'provider_error',
    message: 'Bank connection failed in Basiq. Check AuthLink and try again.',
  };
}
