import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('PostgreSQL schema security', () => {
  it('enables row-level security for every public application table', () => {
    const schema = readFileSync(
      new URL('../../src/db/postgres-schema.sql', import.meta.url),
      'utf8',
    );
    const tables = Array.from(
      schema.matchAll(/^CREATE TABLE IF NOT EXISTS ([a-z_]+) \(/gm),
      (match) => match[1],
    );

    expect(tables).toHaveLength(35);
    expect(new Set(tables).size).toBe(tables.length);

    for (const table of tables) {
      expect(schema).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    }
  });
});
