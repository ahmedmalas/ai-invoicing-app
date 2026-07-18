/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { decodeLogoReference } from '../../src/domain/logos/logo-studio.js';
import { extractPdfText } from '../helpers/pdf-text.js';

describe('logo studio integration', () => {
  it('generates concepts, saves the selected logo, and brands invoice PDFs', async () => {
    const app = await buildApp({
      dbPath: ':memory:',
      nodeEnv: 'test',
      authBypassForTesting: true,
      serveFrontend: true,
    });

    const generated = await app.inject({
      method: 'POST',
      url: '/api/logo-studio/generate',
      payload: {
        businessName: 'Harbour Scaffold',
        tagline: 'Safe height work',
        industry: 'Scaffolding',
        style: 'corporate',
        primaryColor: '#0b3d5c',
        secondaryColor: '#dbeafe',
        iconIdeas: 'building',
        count: 4,
      },
    });
    expect(generated.statusCode).toBe(200);
    const concepts = generated.json().concepts;
    expect(concepts.length).toBe(4);
    expect(concepts[0].svg).toContain('<svg');

    const selected = await app.inject({
      method: 'POST',
      url: '/api/logo-studio/select',
      payload: {
        concept: {
          id: concepts[0].id,
          businessName: concepts[0].businessName,
          tagline: concepts[0].tagline,
          industry: concepts[0].industry,
          style: concepts[0].style,
          primaryColor: concepts[0].primaryColor,
          secondaryColor: concepts[0].secondaryColor,
          iconIdea: concepts[0].iconIdea,
          layout: concepts[0].layout,
          markShape: concepts[0].markShape,
          monogram: concepts[0].monogram,
          seed: concepts[0].seed,
        },
      },
    });
    expect(selected.statusCode).toBe(200);
    const profile = selected.json().profile;
    expect(decodeLogoReference(profile.logoReference)?.businessName).toBe('Harbour Scaffold');

    await app.inject({
      method: 'POST',
      url: '/api/business-profile',
      payload: {
        companyName: 'Harbour Scaffold',
        address: '12 Pier Road, Sydney NSW',
        abnTaxId: '51824753556',
        email: 'hello@harbour.test',
        phone: '0400000000',
        logoReference: profile.logoReference,
        primaryColor: profile.primaryColor,
        secondaryColor: profile.secondaryColor,
      },
    });

    const active = await app.inject({ method: 'GET', url: '/api/logo-studio/active' });
    expect(active.statusCode).toBe(200);

    const logoSvg = await app.inject({ method: 'GET', url: '/api/business-profile/logo.svg' });
    expect(logoSvg.statusCode).toBe(200);
    expect(logoSvg.headers['content-type']).toContain('image/svg+xml');
    expect(logoSvg.body).toContain('Harbour Scaffold');

    const customer = await app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: { displayName: 'Site Co' },
    });
    const invoice = await app.inject({
      method: 'POST',
      url: '/api/invoices',
      payload: {
        customerId: customer.json().id,
        title: 'Tower hire',
        issueDate: '2026-07-18',
        dueDate: '2026-08-01',
        lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
      },
    });
    const pdf = await app.inject({ method: 'GET', url: `/api/invoices/${invoice.json().id}/pdf` });
    expect(pdf.statusCode).toBe(200);
    const text = extractPdfText(Buffer.from(pdf.rawPayload));
    expect(text).toContain('Harbour Scaffold');
    expect(text).toContain(concepts[0].monogram);

    const ui = await app.inject({ method: 'GET', url: '/assets/logo-studio-ui.js' });
    expect(ui.statusCode).toBe(200);
    expect(ui.body).toContain('buildLogoCreatorPageHtml');
    const shell = await app.inject({ method: 'GET', url: '/logo-creator' });
    expect(shell.statusCode).toBe(200);

    await app.close();
  });
});
