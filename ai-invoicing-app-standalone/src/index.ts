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
  });

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

await start();
