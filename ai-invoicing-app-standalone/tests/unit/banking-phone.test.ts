import { describe, expect, it } from 'vitest';

import {
  BASIQ_SANDBOX_PLACEHOLDER_MOBILE,
  InvalidAustralianMobileError,
  isBasiqPlaceholderMobile,
  maskAustralianMobileE164,
  mobileEndingDigits,
  normalizeAustralianMobileE164,
} from '../../src/domain/banking/phone.js';

describe('normalizeAustralianMobileE164', () => {
  it('normalises common AU forms to E.164', () => {
    expect(normalizeAustralianMobileE164('+61412345678')).toBe('+61412345678');
    expect(normalizeAustralianMobileE164('0412 345 678')).toBe('+61412345678');
    expect(normalizeAustralianMobileE164('61412345678')).toBe('+61412345678');
    expect(normalizeAustralianMobileE164('412345678')).toBe('+61412345678');
  });

  it('returns null for empty input', () => {
    expect(normalizeAustralianMobileE164('')).toBeNull();
    expect(normalizeAustralianMobileE164(null)).toBeNull();
    expect(normalizeAustralianMobileE164(undefined)).toBeNull();
  });

  it('rejects non-AU and landline numbers', () => {
    expect(() => normalizeAustralianMobileE164('+15551234567')).toThrow(
      InvalidAustralianMobileError,
    );
    expect(() => normalizeAustralianMobileE164('0212345678')).toThrow(
      InvalidAustralianMobileError,
    );
  });

  it('rejects the sandbox placeholder mobile', () => {
    expect(isBasiqPlaceholderMobile(BASIQ_SANDBOX_PLACEHOLDER_MOBILE)).toBe(true);
    expect(() => normalizeAustralianMobileE164(BASIQ_SANDBOX_PLACEHOLDER_MOBILE)).toThrow(
      InvalidAustralianMobileError,
    );
  });
});

describe('maskAustralianMobileE164', () => {
  it('masks without exposing the full number', () => {
    expect(maskAustralianMobileE164('+61412345678')).toBe('+614••••5678');
    expect(maskAustralianMobileE164(BASIQ_SANDBOX_PLACEHOLDER_MOBILE)).toBe('+614••••0000');
    expect(mobileEndingDigits(BASIQ_SANDBOX_PLACEHOLDER_MOBILE)).toBe('000');
  });
});
