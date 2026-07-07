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
import { paymentRoutes } from './routes/payments.js';
import { supplierRoutes } from './routes/suppliers.js';
import { supplierBillRoutes } from './routes/supplier-bills.js';
import { supplierPaymentRoutes } from './routes/supplier-payments.js';
import { purchaseOrderRoutes } from './routes/purchase-orders.js';

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
      errorMessage.includes('PAYMENT_ALLOCATIONS_REQUIRED') ||
      errorMessage.includes('PAYMENT_DUPLICATE_ALLOCATION_INVOICE') ||
      errorMessage.includes('PAYMENT_ALLOCATIONS_EXCEED_PAYMENT_AMOUNT') ||
      errorMessage.includes('PAYMENT_ALLOCATION_AMOUNT_INVALID') ||
      errorMessage.includes('PAYMENT_ALLOCATION_REQUIRES_FINALISED_INVOICE') ||
      errorMessage.includes('PAYMENT_ALLOCATION_CUSTOMER_MISMATCH') ||
      errorMessage.includes('PAYMENT_ALLOCATION_FOR_CANCELLED_INVOICE_FORBIDDEN') ||
      errorMessage.includes('PAYMENT_ALLOCATION_EXCEEDS_OUTSTANDING') ||
      errorMessage.includes('SUPPLIER_BILL_REFERENCE_EXISTS') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATIONS_REQUIRED') ||
      errorMessage.includes('SUPPLIER_PAYMENT_DUPLICATE_ALLOCATION_BILL') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATIONS_EXCEED_PAYMENT_AMOUNT') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_AMOUNT_INVALID') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_REQUIRES_FINALISED_BILL') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_SUPPLIER_MISMATCH') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_FOR_CANCELLED_BILL_FORBIDDEN') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_EXCEEDS_OUTSTANDING') ||
      errorMessage.includes('PURCHASE_ORDER_REFERENCE_EXISTS') ||
      errorMessage.includes('INVALID_PURCHASE_ORDER_STATUS_TRANSITION') ||
      errorMessage.includes('IMMUTABLE_APPROVED_PURCHASE_ORDER') ||
      errorMessage.includes('IMMUTABLE_TERMINAL_PURCHASE_ORDER') ||
      errorMessage.includes('IMMUTABLE_NON_DRAFT_PURCHASE_ORDER_LINE_ITEMS') ||
      errorMessage.includes('IMMUTABLE_NON_DRAFT_PURCHASE_ORDER_DOCUMENT') ||
      errorMessage.includes('PURCHASE_ORDER_REQUIRES_APPROVED_STATUS') ||
      errorMessage.includes('PURCHASE_ORDER_SUPPLIER_BILL_ALREADY_CREATED') ||
      errorMessage.includes('PURCHASE_ORDER_LINE_ITEM_NOT_FOUND') ||
      errorMessage.includes('PURCHASE_ORDER_BILLING_LINES_REQUIRED') ||
      errorMessage.includes('PURCHASE_ORDER_BILLING_DUPLICATE_LINE_ITEM') ||
      errorMessage.includes('PURCHASE_ORDER_BILLING_QUANTITY_INVALID') ||
      errorMessage.includes('PURCHASE_ORDER_BILLING_QUANTITY_EXCEEDS_REMAINING') ||
      errorMessage.includes('PURCHASE_ORDER_BILLING_AMOUNT_EXCEEDS_REMAINING') ||
      errorMessage.includes('PURCHASE_ORDER_DRAFT_CANNOT_CLOSE') ||
      errorMessage.includes('PURCHASE_ORDER_CANCELLED_CANNOT_CLOSE') ||
      errorMessage.includes('PURCHASE_ORDER_ALREADY_CLOSED') ||
      errorMessage.includes('PURCHASE_ORDER_CLOSE_REASON_REQUIRED') ||
      errorMessage.includes('PURCHASE_ORDER_CLOSE_DATE_REQUIRED') ||
      errorMessage.includes('Only draft purchase orders can be edited') ||
      errorMessage.includes('IMMUTABLE_FINALISED_SUPPLIER_BILL') ||
      errorMessage.includes('IMMUTABLE_FINALISED_SUPPLIER_BILL_LINE_ITEMS') ||
      errorMessage.includes('IMMUTABLE_FINALISED_SUPPLIER_BILL_DOCUMENT') ||
      errorMessage.includes('Only draft supplier bills can be edited') ||
      errorMessage.includes('Supplier bill already finalised') ||
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
  await app.register(paymentRoutes);
  await app.register(supplierRoutes);
  await app.register(supplierBillRoutes);
  await app.register(supplierPaymentRoutes);
  await app.register(purchaseOrderRoutes);

  return app;
}
