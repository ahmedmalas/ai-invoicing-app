import { describe, expect, it } from 'vitest';

import {
  businessProfileReadinessMessage,
  isBusinessProfileReady,
} from '../../public/business-profile-readiness.js';

describe('business profile readiness', () => {
  it('requires both company name and address before PDFs unlock', () => {
    expect(isBusinessProfileReady(null)).toBe(false);
    expect(isBusinessProfileReady({ companyName: 'Aleya Hire' })).toBe(false);
    expect(isBusinessProfileReady({ address: '1 Hire Rd' })).toBe(false);
    expect(
      isBusinessProfileReady({
        companyName: 'Aleya Hire',
        address: '1 Hire Rd, Sydney NSW',
      }),
    ).toBe(true);
  });

  it('explains why PDF downloads remain paused', () => {
    expect(businessProfileReadinessMessage({})).toContain('business name and address');
    expect(
      businessProfileReadinessMessage({
        companyName: 'Aleya Hire',
        address: '1 Hire Rd',
      }),
    ).toContain('Document identity configured');
  });
});
