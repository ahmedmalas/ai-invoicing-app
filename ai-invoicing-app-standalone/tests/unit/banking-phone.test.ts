import { describe, expect, it } from 'vitest';

import {
  BASIQ_SANDBOX_PLACEHOLDER_MOBILE,
  InvalidAustralianMobileError,
  normalizeAustralianMobileE164,
} from '../../src/domain/banking/phone.js';

describe('normalizeAustralianMobileE164', () => {
  it('normalises common AU mobile forms to +614XXXXXXXX', () => {
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

  it('rejects non-AU mobiles', () => {
    expect(() => normalizeAustralianMobileE164('+15551234567')).toThrow(
      InvalidAustralianMobileError,
    );
    expect(() => normalizeAustralianMobileE164('0212345678')).toThrow(
      InvalidAustralianMobileError,
    );
  });

  it('exposes a sandbox placeholder mobile', () => {
    expect(BASIQ_SANDBOX_PLACEHOLDER_MOBILE).toBe('+61400000000');
  });
});
