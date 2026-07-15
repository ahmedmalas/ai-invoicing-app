import { describe, expect, it } from 'vitest';

import { parseEnv } from '../../src/config/env.js';

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@pooled.example.com:5432/app?sslmode=require',
  CORS_ORIGIN: 'https://app.example.com',
  REQUEST_BODY_LIMIT: '1048576',
  ENABLE_STRUCTURED_LOGGING: '1',
};

describe('runtime environment configuration', () => {
  it('uses the Vercel pooled URL when DATABASE_URL is an empty sensitive reference', () => {
    const parsed = parseEnv({
      ...productionEnv,
      DATABASE_URL: '',
      POSTGRES_URL: productionEnv.DATABASE_URL,
    });
    expect(parsed.DATABASE_URL).toBe(productionEnv.DATABASE_URL);
  });

  it('accepts the pooled PostgreSQL production configuration', () => {
    expect(parseEnv(productionEnv)).toMatchObject({
      NODE_ENV: 'production',
      DATABASE_URL: productionEnv.DATABASE_URL,
      CORS_ORIGIN: productionEnv.CORS_ORIGIN,
      REQUEST_BODY_LIMIT: 1_048_576,
      ENABLE_STRUCTURED_LOGGING: true,
    });
  });

  it('trims browser authentication endpoint and public key values', () => {
    const parsed = parseEnv({
      ...productionEnv,
      ENABLE_BROWSER_APP: '1',
      SUPABASE_URL: '  https://replacement.supabase.co  ',
      SUPABASE_PUBLISHABLE_KEY: '  sb_publishable_test  ',
    });

    expect(parsed.SUPABASE_URL).toBe('https://replacement.supabase.co');
    expect(parsed.SUPABASE_PUBLISHABLE_KEY).toBe('sb_publishable_test');
  });

  it('requires PostgreSQL and rejects SQLite in production', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.example.com',
      }),
    ).toThrow('DATABASE_URL is required in production');
    expect(() => parseEnv({ ...productionEnv, DB_PATH: './data/app.db' })).toThrow(
      'DB_PATH is not supported in production',
    );
  });

  it('rejects malformed CORS origins and unsafe body limits', () => {
    expect(() =>
      parseEnv({ ...productionEnv, CORS_ORIGIN: 'https://app.example.com/path' }),
    ).toThrow('CORS_ORIGIN must be a URL origin');
    expect(() => parseEnv({ ...productionEnv, REQUEST_BODY_LIMIT: '100' })).toThrow();
  });
});
