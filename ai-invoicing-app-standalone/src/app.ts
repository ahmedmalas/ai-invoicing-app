import Fastify from 'fastify';
import { ZodError } from 'zod';

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

  app.setErrorHandler((error, _request, reply) => {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: 'Validation failed',
        issues: error.issues,
      });
    }

    if (errorMessage.includes('not found')) {
      return reply.code(404).send({ message: errorMessage });
    }

    if (
      errorMessage.includes('IMMUTABLE_FINALISED_INVOICE') ||
      errorMessage.includes('IMMUTABLE_FINALISED_INVOICE_LINE_ITEMS') ||
      errorMessage.includes('IMMUTABLE_INVOICE_SNAPSHOT') ||
      errorMessage.includes('IMMUTABLE_FINALISED_INVOICE_DOCUMENT') ||
      errorMessage.includes('Only draft invoices can be edited') ||
      errorMessage.includes('already finalised')
    ) {
      return reply.code(409).send({ message: errorMessage });
    }

    return reply.code(500).send({ message: 'Internal server error' });
  });

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
