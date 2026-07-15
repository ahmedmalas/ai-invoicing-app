import { describe, expect, it } from 'vitest';

import { normalizePostgresConnectionString } from '../../src/db/postgres-database.js';

describe('PostgreSQL connection string normalization', () => {
  it('uses libpq-compatible TLS semantics when sslmode=require is requested', () => {
    const normalized = normalizePostgresConnectionString(
      'postgresql://user:password@example.com:5432/app?sslmode=require',
    );

    const url = new URL(normalized);
    expect(url.searchParams.get('sslmode')).toBe('require');
    expect(url.searchParams.get('uselibpqcompat')).toBe('true');
  });

  it('preserves an explicit TLS compatibility choice', () => {
    const connectionString =
      'postgresql://user:password@example.com:5432/app?sslmode=require&uselibpqcompat=false';

    expect(normalizePostgresConnectionString(connectionString)).toBe(connectionString);
  });

  it('does not alter certificate-verifying modes', () => {
    const connectionString =
      'postgresql://user:password@example.com:5432/app?sslmode=verify-full';

    expect(normalizePostgresConnectionString(connectionString)).toBe(connectionString);
  });
});
