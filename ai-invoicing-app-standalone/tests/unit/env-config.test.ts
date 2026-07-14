import { describe, expect, it } from 'vitest';

import { parseEnv } from '../../src/config/env.js';

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@pooled.example.com:5432/app?sslmode=require',
  CORS_ORIGIN: 'https://app.example.com',
  REQUEST_BODY_LIMIT: '1048576',
  ENABLE_STRUCTURED_LOGGING: '1',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'public-key-for-validation',
  SUPABASE_SERVICE_ROLE_KEY: 'server-key-for-validation',
};

describe('runtime environment configuration', () => {
  it('accepts the pooled PostgreSQL production configuration', () => {
    expect(parseEnv(productionEnv)).toMatchObject({
      NODE_ENV: 'production',
      DATABASE_URL: productionEnv.DATABASE_URL,
      CORS_ORIGIN: productionEnv.CORS_ORIGIN,
      REQUEST_BODY_LIMIT: 1_048_576,
      ENABLE_STRUCTURED_LOGGING: true,
      SUPABASE_URL: productionEnv.SUPABASE_URL,
    });
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

  it('trims whitespace from Supabase and database environment values', () => {
    expect(
      parseEnv({
        ...productionEnv,
        DATABASE_URL: ` ${productionEnv.DATABASE_URL} `,
        SUPABASE_URL: ' https://project.supabase.co ',
        SUPABASE_ANON_KEY: ' public-key-for-validation ',
      }),
    ).toMatchObject({
      DATABASE_URL: productionEnv.DATABASE_URL,
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'public-key-for-validation',
    });
  });

  it('prefers integrated Postgres URLs only when DATABASE_URL is unset', () => {
    expect(
      parseEnv({
        ...productionEnv,
        SUPABASE_URL: 'https://jsrxhisdjvwsufbqqtir.supabase.co',
        DATABASE_URL:
          'postgresql://postgres:old@db.bmfpclozzmeekazmoaxw.supabase.co:5432/postgres?sslmode=require',
        POSTGRES_URL:
          'postgresql://postgres.jsrxhisdjvwsufbqqtir:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require',
      }).DATABASE_URL,
    ).toBe(
      'postgresql://postgres:old@db.bmfpclozzmeekazmoaxw.supabase.co:5432/postgres?sslmode=require',
    );
  });

  it('falls back to POSTGRES_URL when DATABASE_URL is unset', () => {
    const { DATABASE_URL, ...withoutDatabaseUrl } = productionEnv;
    void DATABASE_URL;
    expect(
      parseEnv({
        ...withoutDatabaseUrl,
        POSTGRES_URL:
          'postgresql://postgres.jsrxhisdjvwsufbqqtir:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require',
      }).DATABASE_URL,
    ).toBe(
      'postgresql://postgres.jsrxhisdjvwsufbqqtir:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require',
    );
  });
});
