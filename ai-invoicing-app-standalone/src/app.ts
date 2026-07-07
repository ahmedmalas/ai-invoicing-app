import Fastify from 'fastify';
import { ZodError } from 'zod';

import { createDatabase } from './db/database.js';
import { healthRoutes } from './routes/health.js';
import { customerRoutes } from './routes/customers.js';
import { businessProfileRoutes } from './routes/business-profile.js';
import { invoiceRoutes } from './routes/invoices.js';
import { jobRoutes } from './routes/jobs.js';
import { roleRoutes } from './routes/roles.js';
import { teamRoutes } from './routes/teams.js';
import { userRoutes } from './routes/users.js';
import { preferenceRoutes } from './routes/preferences.js';
import { searchRoutes } from './routes/search.js';
import { timelineRoutes } from './routes/timeline.js';
import { statementRoutes } from './routes/statements.js';
import { creditNoteRoutes } from './routes/credit-notes.js';

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
    const normalizedMessage = errorMessage.toLowerCase();

    if (error instanceof ZodError) {
      return reply.code(400).send({
        message: 'Validation failed',
        issues: error.issues,
      });
    }

    if (normalizedMessage.includes('not found') || normalizedMessage.includes('not_found')) {
      return reply.code(404).send({ message: errorMessage });
    }

    if (
      errorMessage.includes('TEAM_PERMISSION_DENIED') ||
      errorMessage.includes('TEAM_OWNER_MODIFICATION_FORBIDDEN')
    ) {
      return reply.code(403).send({ message: errorMessage });
    }

    if (
      errorMessage.includes('INVALID_TIMELINE_EVENT_TAXONOMY') ||
      errorMessage.includes('INVALID_JOB_STATUS_TRANSITION') ||
      errorMessage.includes('JOB_DOCUMENT_LINK_EXISTS') ||
      errorMessage.includes('ROLE_NAME_EXISTS') ||
      errorMessage.includes('TEAM_MEMBER_EXISTS') ||
      errorMessage.includes('INVALID_TEAM_MEMBER_ROLE') ||
      errorMessage.includes('TEAM_LAST_OWNER_REQUIRED') ||
      errorMessage.includes('TEAM_MEMBER_HAS_SCOPED_ASSIGNMENTS') ||
      errorMessage.includes('TEAM_HAS_MEMBERS') ||
      errorMessage.includes('TEAM_HAS_JOBS') ||
      errorMessage.includes('CREDIT_NOTE_REQUIRES_FINALISED_INVOICE') ||
      errorMessage.includes('CREDIT_NOTE_FOR_CANCELLED_INVOICE_FORBIDDEN') ||
      errorMessage.includes('CREDIT_NOTE_AMOUNT_EXCEEDS_INVOICE_TOTAL') ||
      errorMessage.includes('CREDIT_NOTE_FULL_ALREADY_EXISTS') ||
      errorMessage.includes('CREDIT_NOTE_PARTIAL_AMOUNT_REQUIRED') ||
      errorMessage.includes('CREDIT_NOTE_AMOUNT_INVALID') ||
      errorMessage.includes('ASSIGNED_USER_REQUIRES_ID') ||
      errorMessage.includes('ASSIGNED_USER_NAME_MISMATCH') ||
      errorMessage.includes('ASSIGNED_USER_ROLE_REQUIRED') ||
      errorMessage.includes('ASSIGNED_USER_INACTIVE') ||
      errorMessage.includes('ASSIGNED_USER_OUTSIDE_TEAM_SCOPE') ||
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
  await app.register(jobRoutes);
  await app.register(roleRoutes);
  await app.register(teamRoutes);
  await app.register(userRoutes);
  await app.register(searchRoutes);
  await app.register(timelineRoutes);
  await app.register(statementRoutes);
  await app.register(creditNoteRoutes);

  return app;
}
