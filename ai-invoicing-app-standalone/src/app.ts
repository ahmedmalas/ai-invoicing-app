import Fastify from 'fastify';
import { ZodError } from 'zod';
import { z } from 'zod';

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
import { reportRoutes } from './routes/reports.js';
import { platformSnapshotRoutes } from './routes/platform-snapshot.js';

import type { AppDatabase } from './db/database.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: AppDatabase;
  }

  interface FastifyRequest {
    auth: {
      userId: string;
      isAdmin: boolean;
      canWrite: boolean;
    };
  }
}

export interface BuildAppOptions {
  dbPath: string;
  authBypassForTesting?: boolean;
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: false });
  const db = createDatabase(options.dbPath);
  const authBypassForTesting =
    options.authBypassForTesting ?? process.env.AI_BUSINESS_OS_TEST_AUTH_BYPASS === '1';

  app.decorate('db', db);

  const machineCodeFromMessage = (message: string, fallback: string): string => {
    const trimmed = message.trim();
    if (!trimmed) {
      return fallback;
    }
    const normalized = trimmed
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
    return normalized || fallback;
  };

  const standardizeErrorPayload = (
    status: number,
    message: string,
    details?: unknown,
  ): { status: number; code: string; message: string; details?: unknown } => ({
    status,
    code: machineCodeFromMessage(message, status === 500 ? 'INTERNAL_SERVER_ERROR' : 'API_ERROR'),
    message,
    ...(details !== undefined ? { details } : {}),
  });

  const adminOnlyRoutes = new Set(['/roles', '/roles/:roleId', '/users', '/users/:userId', '/platform/backup', '/platform/restore']);

  app.addHook('onRequest', async (request) => {
    if (request.url === '/health') {
      return;
    }

    const actorHeaderValue = request.headers['x-actor-user-id'];
    const actorHeader = Array.isArray(actorHeaderValue) ? actorHeaderValue[0] : actorHeaderValue;
    if (!actorHeader) {
      if (authBypassForTesting) {
        request.auth = {
          userId: '00000000-0000-0000-0000-000000000001',
          isAdmin: true,
          canWrite: true,
        };
        return;
      }
      throw new Error('AUTH_UNAUTHENTICATED');
    }

    const parsedActorId = z.string().uuid().safeParse(actorHeader);
    if (!parsedActorId.success) {
      throw new Error('AUTH_UNAUTHENTICATED');
    }

    const actor = db.getUserById(parsedActorId.data);
    if (!actor || !actor.isActive) {
      throw new Error('AUTH_UNAUTHENTICATED');
    }

    const roleRecords = actor.roleIds
      .map((roleId) => db.getRoleById(roleId))
      .filter((role): role is NonNullable<typeof role> => role !== null);
    const isAdmin = roleRecords.some((role) => role.canManageAssignments);
    const canWrite = roleRecords.some((role) => role.canManageAssignments || role.canBeAssigned);
    request.auth = {
      userId: actor.id,
      isAdmin,
      canWrite,
    };
  });

  app.addHook('preHandler', async (request) => {
    if (request.url === '/health') {
      return;
    }
    const routeUrl = request.routeOptions.url;
    if (routeUrl && adminOnlyRoutes.has(routeUrl)) {
      if (!request.auth.isAdmin) {
        throw new Error('AUTH_FORBIDDEN');
      }
      return;
    }

    const method = request.method.toUpperCase();
    const isWriteMethod = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    if (!isWriteMethod) {
      return;
    }

    if (!request.auth.canWrite) {
      throw new Error('AUTH_FORBIDDEN');
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const normalizedMessage = errorMessage.toLowerCase();

    if (error instanceof ZodError) {
      return reply.code(400).send({
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: {
          issues: error.issues,
        },
      });
    }

    if (
      errorMessage.includes('BACKUP_RESTORE_MALFORMED_PAYLOAD') ||
      errorMessage.includes('BACKUP_RESTORE_INCOMPLETE_PAYLOAD')
    ) {
      return reply.code(400).send(standardizeErrorPayload(400, errorMessage));
    }

    if (normalizedMessage.includes('not found') || normalizedMessage.includes('not_found')) {
      return reply.code(404).send(standardizeErrorPayload(404, errorMessage));
    }

    if (
      errorMessage.includes('AUTH_UNAUTHENTICATED')
    ) {
      return reply.code(401).send(standardizeErrorPayload(401, errorMessage));
    }

    if (
      errorMessage.includes('AUTH_FORBIDDEN') ||
      errorMessage.includes('TEAM_PERMISSION_DENIED') ||
      errorMessage.includes('TEAM_OWNER_MODIFICATION_FORBIDDEN')
    ) {
      return reply.code(403).send(standardizeErrorPayload(403, errorMessage));
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
      errorMessage.includes('CUSTOMER_HAS_INVOICES') ||
      errorMessage.includes('CUSTOMER_HAS_PAYMENTS') ||
      errorMessage.includes('CUSTOMER_HAS_CREDIT_NOTES') ||
      errorMessage.includes('CUSTOMER_HAS_JOBS') ||
      errorMessage.includes('SUPPLIER_HAS_PURCHASE_ORDERS') ||
      errorMessage.includes('SUPPLIER_HAS_BILLS') ||
      errorMessage.includes('SUPPLIER_HAS_PAYMENTS') ||
      errorMessage.includes('ROLE_HAS_USERS') ||
      errorMessage.includes('USER_HAS_ASSIGNED_JOBS') ||
      errorMessage.includes('USER_HAS_TEAM_MEMBERSHIPS') ||
      errorMessage.includes('PURCHASE_ORDER_HAS_LINKED_SUPPLIER_BILLS') ||
      errorMessage.includes('SUPPLIER_BILL_HAS_ALLOCATIONS') ||
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
      errorMessage.includes('DOCUMENT_NUMBER_SEQUENCE_INVALID_STATE') ||
      errorMessage.includes('DOCUMENT_NUMBER_SEQUENCE_CONFLICT') ||
      errorMessage.includes('SUPPLIER_BILL_REFERENCE_EXISTS') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATIONS_REQUIRED') ||
      errorMessage.includes('SUPPLIER_PAYMENT_DUPLICATE_ALLOCATION_BILL') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATIONS_EXCEED_PAYMENT_AMOUNT') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_AMOUNT_INVALID') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_REQUIRES_FINALISED_BILL') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_SUPPLIER_MISMATCH') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_FOR_CANCELLED_BILL_FORBIDDEN') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_EXCEEDS_OUTSTANDING') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_NOT_FOUND') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_SUPPLIER_MISMATCH') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_LINE_REFERENCE_REQUIRED') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_LINE_REFERENCE_INVALID') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_QUANTITY_EXCEEDS_REMAINING') ||
      errorMessage.includes('SUPPLIER_PAYMENT_ALLOCATION_SOURCE_PO_VALUE_EXCEEDS_REMAINING') ||
      errorMessage.includes('PURCHASE_ORDER_REFERENCE_EXISTS') ||
      errorMessage.includes('INVALID_PURCHASE_ORDER_STATUS_TRANSITION') ||
      errorMessage.includes('IMMUTABLE_APPROVED_PURCHASE_ORDER') ||
      errorMessage.includes('IMMUTABLE_TERMINAL_PURCHASE_ORDER') ||
      errorMessage.includes('IMMUTABLE_NON_DRAFT_PURCHASE_ORDER_LINE_ITEMS') ||
      errorMessage.includes('IMMUTABLE_PURCHASE_ORDER_NUMBER') ||
      errorMessage.includes('IMMUTABLE_CREDIT_NOTE_NUMBER') ||
      errorMessage.includes('IMMUTABLE_CUSTOMER_PAYMENT_NUMBER') ||
      errorMessage.includes('IMMUTABLE_SUPPLIER_PAYMENT_NUMBER') ||
      errorMessage.includes('IMMUTABLE_NON_DRAFT_PURCHASE_ORDER_DOCUMENT') ||
      errorMessage.includes('PURCHASE_ORDER_REQUIRES_APPROVED_STATUS') ||
      errorMessage.includes('PURCHASE_ORDER_SUPPLIER_BILL_ALREADY_CREATED') ||
      errorMessage.includes('PURCHASE_ORDER_LINE_ITEM_NOT_FOUND') ||
      errorMessage.includes('PURCHASE_ORDER_BILLING_LINES_REQUIRED') ||
      errorMessage.includes('PURCHASE_ORDER_BILLING_DUPLICATE_LINE_ITEM') ||
      errorMessage.includes('PURCHASE_ORDER_BILLING_QUANTITY_INVALID') ||
      errorMessage.includes('PURCHASE_ORDER_BILLING_QUANTITY_EXCEEDS_REMAINING') ||
      errorMessage.includes('PURCHASE_ORDER_BILLING_AMOUNT_EXCEEDS_REMAINING') ||
      errorMessage.includes('SUPPLIER_BILL_SOURCE_PO_NOT_FOUND') ||
      errorMessage.includes('SUPPLIER_BILL_SOURCE_PO_SUPPLIER_MISMATCH') ||
      errorMessage.includes('SUPPLIER_BILL_LINKED_CURRENCY_IMMUTABLE') ||
      errorMessage.includes('SUPPLIER_BILL_LINKED_LINE_SOURCE_REQUIRED') ||
      errorMessage.includes('SUPPLIER_BILL_SOURCE_PO_LINE_REFERENCE_IMMUTABLE') ||
      errorMessage.includes('SUPPLIER_BILL_SOURCE_PO_LINE_MISMATCH') ||
      errorMessage.includes('SUPPLIER_BILL_LINE_ITEM_MISMATCH') ||
      errorMessage.includes('SUPPLIER_BILL_FINALISE_EMPTY_LINE_ITEMS') ||
      errorMessage.includes('SUPPLIER_BILL_FINALISE_SUPPLIER_NOT_FOUND') ||
      errorMessage.includes('SUPPLIER_BILL_FINALISE_INVALID_LINE_QUANTITY') ||
      errorMessage.includes('SUPPLIER_BILL_FINALISE_INVALID_LINE_UNIT_PRICE') ||
      errorMessage.includes('SUPPLIER_BILL_FINALISE_TOTALS_MISMATCH') ||
      errorMessage.includes('SUPPLIER_BILL_FINALISE_SOURCE_PO_NOT_FOUND') ||
      errorMessage.includes('SUPPLIER_BILL_FINALISE_SOURCE_PO_SUPPLIER_MISMATCH') ||
      errorMessage.includes('SUPPLIER_BILL_FINALISE_SOURCE_PO_LINE_REFERENCE_REQUIRED') ||
      errorMessage.includes('SUPPLIER_BILL_FINALISE_SOURCE_PO_LINE_REFERENCE_INVALID') ||
      errorMessage.includes('SUPPLIER_BILL_FINALISE_SOURCE_PO_QUANTITY_EXCEEDS_REMAINING') ||
      errorMessage.includes('SUPPLIER_BILL_FINALISE_SOURCE_PO_VALUE_EXCEEDS_REMAINING') ||
      errorMessage.includes('PURCHASE_ORDER_DRAFT_CANNOT_CLOSE') ||
      errorMessage.includes('PURCHASE_ORDER_CANCELLED_CANNOT_CLOSE') ||
      errorMessage.includes('PURCHASE_ORDER_ALREADY_APPROVED') ||
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
      errorMessage.includes('IMMUTABLE_INVOICE_CUSTOMER_REFERENCE') ||
      errorMessage.includes('IMMUTABLE_CREDIT_NOTE_CUSTOMER_REFERENCE') ||
      errorMessage.includes('IMMUTABLE_CREDIT_NOTE_INVOICE_REFERENCE') ||
      errorMessage.includes('IMMUTABLE_CUSTOMER_PAYMENT_CUSTOMER_REFERENCE') ||
      errorMessage.includes('IMMUTABLE_PURCHASE_ORDER_SUPPLIER_REFERENCE') ||
      errorMessage.includes('IMMUTABLE_SUPPLIER_BILL_SUPPLIER_REFERENCE') ||
      errorMessage.includes('IMMUTABLE_SUPPLIER_BILL_SOURCE_PO_REFERENCE') ||
      errorMessage.includes('IMMUTABLE_SUPPLIER_PAYMENT_SUPPLIER_REFERENCE') ||
      errorMessage.includes('IMMUTABLE_PAYMENT_ALLOCATION') ||
      errorMessage.includes('IMMUTABLE_SUPPLIER_PAYMENT_ALLOCATION') ||
      errorMessage.includes('Only draft invoices can be edited') ||
      errorMessage.includes('already finalised') ||
      errorMessage.includes('BACKUP_RESTORE_INCOMPATIBLE_VERSION') ||
      errorMessage.includes('BACKUP_RESTORE_TARGET_NOT_EMPTY')
    ) {
      return reply.code(409).send(standardizeErrorPayload(409, errorMessage));
    }

    return reply.code(500).send(standardizeErrorPayload(500, 'Internal server error'));
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    if (reply.statusCode < 400) {
      return payload;
    }

    const normalizePayload = (input: unknown): Record<string, unknown> | null => {
      if (input && typeof input === 'object' && !Buffer.isBuffer(input)) {
        return input as Record<string, unknown>;
      }
      if (typeof input === 'string') {
        try {
          const parsed = JSON.parse(input) as unknown;
          if (parsed && typeof parsed === 'object') {
            return parsed as Record<string, unknown>;
          }
        } catch {
          return null;
        }
      }
      return null;
    };

    const normalized = normalizePayload(payload);
    if (!normalized || typeof normalized.message !== 'string') {
      return payload;
    }

    const details =
      normalized.details ??
      (normalized.issues !== undefined ? { issues: normalized.issues } : undefined);
    const standardized = standardizeErrorPayload(reply.statusCode, normalized.message, details);
    return typeof payload === 'string' ? JSON.stringify(standardized) : standardized;
  });

  app.addHook('onClose', async () => {
    db.close();
  });

  await app.register(healthRoutes);
  await app.register(platformSnapshotRoutes);
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
  await app.register(reportRoutes);
  await app.register(creditNoteRoutes);
  await app.register(paymentRoutes);
  await app.register(supplierRoutes);
  await app.register(supplierBillRoutes);
  await app.register(supplierPaymentRoutes);
  await app.register(purchaseOrderRoutes);

  return app;
}
