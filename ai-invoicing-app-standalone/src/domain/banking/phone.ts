/**
 * Australian mobile normalisation for Basiq AuthLink 2FA.
 * Basiq expects E.164 (e.g. +614XXXXXXXX). AuthLink mobile is for hosted
 * 2FA after the AuthLink URL is opened — not for SMS-delivering the URL.
 */

export class InvalidAustralianMobileError extends Error {
  readonly code = 'BANK_CONNECT_MOBILE_INVALID';
  constructor(message = 'Enter a valid Australian mobile number in the form +614XXXXXXXX.') {
    super(message);
    this.name = 'InvalidAustralianMobileError';
  }
}

/** Normalise AU mobiles to E.164 (+614XXXXXXXX). Returns null for empty input. */
export function normalizeAustralianMobileE164(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/[^\d+]/g, '');
  let national: string | null = null;

  if (digits.startsWith('+61')) {
    national = digits.slice(3);
  } else if (digits.startsWith('61') && digits.length >= 11) {
    national = digits.slice(2);
  } else if (digits.startsWith('0')) {
    national = digits.slice(1);
  } else if (/^4\d{8}$/.test(digits)) {
    national = digits;
  } else {
    throw new InvalidAustralianMobileError();
  }

  national = national.replace(/\D/g, '');
  if (!/^4\d{8}$/.test(national)) {
    throw new InvalidAustralianMobileError();
  }
  return `+61${national}`;
}

/** Sandbox placeholder accepted by Basiq when creating users / auth_link for test flows. */
export const BASIQ_SANDBOX_PLACEHOLDER_MOBILE = '+61400000000';
