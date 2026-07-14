import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { env } from './config/env.js';
import { buildApp } from './app.js';

async function start(): Promise<void> {
  process.env.NODE_ENV = env.NODE_ENV;
  if (env.DB_PATH && env.DB_PATH !== ':memory:') {
    mkdirSync(dirname(env.DB_PATH), { recursive: true });
  }

  const app = await buildApp({
    ...(env.DB_PATH !== undefined ? { dbPath: env.DB_PATH } : {}),
    ...(env.DATABASE_URL !== undefined ? { databaseUrl: env.DATABASE_URL } : {}),
    enableStructuredLogging: env.ENABLE_STRUCTURED_LOGGING,
    logLevel: env.LOG_LEVEL,
    serviceName: env.SERVICE_NAME,
    organizationId: env.ORGANIZATION_ID,
    nodeEnv: env.NODE_ENV,
    dbBusyTimeoutMs: env.DB_BUSY_TIMEOUT_MS,
    dbPoolMax: env.DB_POOL_MAX,
    corsOrigin: env.CORS_ORIGIN,
    requestBodyLimit: env.REQUEST_BODY_LIMIT,
    ...(env.SUPABASE_URL !== undefined ? { supabaseUrl: env.SUPABASE_URL } : {}),
    ...((env.SUPABASE_ANON_KEY ??
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      env.SUPABASE_PUBLISHABLE_KEY) !== undefined
      ? {
          supabaseAnonKey:
            env.SUPABASE_ANON_KEY ??
            env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
            env.SUPABASE_PUBLISHABLE_KEY,
        }
      : {}),
    ...((env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY) !== undefined
      ? { supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY }
      : {}),
  });

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(
      {
        event: 'startup.failure',
        name: error instanceof Error ? error.name : 'UnknownError',
      },
      'application failed to start',
    );
    process.exit(1);
  }
}

await start();
