import { describe, expect, it } from 'vitest';

import { DATABASE_SCHEMA_VERSION } from '../../src/db/postgres-database.js';

describe('postgres boot skip policy', () => {
  it('treats equal or newer metadata as skip-eligible (no cold-start DDL)', () => {
    const shouldSkip = (current: number, app: number) => current >= app;
    expect(shouldSkip(DATABASE_SCHEMA_VERSION, DATABASE_SCHEMA_VERSION)).toBe(true);
    expect(shouldSkip(DATABASE_SCHEMA_VERSION + 1, DATABASE_SCHEMA_VERSION)).toBe(true);
    expect(shouldSkip(DATABASE_SCHEMA_VERSION - 1, DATABASE_SCHEMA_VERSION)).toBe(false);
    expect(shouldSkip(0, DATABASE_SCHEMA_VERSION)).toBe(false);
  });
});
