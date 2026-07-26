/**
 * Australian mobile normalisation for Basiq AuthLink hosted 2FA.
 * Basiq expects E.164 (e.g. +614XXXXXXXX). The AuthLink `mobile` field
 * controls where the SMS verification code is sent after the AuthLink URL
 * is opened — not delivery of the AuthLink URL itself.
 *
 * Official Basiq docs: optional auth_link.mobile takes preference over the
 * User object's mobile for 2FA SMS. Creating a new AuthLink invalidates prior links.
 */

export class InvalidAustralianMobileError extends Error {
  readonly code = 'BANK_CONNECT_MOBILE_INVALID';
  constructor(message = 'Enter a valid Australian mobile number in the form +614XXXXXXXX.') {
    super(message);
    this.name = 'InvalidAustralianMobileError';
  }
}

/** Former sandbox placeholder — never use for AuthLink 2FA. */
export const BASIQ_SANDBOX_PLACEHOLDER_MOBILE = '+61400000000';

/** True for known Aleya/Basiq test placeholders that must not receive 2FA SMS. */
export function isBasiqPlaceholderMobile(e164: string | null | undefined): boolean {
  if (!e164) return false;
  const normalized = String(e164).trim();
  if (normalized === BASIQ_SANDBOX_PLACEHOLDER_MOBILE) return true;
  // Reject +614 followed by eight zeros (and close variants).
  return /^\+6140{8}$/.test(normalized);
}

/** Parse AU mobiles to E.164 without rejecting placeholders (diagnostics / masking). */
export function parseAustralianMobileE164(raw: string | null | undefined): string | null {
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

/** Normalise AU mobiles to E.164 (+614XXXXXXXX). Returns null for empty input. Rejects placeholders. */
export function normalizeAustralianMobileE164(raw: string | null | undefined): string | null {
  const e164 = parseAustralianMobileE164(raw);
  if (!e164) return null;
  if (isBasiqPlaceholderMobile(e164)) {
    throw new InvalidAustralianMobileError(
      'That mobile looks like a test placeholder. Enter a real Australian mobile (+614XXXXXXXX) for AuthLink SMS verification.',
    );
  }
  return e164;
}

/**
 * Mask an AU E.164 mobile for UI/logs. Never returns the full number.
 * Example: +61412345678 → +614••••5678
 */
export function maskAustralianMobileE164(raw: string | null | undefined): string | null {
  let e164: string | null = null;
  try {
    e164 = parseAustralianMobileE164(raw);
  } catch {
    return null;
  }
  if (!e164) return null;
  const national = e164.slice(3); // 4XXXXXXXX
  return `+614••••${national.slice(-4)}`;
}

/** Last 3 digits only — for correlating with Basiq UI "ending in xxx" without full number. */
export function mobileEndingDigits(raw: string | null | undefined): string | null {
  try {
    const e164 = parseAustralianMobileE164(raw);
    return e164 ? e164.slice(-3) : null;
  } catch {
    return null;
  }
}
