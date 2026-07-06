import Fastify from 'fastify';

import { createDatabase } from './db/database.js';
import { healthRoutes } from './routes/health.js';
import { customerRoutes } from './routes/customers.js';
import { businessProfileRoutes } from './routes/business-profile.js';
import { invoiceRoutes } from './routes/invoices.js';
import { preferenceRoutes } from './routes/preferences.js';
import { searchRoutes } from './routes/search.js';
import { timelineRoutes } from './routes/timeline.js';

import type { AppDatabase } from './db/database.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: AppDatabase;
  }
}

export interface BuildAppOptions {
  dbPath: string;
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: false });
  const db = createDatabase(options.dbPath);

  app.decorate('db', db);

  app.addHook('onClose', async () => {
    db.close();
  });

  await app.register(healthRoutes);
  await app.register(customerRoutes);
  await app.register(businessProfileRoutes);
  await app.register(preferenceRoutes);
  await app.register(invoiceRoutes);
  await app.register(searchRoutes);
  await app.register(timelineRoutes);

  return app;
}
