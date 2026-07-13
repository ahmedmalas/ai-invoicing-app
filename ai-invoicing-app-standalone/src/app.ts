import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { ZodError } from 'zod';
import { z } from 'zod';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { healthRoutes } from './routes/health.js';
import { customerRoutes } from './routes/customers.js';
import { businessProfileRoutes } from './routes/business-profile.js';
import { invoiceRoutes } from './routes/invoices.js';
import { quoteRoutes } from './routes/quotes.js';
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

interface OperationalMetrics {
  requestCount: number;
  successCount: number;
  clientErrorCount: number;
  serverErrorCount: number;
  authFailureCount: number;
  validationFailureCount: number;
  databaseFailureCount: number;
  unexpectedErrorCount: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: AppDatabase;
    opsMetrics: OperationalMetrics;
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
  dbPath?: string;
  databaseUrl?: string;
  authBypassForTesting?: boolean;
  enableStructuredLogging?: boolean;
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
  serviceName?: string;
  organizationId?: string;
  nodeEnv?: string;
  dbBusyTimeoutMs?: number;
  dbPoolMax?: number;
  corsOrigin?: string;
  requestBodyLimit?: number;
  loggerStream?: NodeJS.WritableStream;
  abossIntegrationSecret?: string;
  abossIntegrationActorUserId?: string;
  abossAllowedOrganizationId?: string;
  abossOnlyAuth?: boolean;
}

