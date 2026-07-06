import { describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/db/database.js';

describe('timeline canonical events for non-invoice entities', () => {
  it('emits canonical keys for customer, business profile, and preferences', () => {
    const db = createDatabase(':memory:');

    const customer = db.createCustomer({
      displayName: 'Canonical Customer',
      email: 'canonical@example.test',
    });
    db.updateCustomer(customer.id, {
      displayName: 'Canonical Customer Updated',
      email: 'canonical@example.test',
    });

    db.upsertBusinessProfile({
      companyName: 'Canonical Business Pty Ltd',
      primaryColor: '#123456',
      secondaryColor: '#654321',
    });

    db.upsertPreference('invoice', { defaultTerms: '14 days' });

    const customerTimeline = db.getTimelineForEntity('customer', customer.id);
    expect(customerTimeline).toHaveLength(2);
    expect(
      customerTimeline.map((event) => (event as { eventKey: string }).eventKey),
    ).toEqual(['customer.created', 'customer.updated']);

    const profileTimeline = db.getTimelineForEntity('business_profile', 'business-profile');
    expect(profileTimeline).toHaveLength(1);
    expect((profileTimeline[0] as { eventKey: string }).eventKey).toBe('business_profile.updated');

    const preferenceTimeline = db.getTimelineForEntity('preference', 'invoice');
    expect(preferenceTimeline).toHaveLength(1);
    expect((preferenceTimeline[0] as { eventKey: string }).eventKey).toBe('preferences.updated');

    db.close();
  });
});
