import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/db/database.js';
import { encodeLogoReference, generateLogoConcepts } from '../../src/domain/logos/logo-studio.js';

describe('invoice branding snapshot', () => {
  it('freezes business branding at finalisation so later logo changes do not rewrite issued PDFs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'invoice-branding-'));
    const db = createDatabase(join(directory, 'test.db'));

    const concept = generateLogoConcepts({
      businessName: 'Frozen Brand Co',
      industry: 'Trade',
      style: 'corporate',
      primaryColor: '#0b3d5c',
      secondaryColor: '#dbeafe',
      count: 3,
    })[0]!;

    db.upsertBusinessProfile({
      companyName: 'Frozen Brand Co',
      address: '1 Snapshot Street',
      abnTaxId: '51824753556',
      email: 'hello@frozen.test',
      logoReference: encodeLogoReference(concept),
      primaryColor: concept.primaryColor,
      secondaryColor: concept.secondaryColor,
    });

    const customer = db.createCustomer({ displayName: 'Site Co' });
    const draft = db.createInvoiceDraft({
      customerId: customer.id,
      title: 'Scaffold hire',
      issueDate: '2026-07-18',
      dueDate: '2026-08-01',
      lineItems: [{ description: 'Labour', quantity: 1, unitPrice: 100, gstApplicable: true }],
    });

    const finalised = db.finaliseInvoice(draft.id);
    expect(finalised.status).toBe('Finalised');

    const frozen = db.getInvoiceBrandingSnapshot(finalised.id);
    expect(frozen?.companyName).toBe('Frozen Brand Co');
    expect(frozen?.logoReference).toContain('aleya-logo:v1:');

    const later = generateLogoConcepts({
      businessName: 'New Brand Co',
      industry: 'Trade',
      style: 'luxury',
      primaryColor: '#111111',
      secondaryColor: '#c9a227',
      count: 3,
    })[0]!;
    db.upsertBusinessProfile({
      companyName: 'New Brand Co',
      address: '1 Snapshot Street',
      abnTaxId: '51824753556',
      email: 'hello@frozen.test',
      logoReference: encodeLogoReference(later),
      primaryColor: later.primaryColor,
      secondaryColor: later.secondaryColor,
    });

    const stillFrozen = db.getInvoiceBrandingSnapshot(finalised.id);
    expect(stillFrozen?.companyName).toBe('Frozen Brand Co');
    expect(stillFrozen?.logoReference).not.toEqual(db.getBusinessProfile()?.logoReference);
  });
});
