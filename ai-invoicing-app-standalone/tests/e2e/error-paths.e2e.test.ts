import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildApp } from '../../src/app.js';

describe('slice 1 error paths e2e', () => {
  it('returns expected not-found and validation-safe responses', async () => {
    const app = await buildApp({ dbPath: ':memory:' });

    const profileNotFound = await app.inject({
      method: 'GET',
      url: '/business-profile',
    });
    expect(profileNotFound.statusCode).toBe(404);

    const preferenceNotFound = await app.inject({
      method: 'GET',
      url: '/preferences/invoice',
    });
    expect(preferenceNotFound.statusCode).toBe(404);

    const customerNotFound = await app.inject({
      method: 'GET',
      url: '/customers/550e8400-e29b-41d4-a716-446655440000',
    });
    expect(customerNotFound.statusCode).toBe(404);

    const customerInvalidId = await app.inject({
      method: 'GET',
      url: '/customers/not-a-uuid',
    });
    expect(customerInvalidId.statusCode).toBe(400);

    const invoiceNotFound = await app.inject({
      method: 'GET',
      url: '/invoices/550e8400-e29b-41d4-a716-446655440001',
    });
    expect(invoiceNotFound.statusCode).toBe(404);

    const invoiceInvalidId = await app.inject({
      method: 'GET',
      url: '/invoices/not-a-uuid',
    });
    expect(invoiceInvalidId.statusCode).toBe(400);

    const pdfNotFound = await app.inject({
      method: 'GET',
      url: '/invoices/550e8400-e29b-41d4-a716-446655440002/pdf',
    });
    expect(pdfNotFound.statusCode).toBe(404);

    const createProfile = await app.inject({
      method: 'POST',
      url: '/business-profile',
      payload: {
        companyName: 'Logo Test Pty Ltd',
        primaryColor: '#123456',
        secondaryColor: '#654321',
      },
    });
    expect(createProfile.statusCode).toBe(200);

    const logoPlaceholder = await app.inject({
      method: 'POST',
      url: '/business-profile/logo-placeholder',
      payload: { fileName: 'logo.svg' },
    });
    expect(logoPlaceholder.statusCode).toBe(200);
    const parsed = z
      .object({
        profile: z.object({ logoReference: z.string() }),
      })
      .parse(logoPlaceholder.json());
    expect(parsed.profile.logoReference).toBe('placeholder://logo.svg');

    await app.close();
  });
});