export async function buildApp(options: BuildAppOptions) {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const organizationId = options.organizationId ?? process.env.ORGANIZATION_ID ?? 'single-tenant';
  const enableStructuredLogging = options.enableStructuredLogging ?? false;
  const loggerConfig = enableStructuredLogging
    ? {
        level: options.logLevel ?? 'info',
        base: { service: options.serviceName ?? 'ai-business-os', environment: nodeEnv },
        redact: {
          paths: ['req.url'],
          censor: '[REDACTED]',
        },
        ...(options.loggerStream ? { stream: options.loggerStream } : {}),
      }
    : false;
  const app = Fastify({
    logger: loggerConfig,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: options.requestBodyLimit ?? 1_048_576,
  });
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  let db: AppDatabase;
  if (options.dbPath !== undefined) {
    const { createDatabase } = await import('./db/database.js');
    db = createDatabase(options.dbPath, {
      ...(options.dbBusyTimeoutMs !== undefined ? { busyTimeoutMs: options.dbBusyTimeoutMs } : {}),
    });
  } else if (databaseUrl) {
    const { createPostgresDatabase } = await import('./db/postgres-database.js');
    db = await createPostgresDatabase(databaseUrl, {
      ...(options.dbPoolMax !== undefined ? { maxConnections: options.dbPoolMax } : {}),
    });
  } else {
    throw new Error('DATABASE_URL_REQUIRED');
  }
  const requestStartedAt = new WeakMap<object, bigint>();
  const authBypassForTesting =
    options.authBypassForTesting ??
    (nodeEnv === 'test' && process.env.AI_BUSINESS_OS_TEST_AUTH_BYPASS === '1');
  const abossIntegrationSecret = options.abossIntegrationSecret ?? process.env.ABOSS_INTEGRATION_SECRET;
  const abossIntegrationActorUserId = options.abossIntegrationActorUserId ?? process.env.ABOSS_INTEGRATION_ACTOR_USER_ID;
  const abossAllowedOrganizationId = options.abossAllowedOrganizationId ?? process.env.ABOSS_ALLOWED_ORGANIZATION_ID;
  const abossOnlyAuth = options.abossOnlyAuth ?? process.env.ABOSS_ONLY_AUTH === '1';
  const usedAbossNonces = new Map<string, number>();
  const sanitizePath = (url: string): string => url.split('?')[0] ?? url;
  const singleHeader = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

  app.decorate('db', db);
  app.decorate('opsMetrics', {
    requestCount: 0,
    successCount: 0,
    clientErrorCount: 0,
    serverErrorCount: 0,
    authFailureCount: 0,
    validationFailureCount: 0,
    databaseFailureCount: 0,
    unexpectedErrorCount: 0,
  });

  await app.register(helmet);
  if (options.corsOrigin !== undefined) {
    await app.register(cors, {
      origin: options.corsOrigin,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    });
  }

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

  const adminOnlyRoutes = new Set([
    '/roles',
    '/roles/:roleId',
    '/users',
    '/users/:userId',
    '/platform/backup',
    '/platform/restore',
    '/health/diagnostics',
  ]);
  const isPublicHealthRoute = (url: string): boolean =>
    ['/health', '/health/live', '/health/ready'].includes(url.split('?')[0] ?? url);

  app.addHook('onRequest', async (request) => {
    app.opsMetrics.requestCount += 1;
    requestStartedAt.set(request, process.hrtime.bigint());
    app.log.info(
      {
        event: 'request.received',
        requestId: request.id,
        method: request.method,
        url: sanitizePath(request.url),
      },
      'request received',
    );
    if (isPublicHealthRoute(request.url)) {
      return;
    }

    if (singleHeader(request.headers['x-aboss-signature'])) {
      return;
    }
    if (abossOnlyAuth) {
      throw new Error('AUTH_UNAUTHENTICATED');
    }

    const organizationHeaderValue = request.headers['x-organization-id'];
    const organizationHeader = Array.isArray(organizationHeaderValue)
      ? organizationHeaderValue[0]
      : organizationHeaderValue;
    if (organizationHeader && organizationHeader !== organizationId) {
      throw new Error('AUTH_FORBIDDEN');
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

    const actor = await db.getUserById(parsedActorId.data);
    if (!actor || !actor.isActive) {
      throw new Error('AUTH_UNAUTHENTICATED');
    }

    const roleRecords = [];
    for (const roleId of actor.roleIds) {
      const role = await db.getRoleById(roleId);
      if (role) roleRecords.push(role);
    }
    const isAdmin = roleRecords.some((role) => role.canManageAssignments);
    const canWrite = roleRecords.some((role) => role.canManageAssignments || role.canBeAssigned);
    request.auth = {
      userId: actor.id,
      isAdmin,
      canWrite,
    };
  });

  app.addHook('preValidation', async (request) => {
    if (isPublicHealthRoute(request.url)) return;
    const signature = singleHeader(request.headers['x-aboss-signature']);
    if (!signature) return;
    const timestamp = singleHeader(request.headers['x-aboss-timestamp']);
    const nonce = singleHeader(request.headers['x-aboss-nonce']);
    const abossUserId = singleHeader(request.headers['x-aboss-user-id']);
    const abossOrganizationId = singleHeader(request.headers['x-aboss-organization-id']);
    const contentHash = singleHeader(request.headers['x-aboss-content-sha256']);
    if (
      !abossIntegrationSecret ||
      !abossIntegrationActorUserId ||
      !timestamp ||
      !nonce ||
      !abossUserId ||
      !abossOrganizationId ||
      !contentHash ||
      !/^\d{13}$/.test(timestamp) ||
      !/^[a-f0-9]{64}$/.test(signature) ||
      !/^[a-f0-9]{64}$/.test(contentHash) ||
      !z.string().uuid().safeParse(abossUserId).success ||
      !z.string().uuid().safeParse(abossOrganizationId).success ||
      !z.string().uuid().safeParse(abossIntegrationActorUserId).success
    ) {
      throw new Error('AUTH_UNAUTHENTICATED');
    }
    if (abossAllowedOrganizationId && abossOrganizationId !== abossAllowedOrganizationId) {
      throw new Error('AUTH_FORBIDDEN');
    }
    const now = Date.now();
    const issuedAt = Number(timestamp);
    if (!Number.isSafeInteger(issuedAt) || Math.abs(now - issuedAt) > 60_000) {
      throw new Error('AUTH_UNAUTHENTICATED');
    }
    for (const [usedNonce, expiresAt] of usedAbossNonces) {
      if (expiresAt <= now) usedAbossNonces.delete(usedNonce);
    }
    if (usedAbossNonces.has(nonce)) throw new Error('AUTH_UNAUTHENTICATED');
    const serializedBody = JSON.stringify(request.body ?? null);
    const actualContentHash = createHash('sha256').update(serializedBody).digest('hex');
    if (actualContentHash !== contentHash) throw new Error('AUTH_UNAUTHENTICATED');
    const canonical = [
      'aboss-invoicing-v1',
      request.method.toUpperCase(),
      request.url,
      timestamp,
      nonce,
      abossUserId,
      abossOrganizationId,
      contentHash,
    ].join('\n');
    const expected = createHmac('sha256', abossIntegrationSecret).update(canonical).digest();
    const received = Buffer.from(signature, 'hex');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new Error('AUTH_UNAUTHENTICATED');
    }
    const actor = await db.getUserById(abossIntegrationActorUserId);
    if (!actor || !actor.isActive) throw new Error('AUTH_UNAUTHENTICATED');
    const roleRecords = [];
    for (const roleId of actor.roleIds) {
      const role = await db.getRoleById(roleId);
      if (role) roleRecords.push(role);
    }
    usedAbossNonces.set(nonce, now + 120_000);
    request.auth = {
      userId: actor.id,
      isAdmin: roleRecords.some((role) => role.canManageAssignments),
      canWrite: roleRecords.some((role) => role.canManageAssignments || role.canBeAssigned),
    };
  });

  app.addHook('preHandler', async (request) => {
    if (isPublicHealthRoute(request.url)) {
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

  app.setErrorHandler((error, request, reply) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const normalizedMessage = errorMessage.toLowerCase();
    const errorStatusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? error.statusCode
        : undefined;

    if (errorStatusCode === 413) {
      app.opsMetrics.validationFailureCount += 1;
      return reply.code(413).send(standardizeErrorPayload(413, 'Request body too large'));
    }

    if (error instanceof ZodError) {
      app.opsMetrics.validationFailureCount += 1;
      app.log.warn(
        {
          event: 'validation.failure',
          requestId: request.id,
          method: request.method,
          url: sanitizePath(request.url),
          issues: error.issues,
        },
        'validation failed',
      );
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

    if (errorMessage.includes('AUTH_UNAUTHENTICATED')) {
      app.opsMetrics.authFailureCount += 1;
      app.log.warn(
        {
          event: 'authorization.failure',
          requestId: request.id,
          method: request.method,
          url: sanitizePath(request.url),
          code: 'AUTH_UNAUTHENTICATED',
        },
        'unauthenticated request rejected',
      );
      return reply.code(401).send(standardizeErrorPayload(401, errorMessage));
    }

    if (
      errorMessage.includes('AUTH_FORBIDDEN') ||
      errorMessage.includes('TEAM_PERMISSION_DENIED') ||
      errorMessage.includes('TEAM_OWNER_MODIFICATION_FORBIDDEN')
    ) {
      app.opsMetrics.authFailureCount += 1;
      app.log.warn(
        {
          event: 'authorization.failure',
          requestId: request.id,
          method: request.method,
          url: sanitizePath(request.url),
          code: 'AUTH_FORBIDDEN',
        },
        'forbidden request rejected',
      );
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
      errorMessage.includes('CUSTOMER_HAS_QUOTES') ||
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
      errorMessage.includes('INVALID_QUOTE_STATUS_TRANSITION') ||
      errorMessage.includes('QUOTE_MUST_BE_ACCEPTED_BEFORE_CONVERSION') ||
      errorMessage.includes('Only draft quotes can be edited') ||
      errorMessage.includes('Only draft quotes can be deleted') ||
      errorMessage.includes('Only draft invoices can be deleted') ||
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
      errorMessage.includes('BACKUP_RESTORE_TARGET_NOT_EMPTY') ||
      errorMessage.includes('DB_SCHEMA_VERSION_UNSUPPORTED')
    ) {
      return reply.code(409).send(standardizeErrorPayload(409, errorMessage));
    }

    if (
      error instanceof Error &&
      (error.name === 'SqliteError' ||
        ('severity' in error && typeof (error as { code?: unknown }).code === 'string'))
    ) {
      app.opsMetrics.databaseFailureCount += 1;
      app.log.error(
        {
          event: 'database.failure',
          requestId: request.id,
          method: request.method,
          url: sanitizePath(request.url),
          name: error.name,
          code: (error as { code?: string }).code ?? 'DATABASE_ERROR',
        },
        'database operation failed',
      );
      return reply.code(500).send(standardizeErrorPayload(500, 'Internal server error'));
    }

    app.opsMetrics.unexpectedErrorCount += 1;
    app.log.error(
      {
        event: 'runtime.unexpected_error',
        requestId: request.id,
        method: request.method,
        url: sanitizePath(request.url),
        name: error instanceof Error ? error.name : 'UnknownError',
      },
      'unexpected runtime error',
    );

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

  app.addHook('onResponse', async (request, reply) => {
    const started = requestStartedAt.get(request);
    const durationMs =
      started === undefined
        ? undefined
        : Number((process.hrtime.bigint() - started) / BigInt(1_000_000));
    if (reply.statusCode >= 500) {
      app.opsMetrics.serverErrorCount += 1;
    } else if (reply.statusCode >= 400) {
      app.opsMetrics.clientErrorCount += 1;
    } else {
      app.opsMetrics.successCount += 1;
    }
    app.log.info(
      {
        event: 'request.completed',
        requestId: request.id,
        method: request.method,
        url: sanitizePath(request.url),
        statusCode: reply.statusCode,
        durationMs,
      },
      'request completed',
    );
  });

  app.addHook('onClose', async () => {
    await db.close();
  });

  await app.register(healthRoutes);
  await app.register(platformSnapshotRoutes);
  await app.register(customerRoutes);
  await app.register(businessProfileRoutes);
  await app.register(preferenceRoutes);
  await app.register(invoiceRoutes);
  await app.register(quoteRoutes);
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
