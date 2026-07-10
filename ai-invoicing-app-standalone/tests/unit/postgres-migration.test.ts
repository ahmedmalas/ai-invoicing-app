import { describe, expect, it } from 'vitest';

import {
  PLATFORM_SNAPSHOT_TABLES,
  PLATFORM_SNAPSHOT_VERSION,
  type PlatformSnapshot,
} from '../../src/db/database.js';
import {
  PostgresMigrationError,
  migrateToPostgres,
  validateMigrationSnapshot,
  verifyMigratedSnapshot,
} from '../../src/migration/postgres-migration.js';
import { parseMigrationArguments } from '../../src/scripts/migrate-postgres.js';

function snapshot(): PlatformSnapshot {
  const entities = Object.fromEntries(
    PLATFORM_SNAPSHOT_TABLES.map((table) => [table, []]),
  ) as unknown as PlatformSnapshot['entities'];
  entities.customers.push({ id: 'customer-1' });
  entities.invoices.push({ id: 'invoice-1', customer_id: 'customer-1' });
  entities.credit_notes.push({
    id: 'credit-1',
    linked_invoice_id: 'invoice-1',
    customer_id: 'customer-1',
  });
  entities.customer_payments.push({ id: 'payment-1', customer_id: 'customer-1' });
  entities.payment_allocations.push({
    id: 'allocation-1',
    payment_id: 'payment-1',
    invoice_id: 'invoice-1',
  });
  entities.timeline_events.push({
    id: 'timeline-1',
    entity_type: 'invoice',
    entity_id: 'invoice-1',
  });
  return {
    version: PLATFORM_SNAPSHOT_VERSION,
    products: [],
    derived: { customerStatements: [] },
    entities,
  };
}

function copy(value: PlatformSnapshot): PlatformSnapshot {
  return structuredClone(value);
}

describe('PostgreSQL migration snapshot verification', () => {
  it('validates the version and complete platform table shape', () => {
    expect(validateMigrationSnapshot(snapshot())).toBeDefined();
    expect(() => validateMigrationSnapshot({ ...snapshot(), version: 999 })).toThrow(
      'Snapshot shape or version is invalid.',
    );

    const incomplete = snapshot() as unknown as {
      entities: Partial<PlatformSnapshot['entities']>;
    };
    delete incomplete.entities.invoices;
    expect(() => validateMigrationSnapshot(incomplete)).toThrow(
      'Snapshot is missing platform table "invoices".',
    );
  });

  it('verifies every table count and key relationship edge', () => {
    const source = snapshot();
    const result = verifyMigratedSnapshot(source, copy(source));

    expect(Object.keys(result.tableCounts)).toHaveLength(PLATFORM_SNAPSHOT_TABLES.length);
    expect(result.tableCounts.invoices).toBe(1);
    expect(result.relationshipCount).toBeGreaterThan(0);
    expect(result.timelineReferenceCount).toBe(1);

    const countMismatch = copy(source);
    countMismatch.entities.credit_notes.pop();
    expect(() => verifyMigratedSnapshot(source, countMismatch)).toThrow(
      'Table count verification failed for "credit_notes"',
    );

    const relationshipMismatch = copy(source);
    relationshipMismatch.entities.payment_allocations[0]!.invoice_id = 'invoice-other';
    expect(() => verifyMigratedSnapshot(source, relationshipMismatch)).toThrow(
      'Relationship verification failed for "payment allocation/invoice".',
    );
  });

  it('detects dangling source relationships and changed timeline references', () => {
    const dangling = snapshot();
    dangling.entities.invoices[0]!.customer_id = 'missing-customer';
    expect(() => verifyMigratedSnapshot(dangling, copy(dangling))).toThrow(
      'Relationship verification failed for "invoice/customer".',
    );

    const source = snapshot();
    const changedTimeline = copy(source);
    changedTimeline.entities.timeline_events[0]!.entity_id = 'invoice-other';
    expect(() => verifyMigratedSnapshot(source, changedTimeline)).toThrow(
      'Timeline reference verification failed.',
    );
  });
});

describe('PostgreSQL migration arguments', () => {
  it('accepts exactly one source mode', () => {
    expect(parseMigrationArguments(['--sqlite', '/data/app.db'])).toEqual({
      sqlitePath: '/data/app.db',
    });
    expect(parseMigrationArguments(['--snapshot', '/data/snapshot.json'])).toEqual({
      snapshotPath: '/data/snapshot.json',
    });
    expect(() => parseMigrationArguments([])).toThrow(PostgresMigrationError);
    expect(() =>
      parseMigrationArguments(['--sqlite', '/data/app.db', '--snapshot', '/data/snapshot.json']),
    ).toThrow('Specify exactly one');
    expect(() => parseMigrationArguments(['--sqlite'])).toThrow('Missing path');
    expect(() => parseMigrationArguments(['--other', '/data/app.db'])).toThrow('Usage:');
  });

  it('requires DATABASE_URL before reading or initializing either database', async () => {
    await expect(
      migrateToPostgres({ sqlitePath: '/does/not/exist.db' }, undefined),
    ).rejects.toThrow('DATABASE_URL is required.');
  });
});
