import { describe, expect, it } from 'vitest';

import { normalizePostgresConnectionString } from '../../src/db/postgres-database.js';

describe('PostgreSQL connection string normalization', () => {
  it('uses standard libpq TLS semantics for sslmode=require', () => {
    const normalized = new URL(
      normalizePostgresConnectionString(
        'postgresql://user:password@pooler.example.com:5432/database?sslmode=require',
      ),
    );

    expect(normalized.searchParams.get('sslmode')).toBe('require');
    expect(normalized.searchParams.get('uselibpqcompat')).toBe('true');
  });

  it('does not weaken explicit certificate verification or override an existing choice', () => {
    const verified = new URL(
      normalizePostgresConnectionString(
        'postgresql://user:password@db.example.com:5432/database?sslmode=verify-full',
      ),
    );
    const explicit = new URL(
      normalizePostgresConnectionString(
        'postgresql://user:password@db.example.com:5432/database?sslmode=require&uselibpqcompat=false',
      ),
    );

    expect(verified.searchParams.has('uselibpqcompat')).toBe(false);
    expect(explicit.searchParams.get('uselibpqcompat')).toBe('false');
  });
});
